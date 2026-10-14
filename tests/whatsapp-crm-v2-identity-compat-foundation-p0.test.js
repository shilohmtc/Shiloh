const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  IDENTITY_CONTRACT_VERSION,
  IDENTITY_MODELS,
  WhatsAppIdentityContractError,
  createLegacyIdentity,
  createCrmV2Identity,
  identityFromSession,
  sessionIdentityColumns,
  identityAuditMetadata,
  createWhatsAppCrmV2IdentityCompatService,
} = require('../src/services/whatsappCrmV2IdentityCompat');
const { createCrmV2ClientService, CrmV2Error } = require('../src/services/crmV2ClientService');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function crmV2Row(id = 912, mobile = '27821234567') {
  return {
    id,
    name: 'Synthetic Client',
    normalized_mobile: mobile,
    date_of_birth: null,
    gender: null,
    profile_status: 'minimal',
    mobile_verified_at: null,
    source: 'staff',
    status: 'active',
    provenance: { fixture: true },
    created_at: '2026-08-28T10:00:00.000Z',
    updated_at: '2026-08-28T10:00:00.000Z',
  };
}

function exactResolverResult(status, id = 912) {
  if (status === 'found') return { status, client: { id: String(id), normalizedMobile: '27821234567' } };
  if (status === 'conflict') return { status, normalizedMobile: '27821234567', clientIds: ['912', '913'] };
  return { status: 'not_found', normalizedMobile: '27821234567' };
}

test('086 is an additive zero-backfill migration with no retained-row DML', () => {
  const sql = read('migrations/086_whatsapp_crm_v2_identity_compat.sql');
  assert.match(sql, /ALTER TABLE client_onboarding_sessions/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS crm_v2_client_id BIGINT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS identity_model TEXT/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|CONSTRAINT)|TRUNCATE/i);
});

test('086 references the canonical CRM V2 master with ON DELETE RESTRICT', () => {
  const sql = read('migrations/086_whatsapp_crm_v2_identity_compat.sql');
  assert.match(sql, /crm_v2_client_id BIGINT\s+REFERENCES crm_v2_clients\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /crm_v2_client_id[\s\S]{0,100}ON DELETE (?:CASCADE|SET NULL)/);
});

test('086 enforces no dual master and a strict durable discriminator without backfilling retained rows', () => {
  const sql = read('migrations/086_whatsapp_crm_v2_identity_compat.sql');
  assert.match(sql, /CHECK \(num_nonnulls\(client_id, crm_v2_client_id\) <= 1\)/);
  assert.match(sql, /client_id IS NOT NULL AND crm_v2_client_id IS NULL AND identity_model = 'legacy'/);
  assert.match(sql, /client_id IS NULL AND crm_v2_client_id IS NOT NULL AND identity_model = 'crm_v2'/);
  assert.match(sql, /client_onboarding_sessions_identity_model_check[\s\S]*NOT VALID/);
});

test('production startup still verifies 086 before traffic and now reports registration active', () => {
  const app = read('app.js');
  const migration = app.indexOf('verifyMigrationState()');
  const listen = app.indexOf('app.listen(PORT');
  assert.ok(migration >= 0 && listen > migration);
  assert.doesNotMatch(app, /applyMigrationFile/);
  assert.match(app, /identityContractVersion: 'whatsapp_crm_identity_compat_v1'/);
  assert.match(app, /crmV2RegistrationActive: true/);
});

test('legacy identities are tagged and cannot carry a CRM V2 id', () => {
  const identity = createLegacyIdentity(101, { provenance: 'retained_legacy_test' });
  assert.deepEqual(identity, {
    contractVersion: IDENTITY_CONTRACT_VERSION,
    identityModel: IDENTITY_MODELS.LEGACY,
    legacyClientId: '101',
    crmV2ClientId: null,
    provenance: 'retained_legacy_test',
  });
  assert.equal(Object.isFrozen(identity), true);
});

test('CRM V2 identities are tagged and cannot carry a legacy id', () => {
  const identity = createCrmV2Identity('912');
  assert.deepEqual(identity, {
    contractVersion: IDENTITY_CONTRACT_VERSION,
    identityModel: IDENTITY_MODELS.CRM_V2,
    legacyClientId: null,
    crmV2ClientId: '912',
    provenance: 'crm_v2_exact_mobile',
  });
});

