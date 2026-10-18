'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createWorkspaceWhatsAppAuth } = require('../src/services/workspaceWhatsAppAuth');
const { createWorkspaceOtpDelivery, inspectWorkspaceTemplate } = require('../src/services/workspaceWhatsAppTemplate');
const { strongRecentSession } = require('../src/services/staffPasskeyAuth');

// Entirely fabricated contract; this is NOT evidence about the owner's template.
function contract(language = 'en') {
  return { id: 'synthetic-template', wabaId: 'synthetic-waba', name: 'shiloh_workspace_verification',
    language, category: 'AUTHENTICATION', message_send_ttl_seconds: 300,
    components: [
      { type: 'BODY', text: '{{1}} is your verification code.', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 5 },
      { type: 'BUTTONS', buttons: [{ type: 'URL', otp_type: 'COPY_CODE', text: 'Copy code',
        url: 'https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}' }] },
    ] };
}

function fixture({ purpose = 'signin', ...overrides } = {}) {
  let clock = new Date('2026-10-17T12:00:00Z');
  const browserToken = crypto.randomBytes(32).toString('base64url');
  const network = '192.0.2.0/24';
  const admin = { id: 1, admin_active: true, staff_id: 1, staff_status: 'active', role: 'admin',
    calendar_scope: 'all_business', service_scope: 'all_services', permissions: { 'appointment:view': true },
    normalized_whatsapp: '27821234567', sign_in_first_name: 'Synthetic', sign_in_surname: 'Staff',
    sign_in_date_of_birth: '1990-01-01' };
  const operator = { ...admin, id: 2, staff_id: 2, normalized_whatsapp: '27821234568',
    permissions: { 'appointment:view': true, 'staff_auth:reset': true } };
  let state = { admins: [admin, operator], approvals: [{ sessionId: 99, adminId: 2, ok: true,
    authMethod: 'passkey', authenticatedAt: clock, expiresAt: new Date(clock.getTime() + 3600000) }],
    dispatches: [], challenges: [], intents: [], rates: {}, audits: [], sessions: [{ existing: true }], grants: [] };
  let queue = Promise.resolve();
  let failEffect = false;
  const store = { transaction(fn) {
    const call = queue.then(async () => {
      const copy = structuredClone(state);
      const tx = {
        async insertDispatch(row) { copy.dispatches.push(row); },
        async claimDispatch(current) {
          const row = copy.dispatches.find(r => r.state === 'queued' && new Date(r.expiresAt) > current && (!r.notBefore || new Date(r.notBefore)<=current));
          if (!row) return null;
          const claimed = structuredClone(row); row.state = 'claimed'; return claimed;
        },
        async dispatch(hash) { return copy.dispatches.find(r => r.requestHash === hash); },
        async saveDispatch(row) { copy.dispatches[copy.dispatches.findIndex(r => r.requestHash === row.requestHash)] = row; },
        async hasUncertainDelivery(id,current) { return copy.challenges.some(c => c.adminId === id && ['dispatching','uncertain'].includes(c.state) && new Date(c.expiresAt) > current); },
        async rateUntil(key,current) { const s=copy.rates[key];return s && s.until>current.getTime() ? new Date(s.until) : null; },
        async takeRate(buckets, current) {
          if (buckets.some(b => (b.amount ?? 1) > b.limit)) return false;
          const blocked = buckets.some(b => copy.rates[b.key] && copy.rates[b.key].until > current.getTime() && copy.rates[b.key].count + (b.amount ?? 1) > b.limit);
          if (blocked) return false;
          for (const b of buckets) {
            if (!copy.rates[b.key] || copy.rates[b.key].until <= current.getTime()) copy.rates[b.key] = { count: 0, until: current.getTime() + b.windowMs };
            copy.rates[b.key].count += b.amount ?? 1;
          }
          return true;
        },
        async adminsByMobile(mobile) { return copy.admins.filter(a => a.normalized_whatsapp === mobile); },
        async admin(id) { return copy.admins.find(a => a.id === id); },
        async session(id) { return copy.approvals.find(s => s.sessionId === id); },
        async revokeChallenges(id, p) { copy.challenges.filter(c => c.adminId === id && c.purpose === p && ['pending', 'dispatching', 'ready'].includes(c.state)).forEach(c => { c.state = 'revoked'; }); },
        async insertChallenge(row) { copy.challenges.push(row); },
        async insertIntent(row) { copy.intents.push(row); },
        async intent(hash) { return copy.intents.find(r => r.hash === hash); },
        async saveIntent(row) { copy.intents[copy.intents.findIndex(r => r.hash === row.hash)] = row; },
        async challenge(hash) { return copy.challenges.find(c => c.requestHash === hash); },
        async saveChallenge(row) { copy.challenges[copy.challenges.findIndex(c => c.requestHash === row.requestHash)] = row; },
        async audit(event) { copy.audits.push(event); },
        async issueSession(options) {
          if (failEffect) throw Error('synthetic effect failure');
          copy.sessions.push(options); return { ok: true, authenticated: true, authMethod: options.authMethod };
        },
        async issuePasskeyGrant(options) {
          if (failEffect) throw Error('synthetic effect failure');
          copy.grants.push(options); return { ok: true, grant: 'synthetic-grant', purpose: options.purpose };
        },
      };
      const result = await fn(tx);
      state = copy;
      return result;
    });
    queue = call.catch(() => {});
    return call;
  } };
  const reviewed = contract();
  let inventory = [{ ...structuredClone(reviewed), status: 'APPROVED' }];
  const sent = [];
  let sendHook = async () => ({ messages: [{ id: 'wamid.synthetic' }] });
  const delivery = createWorkspaceOtpDelivery({ enabled: true, reviewed, wabaId: reviewed.wabaId,
    readInventory: async () => inventory, send: async payload => { sent.push(payload); return sendHook(payload); } });
  const service = createWorkspaceWhatsAppAuth({ enabled: true, store, delivery,
    hmacKey: Buffer.alloc(32, 7), now: () => new Date(clock), ...overrides });
  const input = { purpose, mobile: admin.normalized_whatsapp, network, browserToken,
    approvalSessionId: 99, identityConfirmed: true };
  return { service, input, sent, reviewed, store, delivery,
    get state() { return state; }, get inventory() { return inventory; },
    setSend(fn) { sendHook = fn; }, setFailEffect(value) { failEffect = value; },
    advance(ms) { clock = new Date(clock.getTime() + ms); },
    async start(extra = {}) {
      const options = { ...input, ...extra };
      if (options.purpose !== 'signin') {
        const setup = await service.requestSetup(options);
        await service.approveSetup({ intent: setup.intent, sessionId: options.approvalSessionId, identityConfirmed: options.identityConfirmed });
        options.setupIntent = setup.intent;
      }
      const result = await service.begin(options);
      await service.dispatchOne();
      return result;
    },
    verify(request, extra = {}) { return service.verify({ ...input, request,
      code: sent.at(-1)?.template.components[0].parameters[0].text, ...extra }); },
  };
}

