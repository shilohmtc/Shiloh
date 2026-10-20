'use strict';

const crypto = require('node:crypto');
const { normalizeMobile } = require('./crmV2ClientService');
const { deriveCalendarViewer, safeHashEqual, sha256 } = require('./staffBrowserSession');
const { strongRecentSession, passkeyPolicy, registrationUser, verifyRegistrationResponse, fromB64url } = require('./staffPasskeyAuth');
const { workspaceWhatsAppRevision } = require('./workspaceWhatsAppIdentity');
const { codeReservationBuckets } = require('./codeSignInPolicy');

const PURPOSES = new Set(['signin', 'enroll', 'recover']);
const INVALID = Object.freeze({ ok: false, code: 'WORKSPACE_WHATSAPP_INVALID' });
const DISABLED = Object.freeze({ ok: false, code: 'WORKSPACE_WHATSAPP_DISABLED' });
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
function validWorkspaceBudgets(b) {
  return !!b && b.currency === 'ZAR' && ['dailySpendMinor','whatsappCostMinor','smsCostMinor','smsAccountDailyLimit','smsClinicDailyLimit'].every(k =>
    Number.isSafeInteger(b[k]) && b[k] > 0 && b[k] <= 100000000);
}
const tokenValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const active = row => row?.admin_active === true &&
  (row.staff_id == null || row.staff_status === 'active') && !!deriveCalendarViewer(row);