test('identity ids must be positive canonical ids', () => {
  for (const value of [null, '', '0', '-1', '1.5', 'client-1']) {
    assert.throws(() => createLegacyIdentity(value), WhatsAppIdentityContractError);
    assert.throws(() => createCrmV2Identity(value), WhatsAppIdentityContractError);
  }
});

test('retained pre-086 legacy sessions remain readable without a backfill', () => {
  const identity = identityFromSession({ client_id: 101, crm_v2_client_id: null, identity_model: null });
  assert.equal(identity.identityModel, 'legacy');
  assert.equal(identity.legacyClientId, '101');
  assert.equal(identity.provenance, 'retained_pre_086_legacy_session');
});

test('new durable legacy and CRM V2 sessions resolve through the discriminator', () => {
  assert.equal(identityFromSession({ client_id: 101, identity_model: 'legacy' }).identityModel, 'legacy');
  assert.equal(identityFromSession({ crm_v2_client_id: 912, identity_model: 'crm_v2' }).identityModel, 'crm_v2');
});

test('dual legacy and CRM V2 ownership fails closed', () => {
  assert.throws(
    () => identityFromSession({ client_id: 101, crm_v2_client_id: 912, identity_model: 'legacy' }),
    (error) => error.code === 'WHATSAPP_IDENTITY_DUAL_MASTER'
  );
});

test('identity discriminator drift fails closed', () => {
  assert.throws(
    () => identityFromSession({ client_id: 101, identity_model: 'crm_v2' }),
    (error) => error.code === 'WHATSAPP_IDENTITY_DISCRIMINATOR_MISMATCH'
  );
  assert.throws(
    () => identityFromSession({ crm_v2_client_id: 912, identity_model: null }),
    (error) => error.code === 'WHATSAPP_IDENTITY_DISCRIMINATOR_MISMATCH'
  );
});

test('unbound collection state is represented without inventing a master', () => {
  assert.equal(identityFromSession({ client_id: null, crm_v2_client_id: null, identity_model: null }), null);
  assert.throws(
    () => identityFromSession({ client_id: null, crm_v2_client_id: null, identity_model: 'legacy' }),
    (error) => error.code === 'WHATSAPP_IDENTITY_DISCRIMINATOR_MISMATCH'
  );
});

test('session projection writes exactly one master column for each bound model', () => {
  assert.deepEqual(sessionIdentityColumns(createLegacyIdentity(101)), {
    clientId: '101', crmV2ClientId: null, identityModel: 'legacy',
  });
  assert.deepEqual(sessionIdentityColumns(createCrmV2Identity(912)), {
    clientId: null, crmV2ClientId: '912', identityModel: 'crm_v2',
  });
  assert.deepEqual(sessionIdentityColumns(null), {
    clientId: null, crmV2ClientId: null, identityModel: null,
  });
});

test('identity audit metadata carries the contract, discriminator, provenance and no-dual-master assertion', () => {
  assert.deepEqual(identityAuditMetadata(createCrmV2Identity(912), { resolution: 'crm_v2_restart_exact_mobile' }), {
    identityContractVersion: 'whatsapp_crm_identity_compat_v1',
    identityModel: 'crm_v2',
    legacyClientId: null,
    crmV2ClientId: '912',
    identityResolution: 'crm_v2_restart_exact_mobile',
    dualMaster: false,
  });
});

test('CRM V2 compatibility resolution delegates to canonical exact South African mobile semantics', async () => {
  const normalizedLookups = [];
  const canonicalService = createCrmV2ClientService({
    repository: {
      async findActiveByNormalizedMobile(mobile) {
        normalizedLookups.push(mobile);
        return [crmV2Row()];
      },
    },
  });
  const compat = createWhatsAppCrmV2IdentityCompatService({
    resolveCrmV2ExactMobile: canonicalService.resolveExactMobile,
  });
  const result = await compat.resolveCrmV2ByExactMobile('+27 (82) 123-4567');
  assert.equal(result.status, 'resolved');
  assert.equal(result.identity.crmV2ClientId, '912');
  assert.deepEqual(normalizedLookups, ['27821234567']);
});