test('no default activation, store, provider call or environment-based revival', async () => {
  let calls = 0;
  const service = createWorkspaceWhatsAppAuth({ store: { transaction() { calls++; } },
    hmacKey: Buffer.alloc(32), delivery: { configured() { calls++; return true; } } });
  assert.equal(service.enabled(), false);
  assert.equal((await service.begin({})).code, 'WORKSPACE_WHATSAPP_DISABLED');
  assert.equal((await service.verify({})).code, 'WORKSPACE_WHATSAPP_DISABLED');
  const delivery = createWorkspaceOtpDelivery({ readInventory() { calls++; }, send() { calls++; } });
  assert.equal((await delivery.deliver({})).ok, false);
  assert.equal(calls, 0);
});

test('English label is insufficient; exact language, approval, components and account must match', () => {
  const reviewed = contract();
  const actual = { ...structuredClone(reviewed), status: 'APPROVED' };
  const inspect = (r = reviewed, inventory = [actual], wabaId = reviewed.wabaId) => inspectWorkspaceTemplate({ reviewed: r, inventory, wabaId });
  assert.equal(inspect().ready, true);
  assert.equal(inspect({ ...reviewed, language: undefined }).ready, false);
  assert.equal(inspect({ ...reviewed, language: 'en_US' }).ready, false);
  assert.equal(inspect(reviewed, [actual], 'different-waba').ready, false);
  assert.equal(inspect(reviewed, [actual, actual]).ready, false);
  for (const change of [{ status: 'PENDING' }, { status: 'PAUSED' }, { category: 'UTILITY' },
    { id: 'other-template' }, { message_send_ttl_seconds: 600 }, { components: [] }]) {
    assert.equal(inspect(reviewed, [{ ...actual, ...change }]).ready, false);
  }
  for (const mutate of [
    c => { c.components[2].buttons[0].otp_type = 'ONE_TAP'; },
    c => { c.components[2].buttons[0].url = 'https://evil.example/{{1}}'; },
    c => { c.components[0].text = '{{1}} and {{2}}'; },
    c => { c.components[1].code_expiration_minutes = 10; },
  ]) {
    const malformed = contract(); mutate(malformed);
    assert.equal(inspect(malformed, [{ ...malformed, status: 'APPROVED' }]).ready, false);
  }
});