// Explicit composition only: no mounted production route or default sender.
function createWorkspaceWhatsAppAuth({ enabled = false, store = null, delivery = null,
  hmacKey = null, now = () => new Date(), randomBytes = crypto.randomBytes,
  randomInt = crypto.randomInt, env = {}, smsDelivery = null, budgets = null,
  accessPolicy = null, isEnabled = () => true } = {}) {
  const key = Buffer.isBuffer(hmacKey) ? Buffer.from(hmacKey) : null;
  const enabledHere = () => enabled === true && isEnabled() === true && key?.length >= 32 &&
    typeof store?.transaction === 'function' && typeof delivery?.configured === 'function' && delivery.configured();
  const digest = (...parts) => crypto.createHmac('sha256', key).update(JSON.stringify(parts)).digest('hex');
  const revision = workspaceWhatsAppRevision;
  const scopeBinding=typeof accessPolicy?.scopeId==='string'?{accessScope:accessPolicy.scopeId}:{};
  const recordAllowed=row=>!accessPolicy?.acceptsRecord || accessPolicy.acceptsRecord(row)===true;
  const budget = validWorkspaceBudgets(budgets) ? structuredClone(budgets) : null;
  const fallbackEnabled = () => enabledHere() && !!budget && smsDelivery?.configured?.() === true;
  const subjectAllowed = (id,purpose,current) => enabledHere() &&
    (!accessPolicy || accessPolicy.allowsSubject(id,purpose,current) === true);

  async function approval(tx, sessionId, subjectId, current, requireRecent) {
    const session = await tx.session(sessionId);
    if (!session?.ok || session.revokedAt || session.recoveryRequired || session.authMethod !== 'passkey' ||
        !Number.isFinite(new Date(session.expiresAt).getTime()) || new Date(session.expiresAt) <= current ||
        (requireRecent && !strongRecentSession(session, current)) || Number(session.adminId) === Number(subjectId)) return null;
    const operator = await tx.admin(session.adminId);
    if (!active(operator) || !enabledHere() || accessPolicy && accessPolicy.allowsOperator(operator.id,current) !== true || operator.calendar_scope !== 'all_business' || operator.service_scope !== 'all_services' ||
        operator.permissions?.['staff_auth:reset'] !== true) return null;
    return operator;
  }

  async function ownSession(tx, sessionId, subjectId, current) {
    const session = await tx.session(sessionId);
    if (!session?.ok || session.revokedAt || session.recoveryRequired || Number(session.adminId) !== Number(subjectId) ||
        !Number.isFinite(new Date(session.expiresAt).getTime()) || new Date(session.expiresAt) <= current) return null;
    const subject = await tx.admin(subjectId);
    return active(subject) && subjectAllowed(subjectId,'enroll',current) ? session : null;
  }
  async function setupProof(tx, row, current, recent = false) {
    if(!recordAllowed(row))return null;
    if (row.purpose === 'enroll' && row.selfSessionId) return ownSession(tx,row.selfSessionId,row.adminId,current);
    return approval(tx,row.approvalSessionId,row.adminId,current,recent);
  }

  // The HTTP adapter supplies sessionId only after session validation and CSRF.
  // The recorded phone is read from the canonical account, never request JSON.
  async function requestOwnEnrollment({sessionId,browserToken,network,proof='code'} = {}) {
    if (!enabledHere()) return DISABLED;
    if (!tokenValid(browserToken) || typeof network!=='string' || !network || network.length>120 || !['code','passkey'].includes(proof)) return INVALID;
    const prepared = await store.transaction(async tx => {
      const current=now(), session=await tx.session(sessionId);
      if (!session || !await ownSession(tx,sessionId,session.adminId,current)) return null;
      const subject=await tx.admin(session.adminId), matches=await tx.adminsByMobile(subject.normalized_whatsapp);
      if(normalizeMobile(subject.normalized_whatsapp)!==subject.normalized_whatsapp || matches.length!==1 || Number(matches[0].id)!==Number(subject.id) || !subjectAllowed(subject.id,'enroll',now())) return null;
      const binding={...scopeBinding,adminId:subject.id,purpose:'enroll',selfSessionId:sessionId,
        browserHash:digest('browser',browserToken),identityRevision:revision(subject),current,
        expiresAt:new Date(current.getTime()+300000)};
      if(proof==='code'&&tx.ownEnrollmentWindow){
        const until=await tx.ownEnrollmentWindow({...binding,sessionId,current});
        if(until)return {result:await tx.issuePasskeyGrant({...binding,reusable:true,expiresAt:until})};
      }
      if(proof==='passkey') {
        if(!strongRecentSession(session,current)) return null;
        return {result:await tx.issuePasskeyGrant(binding)};
      }
      const intent=randomBytes(32).toString('base64url');
      await tx.insertIntent({...binding,hash:sha256(intent),state:'approved',expiresAt:new Date(current.getTime()+WINDOW_MS)});
      return {mobile:subject.normalized_whatsapp,intent};
    });
    if(!prepared) return INVALID;
    if(prepared.result) return prepared.result;
    return begin({purpose:'enroll',mobile:prepared.mobile,setupIntent:prepared.intent,browserToken,network});
  }

  // network must be the server-derived network group, never request JSON.
  // browserToken must be a server-issued HttpOnly cookie (not UA/IP fingerprint).
  async function begin({ purpose, mobile, setupIntent = null,
    network, browserToken } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!PURPOSES.has(purpose) || !tokenValid(browserToken) || typeof network !== 'string' || !network || network.length > 120) return INVALID;
    const normalized = typeof mobile === 'string' && mobile.length <= 30 ? normalizeMobile(mobile) : null;
    const request = randomBytes(32).toString('base64url');
    const accepted = { ok: true, accepted: true, request };
    // No identity lookup or provider I/O on this public path. All account states
    // take the same intake path; rate admission depends only on caller input.
    await store.transaction(async tx => {
      const current = now();
      const buckets = [
        ['identity', normalized || 'invalid', 3, WINDOW_MS],
        ['browser', browserToken, 10, WINDOW_MS],
        ['network', network, 30, WINDOW_MS],
        ['clinic', 'all', 100, WINDOW_MS],
        ['clinic-day', 'all', 500, 24 * 60 * 60 * 1000],
      ].map(([kind, value, limit, windowMs]) => ({ key: digest('issue-rate', kind, value), limit, windowMs }));
      if (!await tx.takeRate(buckets, current)) return;
      const requestHash = digest('request', request);
      const nonce = randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(digest('intake-encryption'), 'hex'), nonce);
      cipher.setAAD(Buffer.from(requestHash));
      const encrypted = Buffer.concat([cipher.update(normalized || '', 'utf8'), cipher.final()]);
      await tx.insertDispatch({ ...scopeBinding,requestHash, purpose, browserHash: digest('browser', browserToken),
        intentHash: tokenValid(setupIntent) ? sha256(setupIntent) : null,
        mobile: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64'),
        issuedAt: current, expiresAt: new Date(current.getTime() + 300000), state: 'queued', channel: 'whatsapp',
        identityRateKey: digest('issue-rate', 'identity', normalized || 'invalid') });
    });
    return accepted;
  }

  async function requestSmsFallback({request,purpose,browserToken,network} = {}) {
    if (!fallbackEnabled()) return DISABLED;
    if (!tokenValid(request) || !PURPOSES.has(purpose) || !tokenValid(browserToken) ||
        typeof network !== 'string' || !network || network.length > 120) return INVALID;
    await store.transaction(async tx => {
      const current = now(), row = await tx.dispatch(digest('request',request));
      const prior = row ? await tx.challenge(row.requestHash) : null;
      const expired = prior && new Date(prior.expiresAt) <= current && ['ready','uncertain','revoked'].includes(prior.state);
      if (!row || !recordAllowed(row) || !(['not_sent','claimed'].includes(row.state) || expired && ['accepted','uncertain'].includes(row.state)) || row.channel !== 'whatsapp' || row.fallbackUsed || row.fallbackRequested || !row.mobile ||
          row.purpose !== purpose || row.browserHash !== digest('browser',browserToken) || new Date(row.expiresAt) <= current) return;
      if (!await tx.takeRate([
        {key:row.identityRateKey,limit:3,windowMs:WINDOW_MS},
        {key:digest('issue-rate','browser',browserToken),limit:10,windowMs:WINDOW_MS},
        {key:digest('issue-rate','network',network),limit:30,windowMs:WINDOW_MS},
        {key:digest('issue-rate','clinic','all'),limit:100,windowMs:WINDOW_MS},
        {key:digest('issue-rate','clinic-day','all'),limit:500,windowMs:DAY_MS},
      ],current)) return;
      row.fallbackRequested = true;
      if (row.state !== 'claimed') { row.channel = 'sms'; row.fallbackUsed = true; row.state = 'queued'; }
      const challenge = prior;
      if (challenge && row.state !== 'claimed') { challenge.state = 'revoked'; await tx.saveChallenge(challenge); }
      await tx.saveDispatch(row);
    });
    // Never disclose delivery status, eligibility, quota or approval state.
    return {ok:true,accepted:true,request};
  }

  function settleDispatch(row, outcome) {
    row.state = outcome;
    if(['accepted','uncertain'].includes(outcome)) row.fallbackRequested=false;
    if (outcome === 'not_sent' && row.channel === 'whatsapp' && row.fallbackRequested && !row.fallbackUsed) {
      row.channel = 'sms'; row.fallbackUsed = true; row.state = 'queued';
    }
    // Keep only encrypted input for a bounded expiry fallback window.
    if (row.channel === 'sms' && row.state !== 'queued') delete row.mobile;
  }

  // Explicit worker entry point only; never mounted or started by this draft.
  // Claim commits BEFORE any provider call. A crash/uncertain send is never
  // retried automatically, including after process restart.
  async function dispatchOne() {
    if (!enabledHere()) return DISABLED;
    const intake = await store.transaction(tx => tx.claimDispatch(now(),accessPolicy?.dispatchScope));
    if (!intake) return { ok: true, processed: false };
    const completed = { ok: true, processed: true };
    const channel = intake.channel || 'whatsapp';
    const provider = channel === 'sms' ? (fallbackEnabled() ? smsDelivery : null) : delivery;
    const finish = outcome => store.transaction(async tx => {
      const row = await tx.dispatch(intake.requestHash);
      if (!row || row.state !== 'claimed') return;
      settleDispatch(row, outcome);
      await tx.saveDispatch(row);
    });
    if(!recordAllowed(intake)){await finish('not_sent');return completed;}
    let normalized, template;
    try {
      const packed = Buffer.from(intake.mobile, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(digest('intake-encryption'), 'hex'), packed.subarray(0, 12));
      decipher.setAAD(Buffer.from(intake.requestHash)); decipher.setAuthTag(packed.subarray(12, 28));
      normalized = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
      // A pilot must reject other subjects before any authenticated provider I/O.
      // Recheck under the reservation transaction after bounded readiness below.
      if (accessPolicy && !await store.transaction(async tx => {
        const matches = await tx.adminsByMobile(normalized);
        return matches.length === 1 && active(matches[0]) && subjectAllowed(matches[0].id,intake.purpose,now());
      })) { await finish('not_sent'); return completed; }
      template = await provider?.readiness();
    } catch (_) { await finish('not_sent'); return completed; }
    if (!template?.ready || !Number.isInteger(template.codeTtlSeconds) || template.codeTtlSeconds <= 0 || template.codeTtlSeconds > 300) { await finish('not_sent'); return completed; }
    const { purpose, requestHash } = intake;
    const prepared = await store.transaction(async tx => {
      const current = now();
      // Leave room for the bounded inventory/send calls; never dispatch a nearly expired code.
      if (new Date(intake.expiresAt).getTime() - current.getTime() < 60000) return null;
      if (!normalized) return null;
      // Include inactive collisions; never copy or register a CRM identity.
      const matches = await tx.adminsByMobile(normalized);
      if (matches.length !== 1 || !active(matches[0])) return null;
      const subject = matches[0];
      if (!subjectAllowed(subject.id,purpose,current)) return null;
      // An unknown result for this staff phone blocks subsequent channel sends
      // until expiry, including a different request/purpose and process restart.
      if (await tx.hasUncertainDelivery(subject.id, current)) return null;
      let operator = null;
      let approvalSessionId = null;
      let selfSessionId = null;
      let setupIntentToConsume = null;
      if (purpose !== 'signin') {
        if (!intake.intentHash) return null;
        const intent = await tx.intent(intake.intentHash);
        if (!intent || !recordAllowed(intent) || !(intent.state === 'approved' || channel === 'sms' && intake.fallbackUsed && intent.state === 'consumed' && intent.consumedByRequestHash === requestHash) || intent.purpose !== purpose ||
            Number(intent.adminId) !== Number(subject.id) || new Date(intent.expiresAt) <= current ||
            intent.identityRevision !== revision(subject) || intent.browserHash !== intake.browserHash) return null;
        approvalSessionId = intent.approvalSessionId;
        if(!await setupProof(tx,intent,current,true)) return null;
        selfSessionId=intent.selfSessionId || null;
        operator = selfSessionId ? null : await approval(tx, approvalSessionId, subject.id, current, true);
        setupIntentToConsume=intent;
      }
      const cooldown = await tx.rateUntil(digest('code-resend','staff',String(subject.id)),current);
      if(cooldown) {
        const row=await tx.dispatch(requestHash);
        row.state='queued'; row.notBefore=cooldown;
        await tx.saveDispatch(row);
        return {deferred:true};
      }
      if (!subjectAllowed(subject.id,purpose,now())) return null;
      if (!await tx.takeRate([
        ...codeReservationBuckets({ audience:'staff', personKey:String(subject.id), channel, digest, current }),
        ...(accessPolicy ? accessPolicy.reservationBuckets({digest,current,channel}) : []),
        ...(budget ? [
        {key:digest('spend-day','all'),limit:budget.dailySpendMinor,amount:channel === 'sms' ? budget.smsCostMinor : budget.whatsappCostMinor,windowMs:DAY_MS},
        ...(channel === 'sms' ? [
          {key:digest('sms-account-day',subject.id),limit:budget.smsAccountDailyLimit,windowMs:DAY_MS},
          {key:digest('sms-clinic-day','all'),limit:budget.smsClinicDailyLimit,windowMs:DAY_MS},
        ] : []),
        ] : []),
      ],current)) return null;
      if(setupIntentToConsume) {
        setupIntentToConsume.state='consumed'; setupIntentToConsume.consumedByRequestHash=requestHash;
        await tx.saveIntent(setupIntentToConsume);
      }
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const row = {
        ...(intake.accessScope?{accessScope:intake.accessScope}:{}),requestHash, purpose, channel, adminId: subject.id, operatorId: operator?.id || null,
        approvalSessionId: operator ? approvalSessionId : null, selfSessionId,
        identityRevision: revision(subject), browserHash: intake.browserHash,
        codeHash: digest('code', requestHash, purpose, code), issuedAt: current,
        expiresAt: new Date(Math.min(new Date(intake.expiresAt).getTime(), current.getTime() + template.codeTtlSeconds * 1000)),
        attempts: 0, state: 'dispatching', providerMessageId: null,
      };
      await tx.revokeChallenges(subject.id, purpose, current);
      if (await tx.challenge(requestHash)) await tx.saveChallenge(row);
      else await tx.insertChallenge(row);
      await tx.audit({ event: 'workspace_whatsapp_requested', adminId: subject.id,
        operatorId: operator?.id || null, purpose, at: current });
      return { requestHash, mobile: subject.normalized_whatsapp, code };
    });
    if (prepared?.deferred) return completed;
    if (!prepared) { await finish('not_sent'); return completed; }
    let sent;
    try { sent = enabledHere() ? await provider.deliver({ mobile: prepared.mobile, code: prepared.code, codeTtlSeconds: template.codeTtlSeconds }) : {ok:false,outcome:'not_sent'}; }
    catch (_) { sent = { ok: false }; }
    await store.transaction(async tx => {
      const dispatch = await tx.dispatch(intake.requestHash);
      if (dispatch?.state === 'claimed') {
        settleDispatch(dispatch, sent?.ok === true ? 'accepted' : sent?.outcome === 'not_sent' ? 'not_sent' : 'uncertain');
        dispatch.expiresAt=new Date(now().getTime()+600000);
        await tx.saveDispatch(dispatch);
      }
      const row = await tx.challenge(prepared.requestHash);
      if (!row || row.state !== 'dispatching') return;
      const current = now();
      const success = sent?.ok === true && typeof sent.providerMessageId === 'string' && sent.providerMessageId.startsWith(channel === 'sms' ? 'sms.' : 'wamid.') && new Date(row.expiresAt) > current;
      row.state = success ? 'ready' : sent?.outcome === 'not_sent' ? 'revoked' : 'uncertain';
      row.providerMessageId = success ? sent.providerMessageId : null;
      await tx.saveChallenge(row);
      await tx.audit({ event: success ? 'workspace_whatsapp_provider_accepted' : 'workspace_whatsapp_send_failed',
        adminId: row.adminId, operatorId: row.operatorId, purpose, at: current });
    });
    return completed;
  }

  async function verify({ request, code, purpose, browserToken, network } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!tokenValid(request) || !PURPOSES.has(purpose) || !tokenValid(browserToken) ||
        typeof network !== 'string' || !network || network.length > 120) return INVALID;
    return store.transaction(async tx => {
      const current = now();
      if (!await tx.takeRate([
        { key: digest('verify-network', network), limit: 100, windowMs: WINDOW_MS },
        { key: digest('verify-clinic', 'all'), limit: 1000, windowMs: WINDOW_MS },
      ], current)) return INVALID;
      const row = await tx.challenge(digest('request', request));
      if (!row || !recordAllowed(row) || row.state !== 'ready' || !row.providerMessageId ||
          row.purpose !== purpose || !safeHashEqual(row.browserHash, digest('browser', browserToken))) return INVALID;
      if (new Date(row.expiresAt) <= current || row.attempts >= MAX_ATTEMPTS) {
        row.state = 'revoked'; await tx.saveChallenge(row); return INVALID;
      }
      // Invalid format counts too, but secrets never enter audit or rate keys.
      row.attempts += 1;
      if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code) || !safeHashEqual(row.codeHash, digest('code', row.requestHash, purpose, code))) {
        if (row.attempts >= MAX_ATTEMPTS) row.state = 'revoked';
        await tx.saveChallenge(row);
        return INVALID;
      }
      const subject = await tx.admin(row.adminId);
      const owners = subject ? await tx.adminsByMobile(subject.normalized_whatsapp) : [];
      if (!active(subject) || !subjectAllowed(subject.id,purpose,current) || owners.length !== 1 || Number(owners[0].id) !== Number(subject.id) ||
          !safeHashEqual(row.identityRevision, revision(subject)) ||
          (purpose !== 'signin' && !await setupProof(tx, row, current))) {
        row.state = 'revoked'; await tx.saveChallenge(row); return INVALID;
      }
      row.state = 'consumed';
      await tx.saveChallenge(row);
      if (!subjectAllowed(subject.id,purpose,now())) return INVALID;
      // The adapter MUST commit this effect, consumption and audit atomically.
      // A setup grant is not a session or a credential replacement. It binds the
      // later WebAuthn ceremony to this identity, approval, purpose and browser.
      const result = purpose === 'signin'
        ? await tx.issueSession({ admin: subject, authMethod: row.channel === 'sms' ? 'workspace_sms' : 'workspace_whatsapp',
          preserveExistingSessions: true, recentStrongAuth: false, current,
          expiresAt: new Date(current.getTime() + 8 * 60 * 60 * 1000), identityRevision: row.identityRevision })
        : await tx.issuePasskeyGrant({ ...(row.accessScope?{accessScope:row.accessScope}:{}),adminId: subject.id, operatorId: row.operatorId,
          approvalSessionId: row.approvalSessionId, selfSessionId:row.selfSessionId, purpose, browserHash: row.browserHash,
          identityRevision: row.identityRevision, current,
          reusable:purpose==='enroll'&&!!row.selfSessionId&&row.channel==='whatsapp',
          expiresAt: new Date(current.getTime() + (purpose==='enroll'&&row.selfSessionId&&row.channel==='whatsapp'?10:5) * 60 * 1000) });
      if (!result || result.ok !== true) throw new Error('Workspace authentication continuation failed');
      await tx.audit({ event: 'workspace_whatsapp_verified', adminId: subject.id,
        operatorId: row.operatorId, purpose, at: current });
      return result;
    });
  }

  async function requestSetup({ purpose, mobile, browserToken, network } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!['enroll','recover'].includes(purpose) || !tokenValid(browserToken) || !network || typeof network !== 'string' || network.length > 120) return INVALID;
    const intent = randomBytes(32).toString('base64url');
    const normalized = typeof mobile === 'string' && mobile.length <= 30 ? normalizeMobile(mobile) : null;
    await store.transaction(async tx => {
      const current = now();
      if (!await tx.takeRate([{ key: digest('intent-network', network), limit: 20, windowMs: WINDOW_MS },
        { key: digest('intent-clinic','all'), limit: 100, windowMs: WINDOW_MS }], current) || !normalized) return;
      const rows = await tx.adminsByMobile(normalized);
      if (rows.length !== 1 || !active(rows[0]) || !subjectAllowed(rows[0].id,purpose,current)) return;
      await tx.insertIntent({ ...scopeBinding,hash: sha256(intent), adminId: rows[0].id, purpose, state: 'requested',
        browserHash: digest('browser', browserToken), identityRevision: revision(rows[0]),
        expiresAt: new Date(current.getTime() + WINDOW_MS) });
    });
    return { ok: true, intent };
  }

  // sessionId comes exclusively from authenticated session middleware + CSRF.
  async function approveSetup({ intent, sessionId, identityConfirmed } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!tokenValid(intent) || identityConfirmed !== true) return INVALID;
    return store.transaction(async tx => {
      const current = now(), row = await tx.intent(sha256(intent));
      if (!row || !recordAllowed(row) || row.state !== 'requested' || new Date(row.expiresAt) <= current || !subjectAllowed(row.adminId,row.purpose,current)) return INVALID;
      const admin = await tx.admin(row.adminId);
      const operator = await approval(tx, sessionId, row.adminId, current, true);
      if (!active(admin) || !operator || row.identityRevision !== revision(admin)) return INVALID;
      row.state = 'approved'; row.approvalSessionId = sessionId;
      await tx.saveIntent(row);
      await tx.audit({ event: 'workspace_whatsapp_setup_approved', adminId: admin.id, operatorId: operator.id, purpose: row.purpose, at: current });
      return { ok: true };
    });
  }

  async function inspectSetup({ intent, sessionId } = {}) {
    if (!enabledHere()) return DISABLED;
    if (!tokenValid(intent)) return INVALID;
    return store.transaction(async tx => {
      const current = now(), row = await tx.intent(sha256(intent));
      if (!row || !recordAllowed(row) || row.state !== 'requested' || new Date(row.expiresAt) <= current || !subjectAllowed(row.adminId,row.purpose,current) ||
          !await approval(tx, sessionId, row.adminId, current, true)) return INVALID;
      const admin = await tx.admin(row.adminId);
      if (!active(admin) || row.identityRevision !== revision(admin)) return INVALID;
      return { ok:true, displayName:admin.display_name, mobileEnding:admin.normalized_whatsapp.slice(-4), purpose:row.purpose };
    });
  }

  async function admitRequest({ network, browserToken } = {}) {
    if (!enabledHere() || !tokenValid(browserToken) || typeof network !== 'string' || !network || network.length > 120) return false;
    return store.transaction(tx => tx.takeRate([
      { key:digest('http-network', network), limit:60, windowMs:WINDOW_MS },
      { key:digest('http-browser', browserToken), limit:30, windowMs:WINDOW_MS },
      { key:digest('http-clinic','all'), limit:500, windowMs:WINDOW_MS },
    ], now()));
  }

  async function authorizedGrant(tx, grant, browserToken, current) {
    if (!tokenValid(grant) || !tokenValid(browserToken)) return null;
    const row = await tx.grant(sha256(grant));
    if (!row || !recordAllowed(row) || !['issued','started'].includes(row.state) || !['enroll','recover'].includes(row.purpose) ||
        new Date(row.expiresAt) <= current || row.browserHash !== digest('browser', browserToken)) return null;
    const admin = await tx.admin(row.adminId);
    const matches = admin ? await tx.adminsByMobile(admin.normalized_whatsapp) : [];
    if (!active(admin) || !subjectAllowed(admin.id,row.purpose,current) || matches.length !== 1 || Number(matches[0].id) !== Number(admin.id) ||
        row.identityRevision !== revision(admin) || !await setupProof(tx,row,current)) return null;
    return subjectAllowed(admin.id,row.purpose,now()) ? { row, admin } : null;
  }

  async function beginRegistration({ grant, browserToken } = {}) {
    const policy = passkeyPolicy(env);
    if (!enabledHere() || !policy.operational) return DISABLED;
    return store.transaction(async tx => {
      const current = now(), found = await authorizedGrant(tx, grant, browserToken, current);
      if (!found || found.row.state !== 'issued' && !(found.row.reusable===true&&found.row.purpose==='enroll'&&found.row.selfSessionId&&found.row.state==='started')) return INVALID;
      const { row, admin } = found, challenge = randomBytes(32).toString('base64url');
      row.challengeHash = sha256(challenge); row.state = 'started';
      await tx.saveGrant(row);
      const existing = await tx.credentials(admin.id);
      return { ok: true, purpose: row.purpose, options: { challenge,
        rp: { name: 'Shiloh', id: policy.rpId }, user: registrationUser(admin),
        pubKeyCredParams: [{ type:'public-key', alg:-7 }, { type:'public-key', alg:-8 }, { type:'public-key', alg:-257 }],
        timeout: Math.max(1, new Date(row.expiresAt) - current), attestation: 'none',
        authenticatorSelection: { authenticatorAttachment:'platform', residentKey:'required', requireResidentKey:true, userVerification:'required' },
        excludeCredentials: existing.map(c => ({ type:'public-key', id:c.credential_id })) } };
    });
  }

  async function finishRegistration({ grant, browserToken, response, deviceLabel } = {}) {
    const policy = passkeyPolicy(env);
    if (!enabledHere() || !policy.operational) return DISABLED;
    return store.transaction(async tx => {
      const current = now(), found = await authorizedGrant(tx, grant, browserToken, current);
      if (!found || found.row.state !== 'started') return INVALID;
      const { row, admin } = found;
      row.state = row.reusable===true&&row.purpose==='enroll'&&row.selfSessionId?'issued':'consumed'; await tx.saveGrant(row);
      let verified;
      try {
        const data = JSON.parse(fromB64url(response?.response?.clientDataJSON,16384).toString('utf8'));
        if (!tokenValid(data.challenge) || sha256(data.challenge) !== row.challengeHash) return INVALID;
        verified = verifyRegistrationResponse(response, { expectedChallenge:data.challenge, origin:policy.origin, rpId:policy.rpId });
      } catch (_) { return INVALID; }
      if (!subjectAllowed(admin.id,row.purpose,now())) return INVALID;
      const result = await tx.completePasskey({ admin, verified, purpose:row.purpose, current, deviceLabel });
      if (!result?.ok) return INVALID;
      await tx.audit({ event:'workspace_whatsapp_passkey_completed', adminId:admin.id, operatorId:row.operatorId, purpose:row.purpose, at:current });
      return result;
    });
  }

  return { enabled: enabledHere, fallbackEnabled, begin, requestOwnEnrollment, requestSmsFallback, dispatchOne, verify, requestSetup, inspectSetup, approveSetup, admitRequest, beginRegistration, finishRegistration };
}

module.exports = { createWorkspaceWhatsAppAuth, MAX_ATTEMPTS, validWorkspaceBudgets };