test('invalid or non-South-African mobile never reaches CRM V2 ownership lookup', async () => {
  let lookupCalled = false;
  const canonicalService = createCrmV2ClientService({
    repository: {
      async findActiveByNormalizedMobile() { lookupCalled = true; return []; },
    },
  });
  const compat = createWhatsAppCrmV2IdentityCompatService({ resolveCrmV2ExactMobile: canonicalService.resolveExactMobile });
  await assert.rejects(() => compat.resolveCrmV2ByExactMobile('+1 212 555 0100'), CrmV2Error);
  assert.equal(lookupCalled, false);
});

test('not-found and ambiguous exact-mobile V2 resolution remain unbound', async () => {
  for (const status of ['not_found', 'conflict']) {
    const compat = createWhatsAppCrmV2IdentityCompatService({
      resolveCrmV2ExactMobile: async () => exactResolverResult(status),
    });
    const result = await compat.resolveCrmV2ByExactMobile('27821234567');
    assert.equal(result.status, status);
    assert.equal(result.identity, null);
    assert.equal(result.client, null);
  }
});

test('legacy restart compatibility is deterministic and never queries CRM V2', async () => {
  let v2Calls = 0;
  const compat = createWhatsAppCrmV2IdentityCompatService({
    resolveCrmV2ExactMobile: async () => { v2Calls += 1; return exactResolverResult('found'); },
  });
  const result = await compat.revalidateSessionIdentity({
    phone: '27821234567',
    session: { client_id: 101, identity_model: null },
  });
  assert.equal(result.status, 'legacy_compatible');
  assert.equal(result.resumable, true);
  assert.equal(result.identity.provenance, 'retained_pre_086_legacy_session');
  assert.equal(v2Calls, 0);
});

test('CRM V2 restart resumes only when exact mobile still resolves to the same canonical id', async () => {
  const compat = createWhatsAppCrmV2IdentityCompatService({
    resolveCrmV2ExactMobile: async () => exactResolverResult('found', 912),
  });
  const result = await compat.revalidateSessionIdentity({
    phone: '27821234567',
    session: { crm_v2_client_id: 912, identity_model: 'crm_v2' },
  });
  assert.equal(result.status, 'crm_v2_current');
  assert.equal(result.resumable, true);
  assert.equal(result.identity.crmV2ClientId, '912');
});

test('CRM V2 restart fails closed when exact mobile resolves to a different canonical id', async () => {
  const compat = createWhatsAppCrmV2IdentityCompatService({
    resolveCrmV2ExactMobile: async () => exactResolverResult('found', 913),
  });
  const result = await compat.revalidateSessionIdentity({
    phone: '27821234567',
    session: { crm_v2_client_id: 912, identity_model: 'crm_v2' },
  });
  assert.equal(result.status, 'crm_v2_stale');
  assert.equal(result.resumable, false);
  assert.equal(result.actualCrmV2ClientId, '913');
  assert.equal(result.recovery, 'manual_rebind_required');
});

test('CRM V2 restart fails closed when exact mobile is missing or ambiguous', async () => {
  for (const [exactStatus, expected] of [['not_found', 'crm_v2_stale'], ['conflict', 'crm_v2_conflict']]) {
    const compat = createWhatsAppCrmV2IdentityCompatService({
      resolveCrmV2ExactMobile: async () => exactResolverResult(exactStatus),
    });
    const result = await compat.revalidateSessionIdentity({
      phone: '27821234567',
      session: { crm_v2_client_id: 912, identity_model: 'crm_v2' },
    });
    assert.equal(result.status, expected);
    assert.equal(result.resumable, false);
    assert.equal(result.recovery, 'manual_rebind_required');
  }
});