test('sign-in uses the pinned language and code in both parameters; preserves sessions and passkey assurance', async () => {
  const f = fixture();
  const issued = await f.start();
  assert.deepEqual(Object.keys(issued).sort(), ['accepted', 'ok', 'request']);
  assert.equal(f.sent[0].template.language.code, 'en');
  assert.equal(f.sent[0].template.components[0].parameters[0].text, f.sent[0].template.components[1].parameters[0].text);
  assert.equal(f.sent[0].to, f.input.mobile);
  assert.equal((await f.verify(issued.request)).authMethod, 'workspace_whatsapp');
  assert.equal(f.state.sessions.length, 2);
  assert.deepEqual(f.state.sessions[0], { existing: true });
  assert.equal(f.state.sessions[1].preserveExistingSessions, true);
  assert.equal(f.state.sessions[1].recentStrongAuth, false);
  assert.equal(f.state.sessions[1].expiresAt - f.state.sessions[1].current, 8 * 3600000);
  assert.equal(strongRecentSession({ ok: true, authMethod: 'workspace_whatsapp', authenticatedAt: new Date() }), false);
  assert.equal(f.state.grants.length, 0);
  assert.equal((await f.verify(issued.request)).ok, false);
});

for (const purpose of ['enroll', 'recover']) {
  test(`${purpose} requires an independent passkey administrator and yields only a bound grant`, async () => {
    const f = fixture({ purpose });
    const issued = await f.start();
    const verified = await f.verify(issued.request);
    assert.equal(verified.purpose, purpose);
    assert.equal(verified.authenticated, undefined);
    assert.equal(f.state.sessions.length, 1);
    assert.equal(f.state.grants.length, 1);
    assert.equal(f.state.grants[0].operatorId, 2);
    assert.equal(f.state.grants[0].adminId, 1);
    assert.equal(f.state.grants[0].approvalSessionId, 99);
    assert.equal(f.state.grants[0].expiresAt - f.state.grants[0].current, 300000);
    assert.match(f.state.grants[0].browserHash, /^[a-f0-9]{64}$/);
    assert.equal((await f.verify(issued.request)).ok, false);
  });
}

test('unauthorized setup requests never send: self, stale, details, limited scope, reset permission, identity confirmation', async () => {
  for (const mutate of [
    f => { f.state.approvals[0].adminId = 1; },
    f => { f.state.approvals[0].authenticatedAt = new Date('2026-10-17T11:00:00Z'); },
    f => { f.state.approvals[0].authMethod = 'staff_details'; },
    f => { f.state.approvals[0].authMethod = 'whatsapp_otp'; },
    f => { f.state.admins[1].calendar_scope = 'self_only'; },
    f => { f.state.admins[1].permissions['staff_auth:reset'] = false; },
    f => { f.input.identityConfirmed = false; },
    f => { f.state.approvals[0].revokedAt = new Date(); },
  ]) {
    const f = fixture({ purpose: 'recover' }); mutate(f);
    const r = await f.start();
    assert.equal(r.accepted, true);
    assert.equal(f.sent.length, 0);
    assert.equal((await f.verify(r.request, { code: '123456' })).ok, false);
  }
});

test('unknown, inactive, ambiguous, invalid and rate-limited accounts return indistinguishable acceptance', async () => {
  for (const mutate of [
    f => { f.input.mobile = '27820000000'; },
    f => { f.input.mobile = 'invalid'; },
    f => { f.state.admins[0].admin_active = false; },
    f => { f.state.admins[0].staff_status = 'inactive'; },
    f => { f.state.admins.push({ ...f.state.admins[0], id: 3, admin_active: false }); },
  ]) {
    const f = fixture(); mutate(f);
    const r = await f.start();
    assert.deepEqual(Object.keys(r).sort(), ['accepted', 'ok', 'request']);
    assert.equal(r.accepted, true); assert.equal(f.sent.length, 0);
  }
  const f = fixture();
  const requests = await Promise.all(Array.from({ length: 8 }, () => f.start()));
  assert.ok(f.sent.length >= 1 && f.sent.length <= 3);
  assert.ok(requests.every(r => r.accepted === true));
  assert.equal(f.state.challenges.filter(c => c.state === 'ready').length, 1);
});

