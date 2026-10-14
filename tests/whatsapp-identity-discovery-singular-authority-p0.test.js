const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createWhatsAppBookingIdentityService,
} = require('../src/services/whatsappBookingIdentity');
const {
  createCrmV2Identity,
} = require('../src/services/whatsappCrmV2IdentityCompat');

const ROOT = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const onboarding = source('src/services/clientIdentityOnboarding.js');
const transition = source('src/services/clientTransitionWelcome.js');

function queryableSession(session) {
  return {
    async query() {
      return { rowCount: session ? 1 : 0, rows: session ? [structuredClone(session)] : [] };
    },
  };
}

test('legacy identity helpers retain the canonical resolver without historical appointment proof', () => {

  assert.match(transition, /resolveWhatsAppBookingIdentity\(phone\)/);
  assert.match(transition, /processClientIdentityMessage\(phone, text\)/);
});

test('a canonical CRM V2 returning identity is accepted without a secondary legacy lookup', async () => {
  let legacyCalls = 0;
  const identity = createCrmV2Identity(912);
  const client = {
    id: '912',
    name: 'Synthetic Client',
    normalizedMobile: '27821234567',
    profileStatus: 'registered',
    status: 'active',
  };
  const service = createWhatsAppBookingIdentityService({
    queryable: queryableSession({
      client_id: null,
      crm_v2_client_id: 912,
      identity_model: 'crm_v2',
      state: 'complete',
      authority_version: 'current',
    }),
    resolveLegacyAuthority: async () => {
      legacyCalls += 1;
      throw new Error('secondary legacy lookup must not run for durable CRM V2 authority');
    },
    crmV2Compat: {
      async revalidateSessionIdentity() {
        return { status: 'crm_v2_current', identity, client, audit: { identityModel: 'crm_v2' } };
      },
    },
  });

  const result = await service.resolveByPhone('+27 82 123 4567');
  assert.equal(result.status, 'unique');
  assert.equal(result.authorityStatus, 'crm_v2_current');
  assert.equal(result.clientIdentity.identityModel, 'crm_v2');
  assert.equal(result.clientIdentity.crmV2ClientId, '912');
  assert.equal(result.bookingReady, true);
  assert.equal(legacyCalls, 0);
});

test('explicitly verified legacy authority remains backward compatible', async () => {
  const canonicalClient = {
    id: 101,
    display_name: 'Verified Legacy',
    normalized_value: '27821234567',
    date_of_birth: '1990-05-14',
  };
  const service = createWhatsAppBookingIdentityService({
    queryable: queryableSession(null),
    resolveLegacyAuthority: async () => ({ status: 'verified_client', client: canonicalClient }),
  });

  const result = await service.resolveByPhone('27821234567');
  assert.equal(result.status, 'unique');
  assert.equal(result.authorityStatus, 'verified_client');
  assert.equal(result.clientIdentity.identityModel, 'legacy');
  assert.equal(result.clientIdentity.legacyClientId, '101');
  assert.equal(result.bookingReady, true);
});

test('genuine canonical ambiguity remains fail closed with no selected identity', async () => {
  const service = createWhatsAppBookingIdentityService({
    queryable: queryableSession(null),
    resolveLegacyAuthority: async () => ({
      status: 'ambiguous',
      reason: 'multiple_active_clients_for_exact_phone',
      clients: [{ id: 1 }, { id: 2 }],
    }),
  });

  const result = await service.resolveByPhone('27821234567');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.authorityStatus, 'ambiguous');
  assert.equal(result.clientIdentity, null);
  assert.equal(result.bookingReady, false);
});

test('historical appointment or imported-contact evidence cannot establish or override identity', async () => {
  const service = createWhatsAppBookingIdentityService({
    queryable: queryableSession(null),
    resolveLegacyAuthority: async () => ({
      status: 'historical_unverified',
      reason: 'history_without_explicit_verification',
      client: { id: 741, source: 'goldie_import', has_appointment_history: true },
      clients: [{ id: 741, source: 'goldie_import', has_appointment_history: true }],
    }),
  });

  const result = await service.resolveByPhone('27821234567');
  assert.equal(result.status, 'historical_unverified');
  assert.equal(result.clientIdentity, null);
  assert.equal(result.bookingReady, false);

  assert.match(onboarding, /const known = verifiedLegacyClient\(identity\)/);
  assert.match(onboarding, /identityStatus: "registration_required", client: null/);
  assert.match(onboarding, /crmV2Authority = await whatsappCrmV2IdentityCompat\.resolveCrmV2ByExactMobile\(phone\)/);
  assert.match(onboarding, /if \(manualReviewIdentity\(identity\)\)/);
});
