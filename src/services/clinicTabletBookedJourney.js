'use strict';
const crypto = require('node:crypto');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LIFE_MS = 40 * 60 * 1000;
const IDLE_MS = 5 * 60 * 1000;
class TabletJourneyError extends Error {
  constructor(message = 'This tablet session has ended. Please start again.', httpStatus = 410) {
    super(message); this.httpStatus = httpStatus;
  }
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
// Preparation only: no production composition or in-memory production fallback.
// Store callbacks MUST serialize by device/grant and use one transaction for
// grant changes, scope checks and canonical form issuance/submission.
function createClinicTabletBookedJourney({ store, authorizeDevice, otp, visits, forms,
  now = () => new Date(), randomToken = () => crypto.randomBytes(32).toString('base64url') } = {}) {
  if (!store?.create || !store?.withGrant || !authorizeDevice || !otp?.begin || !otp?.verify ||
    !visits?.forVerifiedPhone || !visits?.recheck || !forms?.required || !forms?.open || !forms?.submit || !forms?.close || !forms?.model || otp.proofOnly!==true || otp.sharedAllowance!==true || otp.atomic!==true)
    throw new Error('Explicit tablet-only authority, durable grant store and canonical adapters required');
  async function device(raw) {
    const found = TOKEN.test(String(raw || '')) ? await authorizeDevice(raw) : null;
    if (!found?.id) throw new TabletJourneyError('Please ask Reception to prepare this tablet.', 401);
    return found;
  }
  async function begin(deviceToken, { mobile, network, entryGrantToken } = {}) {
    const d = await device(deviceToken), grant = entryGrantToken===undefined?randomToken():entryGrantToken, browserToken = randomToken();
    if (!TOKEN.test(grant) || !TOKEN.test(browserToken)) throw new Error('Invalid tablet capability');
    // No identity or visit disclosure before fresh phone proof. Existing shared OTP
    // reservation/cooldown/budget remains in otp, never duplicated here.
    const created=await store.create(d.id, digest(grant), async tx => {
      const result = await otp.begin({ mobile, network, browserToken, purpose: 'tablet_forms',tabletBinding:{deviceId:d.id,grantHash:digest(grant)} }, tx);
      if (!result?.ok || !TOKEN.test(result.request || '')) throw new TabletJourneyError('Codes are unavailable. Please ask Reception for help.', 503);
      const at = now().getTime();
      return { state: 'code', request: result.request, browserToken,
        createdAt: at, touchedAt: at, expiresAt: at + LIFE_MS };
    });
    return { token: grant, state: created?.state||'code' };
  }
  async function access(deviceToken, grant, fn, {allowFinished=false}={}) {
    const d = await device(deviceToken);
    if (!TOKEN.test(String(grant || ''))) throw new TabletJourneyError();
    return store.withGrant(d.id, digest(grant), async (s, tx) => {
      const at = now().getTime();
      if (!s || (s.state==='cancelled'||s.state==='finished'&&!allowFinished) || at >= s.expiresAt || at - s.touchedAt >= IDLE_MS)
        throw new TabletJourneyError();
      s.touchedAt = at;
      return fn(s, tx);
    });
  }
  async function verify(deviceToken, grant, { code, network } = {}) {
    const outcome=await access(deviceToken, grant, async (s, tx) => {
      if (s.state !== 'code') throw new TabletJourneyError('This code step has ended. Start again if needed.', 409);
      const result = await otp.verify({ browserToken: s.browserToken, request: s.request,
        purpose: 'tablet_forms', code, network }, tx);
      if (!result?.ok || !result.verifiedMobile) return {invalidCode:true};
      delete s.request; delete s.browserToken;
      const found = await visits.forVerifiedPhone(result.verifiedMobile, tx);
      // A phone is not permission to choose between people. No names or booking
      // details escape on a shared, missing or unverified canonical identity.
      if (found?.ambiguous || !found?.clientId || !Array.isArray(found.visits) || !found.visits.length || found.visits.length > 20) {
        s.state = 'help'; return { state: 'help' };
      }
      s.clientId = String(found.clientId);
      s.choices = found.visits.map(v => ({ id: String(v.id), label: String(v.label), revision: String(v.revision) }));
      if (new Set(s.choices.map(v => v.id)).size !== s.choices.length || s.choices.some(v => !/^[1-9]\d*$/.test(v.id) || !v.revision)) {
        s.state = 'help'; delete s.choices; return { state: 'help' };
      }
      s.state = 'choose';
      return { state: 'choose', visits: s.choices.map(({ id, label }) => ({ id, label })) };
    });
    // Commit failed-code counters before reporting a validation error.
    if(outcome.invalidCode)throw new TabletJourneyError('We could not verify this code. Check it or ask Reception for help.',422);
    return outcome;
  }
  async function scope(s, tx) {
    if (!await visits.recheck({ clientId: s.clientId, appointmentId: s.appointmentId, revision: s.revision }, tx))
      throw new TabletJourneyError('The visit changed. Please ask Reception to check it.', 409);
  }
  async function current(s, tx) {
    await scope(s, tx);
    const required = await forms.required({ clientId: s.clientId, appointmentId: s.appointmentId }, tx);
    if (!Array.isArray(required)) throw new Error('Required form authority unavailable');
    const outstanding = required.filter(f => !f.completed);
    if (outstanding.some(f => !f.id || !f.canComplete)) {
      if(s.form)await forms.close(s.form,tx);
      for(const key of ['form','clientId','appointmentId','revision','choices'])delete s[key];
      s.state = 'help'; return { state: 'help' };
    }
    if (!outstanding.length) {
      if (s.form) await forms.close(s.form, tx);
      for (const key of Object.keys(s)) if(!['expiresAt','touchedAt','createdAt'].includes(key))delete s[key];
      s.state = 'finished';
      return { state: 'finished' };
    }
    const next = outstanding[0];
    if (s.form && String(s.form.assignmentId) !== String(next.id)) {
      await forms.close(s.form, tx); delete s.form;
    }
    if (!s.form) s.form = await forms.open({ clientId: s.clientId, appointmentId: s.appointmentId,
      assignmentId: next.id, expiresAt: s.expiresAt }, tx);
    if (String(s.form?.assignmentId) !== String(next.id)) throw new Error('Form authority scope mismatch');
    const model = await forms.model(s.form, tx);
    return { state: 'form', position: required.length - outstanding.length + 1, total: required.length,
      assignmentId: String(next.id), model };
  }
  async function choose(deviceToken, grant, appointmentId) {
    return access(deviceToken, grant, async (s, tx) => {
      if (s.state !== 'choose') throw new TabletJourneyError('Select your visit again.', 409);
      const choice = s.choices.find(v => v.id === String(appointmentId));
      if (!choice) throw new TabletJourneyError('Please select one of your listed visits.', 422);
      s.appointmentId = choice.id; s.revision = choice.revision; delete s.choices;
      s.state = 'form'; return current(s, tx);
    });
  }
  async function resume(deviceToken, grant) {
    return access(deviceToken, grant, async (s, tx) => {
      if (s.state === 'finished')return {state:'finished'};
      if (s.state === 'form') return current(s, tx);
      return s.state === 'choose' ? { state: 'choose', visits: s.choices.map(({ id, label }) => ({ id, label })) } : { state: s.state };
    },{allowFinished:true});
  }
  async function submit(deviceToken, grant, assignmentId, answers) {
    return access(deviceToken, grant, async (s, tx) => {
      if(s.state==='finished')return {state:'finished'};
      if (s.state !== 'form' || String(s.form?.assignmentId) !== String(assignmentId))
        throw new TabletJourneyError('This form step has changed. Refresh to check the saved result.', 409);
      await scope(s, tx);
      await forms.submit(s.form, answers, tx);
      // The backend's saved submission, not browser navigation or a success
      // response alone, decides whether to advance. Recover lost replies by GET.
      const required = await forms.required({ clientId: s.clientId, appointmentId: s.appointmentId }, tx);
      if (!required.find(f => String(f.id) === String(assignmentId))?.completed)
        throw new TabletJourneyError('Your form is not confirmed as saved. Please ask Reception to check.', 503);
      return current(s, tx);
    },{allowFinished:true});
  }
  async function cancel(deviceToken, grant) {
    const d = await device(deviceToken);
    if (!TOKEN.test(String(grant || ''))) return { state: 'cancelled' };
    await store.withGrant(d.id, digest(grant), async (s, tx) => {
      if (!s) return;
      if (s.form) await forms.close(s.form, tx);
      for (const key of Object.keys(s)) delete s[key];
      s.state = 'cancelled';
    });
    return { state: 'cancelled' };
  }
  const touch=(deviceToken,grant)=>access(deviceToken,grant,async()=>({ok:true}));
  return { begin, verify, choose, resume, submit, cancel, touch, ready:device };
}
module.exports = { createClinicTabletBookedJourney, TabletJourneyError, LIFE_MS, IDLE_MS };