test('expiry, browser binding, purpose binding and five invalid attempts fail closed', async () => {
  const f = fixture(); const issued = await f.start();
  assert.equal((await f.verify(issued.request, { purpose: 'recover' })).ok, false);
  assert.equal((await f.verify(issued.request, { browserToken: crypto.randomBytes(32).toString('base64url') })).ok, false);
  assert.equal(f.state.challenges[0].attempts, 0);
  for (let i = 0; i < 5; i++) assert.equal((await f.verify(issued.request, { code: 'bad-format' })).ok, false);
  assert.equal(f.state.challenges[0].state, 'revoked');
  assert.equal((await f.verify(issued.request)).ok, false);
  const g = fixture(); const expired = await g.start(); g.advance(300000);
  assert.equal((await g.verify(expired.request)).ok, false);
});

test('rechecks staff identity, active status, collisions and approval revocation on verification', async () => {
  for (const mutate of [
    f => { f.state.admins[0].normalized_whatsapp = '27821111111'; },
    f => { f.state.admins[0].sign_in_surname = 'Changed'; },
    f => { f.state.admins[0].admin_active = false; },
    f => { f.state.admins.push({ ...f.state.admins[0], id: 3 }); },
    f => { f.state.approvals[0].revokedAt = new Date(); },
    f => { f.state.admins[1].permissions['staff_auth:reset'] = false; },
  ]) {
    const f = fixture({ purpose: 'recover' }); const r = await f.start(); mutate(f);
    assert.equal((await f.verify(r.request)).ok, false);
    assert.equal(f.state.grants.length, 0);
  }
});

test('concurrent verification consumes once; failed continuation rolls consumption back', async () => {
  const f = fixture(); const r = await f.start();
  const results = await Promise.all([f.verify(r.request), f.verify(r.request)]);
  assert.equal(results.filter(v => v.ok).length, 1);
  assert.equal(f.state.sessions.length, 2);
  const g = fixture({ purpose: 'enroll' }); const request = await g.start();
  g.setFailEffect(true);
  await assert.rejects(g.verify(request.request), /synthetic effect failure/);
  assert.equal(g.state.challenges[0].state, 'ready');
  assert.equal(g.state.grants.length, 0);
  g.setFailEffect(false);
  assert.equal((await g.verify(request.request)).ok, true);
});

test('failed/uncertain sends cannot authenticate, never retry, never leak provider exceptions', async () => {
  for (const send of [async () => { throw Error('secret-code-token-phone'); }, async () => ({}),
    async () => ({ messages: [{ id: 'secret-code-token-phone' }] })]) {
    const f = fixture(); f.setSend(send); const r = await f.start();
    assert.equal(r.accepted, true); assert.equal(f.sent.length, 1);
    assert.equal(f.state.challenges[0].state, 'uncertain');
    assert.equal((await f.verify(r.request)).ok, false);
    assert.doesNotMatch(JSON.stringify({ r, audit: f.state.audits }), /secret-code-token-phone/);
  }
});

test('template changes between preflight and send prevent provider dispatch', async () => {
  const reviewed = contract(); let reads = 0, sends = 0;
  const delivery = createWorkspaceOtpDelivery({ enabled: true, reviewed, wabaId: reviewed.wabaId,
    readInventory: async () => [{ ...reviewed, status: ++reads === 1 ? 'APPROVED' : 'PAUSED' }],
    send: async () => { sends++; } });
  assert.equal((await delivery.readiness()).ready, true);
  assert.equal((await delivery.deliver({ mobile: '27821234567', code: '123456', codeTtlSeconds: 300 })).ok, false);
  assert.equal(sends, 0);
});

test('resend invalidates prior codes; challenge persistence and audit exclude raw secrets', async () => {
  const f = fixture({ randomInt: () => 123456 });
  const first = await f.start(); f.advance(60000); const second = await f.start();
  assert.equal((await f.verify(first.request)).ok, false);
  assert.equal((await f.verify(second.request)).ok, true);
  const saved = JSON.stringify({ challenges: f.state.challenges, rates: f.state.rates, audit: f.state.audits });
  for (const secret of [first.request, second.request, f.input.browserToken, f.input.mobile, '123456', f.input.network]) assert.ok(!saved.includes(secret));
});