test('onboarding persistence reads and writes both identity columns and the discriminator', () => {
  const onboarding = read('src/services/clientIdentityOnboarding.js');
  assert.match(onboarding, /ONBOARDING_SESSION_PROJECTION = `phone,client_id,crm_v2_client_id,identity_model,state/);
  assert.match(onboarding, /SELECT \$\{ONBOARDING_SESSION_PROJECTION\} FROM client_onboarding_sessions/);
  assert.match(onboarding, /INSERT INTO client_onboarding_sessions \(phone,client_id,crm_v2_client_id,identity_model,state/);
  assert.match(onboarding, /RETURNING \$\{ONBOARDING_SESSION_PROJECTION\}/);
  assert.match(onboarding, /client_id=EXCLUDED\.client_id,crm_v2_client_id=EXCLUDED\.crm_v2_client_id,identity_model=EXCLUDED\.identity_model/);
  assert.match(onboarding, /identityFromSession\(\{\s*client_id: candidateClientId,\s*crm_v2_client_id: candidateCrmV2ClientId/);
});

test('retained legacy onboarding completes only an already-bound legacy client', () => {
  const onboarding = read('src/services/clientIdentityOnboarding.js');
  assert.doesNotMatch(onboarding, /INSERT INTO clients \(date_of_birth,custom_attributes,source\)/);
  assert.match(onboarding, /INSERT INTO client_contacts \(client_id,contact_type,value,normalized_value,is_primary,verified_at\)/);
  assert.match(onboarding, /UPDATE client_onboarding_sessions SET client_id=\$2,state='complete',authority_version=\$3,crm_v2_client_id=NULL,identity_model='legacy'/);
  assert.match(onboarding, /createLegacyIdentity\(client\.id, \{ provenance: "legacy_whatsapp_registration" \}\)/);
});

test('legacy repair writes the same exclusive durable discriminator', () => {
  const repair = read('src/services/identityRepair.js');
  assert.match(repair, /SET client_id = \$2,\s*crm_v2_client_id = NULL,\s*identity_model = 'legacy'/);
});

test('V2 registration is active and cannot fall through to legacy creation', () => {
  const onboarding = read('src/services/clientIdentityOnboarding.js');
  const completion = onboarding.indexOf('async function completeCrmV2Onboarding');
  const registration = onboarding.indexOf('await registrationBoundary', completion);
  const persistence = onboarding.indexOf('const persisted = await persistSession', completion);
  assert.ok(completion >= 0 && registration > completion && persistence > registration);
  assert.doesNotMatch(onboarding, /CRM_V2_WHATSAPP_REGISTRATION_INACTIVE/);
  assert.doesNotMatch(onboarding, /INSERT INTO clients \(date_of_birth,custom_attributes,source\)/);
  assert.match(onboarding, /identityStatus: revalidated\.status, resumeBooking: false/);
});

test('production onboarding calls the canonical CRM V2 registration boundary without a shadow master', () => {
  const compat = read('src/services/whatsappCrmV2IdentityCompat.js');
  const onboarding = read('src/services/clientIdentityOnboarding.js');
  assert.match(compat, /resolveExactMobile: resolveCanonicalCrmV2ExactMobile/);
  assert.doesNotMatch(compat, /registerWhatsAppClient|createClient|completeRegistration/);
  assert.match(onboarding, /registerWhatsAppClient/);
  assert.doesNotMatch(onboarding, /INSERT INTO (?:clients|crm_v2_clients) \(/);
  assert.doesNotMatch(compat, /INSERT INTO (?:clients|crm_v2_clients|client_contacts)/);
});

test('legacy authority audit records the discriminated identity contract and V2 recovery returns audit provenance', () => {
  const onboarding = read('src/services/clientIdentityOnboarding.js');
  assert.match(onboarding, /client\.identity_verified/);
  assert.match(onboarding, /identity: identityAuditMetadata\(completedIdentity, \{ resolution: "legacy_whatsapp_registration" \}\)/);
  assert.match(onboarding, /identityAudit: revalidated\.audit/);
});

test('the identity foundation introduces no provider, booking, approval, appointment, package or enquiry mutation', () => {
  const compat = read('src/services/whatsappCrmV2IdentityCompat.js');
  const migration = read('migrations/086_whatsapp_crm_v2_identity_compat.sql');
  assert.doesNotMatch(compat, /axios|fetch\(|sendMessage|sendWhatsApp|provider|appointments|bookings|packages|enquiries/i);
  assert.doesNotMatch(migration, /ALTER TABLE (?:appointments|bookings|customer_message_deliveries)/i);
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM) (?:appointments|bookings|clients|crm_v2_clients)/i);
});

test('booking consumers keep using the centralized discriminated compatibility seam after activation', () => {

  const commit = read('src/services/clientBookingCommit.js');
  const bookingIdentity = read('src/services/whatsappBookingIdentity.js');

  assert.match(commit, /resolveFinalBookingIdentity/);
  assert.match(commit, /crm_v2_client_id/);
  assert.match(bookingIdentity, /identityFromSession/);

  assert.doesNotMatch(`${commit}\n${bookingIdentity}`, /registerWhatsAppClient/);
});