test('production entry points do not import preparation modules; generic transport stays retired', async () => {
  for (const filename of ['app.js', 'src/routes/staffBrowserSession.js', 'src/routes/staffPasskeyAuth.js', 'src/routes/staffPasskeyBootstrap.js']) {
    assert.doesNotMatch(fs.readFileSync(filename, 'utf8'), /workspaceWhatsApp(?:Auth|Template|Runtime|Pilot)/);
  }
  await assert.rejects(require('../src/services/whatsapp').sendWhatsAppSignInMessage(), /retired/);
});

// Structural timing regression: waiting on a provider is forbidden on the
// request path; deterministic call counts avoid flaky elapsed-time thresholds.
test('public intake never reads identities or waits for provider, for every account state', async () => {
  for (const mobile of ['27821234567', '27820000000', 'invalid']) {
    let reads = 0;
    const f = fixture({ delivery: { configured: () => true,
      readiness: () => { reads++; return new Promise(() => {}); },
      deliver: () => { throw Error('unexpected provider call'); } } });
    const original = f.store.transaction;
    f.store.transaction = fn => original(tx => fn({ ...tx, adminsByMobile() { throw Error('public identity lookup'); } }));
    const results = await Promise.all(Array.from({length: 5}, () => f.service.begin({...f.input,mobile})));
    assert.ok(results.every(r => r.accepted)); assert.equal(reads, 0);
    assert.equal(f.state.dispatches.length, 3);
    const persisted = JSON.stringify(f.state.dispatches);
    for (const secret of [mobile, f.input.browserToken, ...results.map(r => r.request)]) assert.ok(!persisted.includes(secret));
  }
});

test('durable claims are single-use, provider stalls do not hold intake locks, and late sends cannot revive resends', async () => {
  const f = fixture();
  let release, entered;
  const started = new Promise(r => { entered = r; });
  f.setSend(() => { entered(); return new Promise(r => { release = r; }); });
  await f.service.begin(f.input);
  const worker = f.service.dispatchOne(); await started;
  assert.equal((await f.service.dispatchOne()).processed, false);
  const next = await f.service.begin(f.input); assert.equal(next.accepted, true);
  f.setSend(async () => ({messages:[{id:'wamid.second'}]}));
  await f.service.dispatchOne();
  assert.equal(f.sent.length,1); // Another pending attempt must not overlap the send.
  await f.store.transaction(tx => tx.revokeChallenges(1,'signin'));
  release({messages:[{id:'wamid.first'}]}); await worker;
  assert.equal(f.state.challenges[0].state, 'revoked');
  f.advance(60000);
  await f.service.begin(f.input); await f.service.dispatchOne();
  assert.equal(f.state.challenges[1].state, 'ready');
  assert.equal((await f.service.dispatchOne()).processed, false);
});

test('expired intake and revoked setup approval cannot dispatch', async () => {
  const f = fixture(); await f.service.begin(f.input); f.advance(300000);
  assert.equal((await f.service.dispatchOne()).processed, false); assert.equal(f.sent.length, 0);
  const g = fixture({purpose:'recover'});
  const intent = await g.service.requestSetup(g.input);
  await g.service.approveSetup({intent:intent.intent,sessionId:99,identityConfirmed:true});
  await g.service.begin({...g.input,setupIntent:intent.intent});
  g.state.approvals[0].revokedAt = new Date();
  await g.service.dispatchOne(); assert.equal(g.sent.length, 0);
});

test('accepted staff policy caps actual code dispatches at ten across purposes and restarts', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) {
    await f.start();
    f.advance(11 * 60000);
  }
  assert.equal(f.sent.length,10);
  // A fresh service instance shares the durable rate buckets, not a counter
  // reset in application memory. New-purpose intake cannot reset the ceiling.
  const restarted = createWorkspaceWhatsAppAuth({ enabled:true, store:f.store, delivery:f.delivery,
    hmacKey:Buffer.alloc(32,7), now:()=>new Date('2026-10-17T14:00:00Z') });
  await restarted.begin(f.input);
  await restarted.dispatchOne();
  assert.equal(f.sent.length,10);
});
