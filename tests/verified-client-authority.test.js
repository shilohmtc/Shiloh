const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  classifyCandidateAuthority,
  resolveVerifiedClientByWhatsApp,
} = require('../src/services/clientVerifiedIdentity');

function candidate(overrides = {}) {
  return {
    id: 101,
    status: 'active',
    source: 'goldie_import',
    has_appointment_history: false,
    registration_status: null,
    profile_incomplete: null,
    verified_at: null,
    contact_id: 501,
    contact_ids: [501],
    contact_type: 'mobile',
    normalized_value: '27820000001',
    ...overrides,
  };
}

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function resolverDb({ active = [], inactive = [], controlledConfigured = false, verification = null } = {}) {
  return {
    async query(sql) {
      if (/AND c\.status = 'active'/.test(sql)) return { rowCount: active.length, rows: active };
      if (/AND c\.status <> 'active'/.test(sql)) return { rowCount: inactive.length, rows: inactive };
      if (/FROM controlled_demo_identities/.test(sql)) return { rowCount: controlledConfigured ? 1 : 0, rows: controlledConfigured ? [{ '?column?': 1 }] : [] };
      if (/FROM client_identity_verifications v/.test(sql)) return { rowCount: verification ? 1 : 0, rows: verification ? [verification] : [] };
      throw new Error(`Unexpected resolver query: ${sql}`);
    },
  };
}

test('genuinely verified canonical client requires explicit verification evidence', () => {
  const result = classifyCandidateAuthority(candidate({ source: 'whatsapp_onboarding' }), {
    verification: { id: 9, verification_method: 'whatsapp_registration', verified_at: '2026-08-22T10:00:00Z' },
  });
  assert.equal(result.status, 'verified_client');
  assert.equal(result.verificationMethod, 'whatsapp_registration');
});

test('imported-contact-only exact-phone candidate is claimable but unverified', () => {
  const result = classifyCandidateAuthority(candidate());
  assert.equal(result.status, 'claim_required');
  assert.equal(result.reason, 'imported_contact_unverified');
});

test('verified_at proxy alone is insufficient identity authority', () => {
  const result = classifyCandidateAuthority(candidate({ verified_at: '2026-08-16T00:00:00Z' }));
  assert.equal(result.status, 'claim_required');
});

test('imported appointment history no longer forces the clinic-verification dead end', () => {
  const result = classifyCandidateAuthority(candidate({ has_appointment_history: true }));
  assert.equal(result.status, 'claim_required');
  assert.equal(result.reason, 'imported_contact_unverified');
});

test('non-imported historical client without explicit evidence remains fail-closed', () => {
  const result = classifyCandidateAuthority(candidate({ source: 'whatsapp_onboarding', has_appointment_history: true }));
  assert.equal(result.status, 'historical_unverified');
  assert.equal(result.reason, 'history_without_explicit_verification');
});

test('verified imported historical client remains verified and is not forced to register again', () => {
  const result = classifyCandidateAuthority(candidate({ has_appointment_history: true }), {
    verification: { id: 10, verification_method: 'imported_claim_registration', verified_at: '2026-08-23T10:00:00Z' },
  });
  assert.equal(result.status, 'verified_client');
  assert.equal(result.verificationMethod, 'imported_claim_registration');
});

test('active exact-phone candidate behavior remains first and unchanged', async () => {
  const active = candidate();
  const db = resolverDb({ active: [active] });
  const result = await resolveVerifiedClientByWhatsApp('27820000001', db);
  assert.equal(result.status, 'claim_required');
  assert.equal(result.reason, 'imported_contact_unverified');
  assert.equal(result.client.id, 101);
});

test('multiple active exact-phone candidates remain ambiguous before any archive fallback', async () => {
  const db = resolverDb({ active: [candidate({ id: 101 }), candidate({ id: 202, contact_id: 502, contact_ids: [502] })] });
  const result = await resolveVerifiedClientByWhatsApp('27820000001', db);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'multiple_active_clients_for_exact_phone');
  assert.equal(result.clients.length, 2);
});

test('unique archived goldie_import candidate is discoverable only when no active candidate exists', async () => {
  const archived = candidate({ status: 'archived' });
  const db = resolverDb({ inactive: [archived] });
  const result = await resolveVerifiedClientByWhatsApp('27820000001', db);
  assert.equal(result.status, 'claim_required');
  assert.equal(result.reason, 'archived_imported_contact_unverified');
  assert.equal(result.reclaimRequired, true);
  assert.equal(result.client.id, 101);
  assert.equal(result.client.status, 'archived');
});

test('multiple archived/non-active exact-phone owners fail closed', async () => {
  const db = resolverDb({ inactive: [candidate({ status: 'archived' }), candidate({ id: 202, status: 'archived', contact_id: 502, contact_ids: [502] })] });
  const result = await resolveVerifiedClientByWhatsApp('27820000001', db);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.reason, 'multiple_non_active_clients_for_exact_phone');
});

test('non-imported or unsupported non-active exact-phone owner fails closed instead of creating new identity', async () => {
  const db = resolverDb({ inactive: [candidate({ status: 'archived', source: 'whatsapp_onboarding' })] });
  const result = await resolveVerifiedClientByWhatsApp('27820000001', db);
  assert.equal(result.status, 'manual_review');
  assert.equal(result.reason, 'non_reclaimable_exact_phone_owner');
});

test('archived imported client with active durable verification is an inconsistency and fails closed', async () => {
  const db = resolverDb({
    inactive: [candidate({ status: 'archived' })],
    verification: { id: 77, verification_method: 'imported_claim_registration', verified_at: '2026-08-23T10:00:00Z' },
  });
  const result = await resolveVerifiedClientByWhatsApp('27820000001', db);
  assert.equal(result.status, 'manual_review');
  assert.equal(result.reason, 'archived_client_has_active_verification');
});

test('provisional client remains unverified until explicit evidence exists', () => {
  const result = classifyCandidateAuthority(candidate({ source: 'admin_provisional_booking', registration_status: 'provisional' }));
  assert.equal(result.status, 'provisional');
});

test('controlled Juvan binding remains an accepted independent explicit authority', () => {
  const result = classifyCandidateAuthority(candidate({ id: 77, source: 'whatsapp_demo' }), {
    controlled: { status: 'bound', client: { id: 77 } },
  });
  assert.equal(result.status, 'verified_client');
  assert.equal(result.verificationMethod, 'controlled_demo_binding');
});

test('controlled Juvan drift/conflict fails closed', () => {
  const result = classifyCandidateAuthority(candidate({ id: 77 }), {
    controlled: { status: 'identity_conflict', client: { id: 77 } },
  });
  assert.equal(result.status, 'manual_review');
});

test('archive fallback explicitly checks controlled authority before selecting a non-active owner', () => {
  const resolver = source('src/services/clientVerifiedIdentity.js');
  const noActiveBlock = resolver.slice(resolver.indexOf('// A configured controlled-demo phone'));
  assert.match(noActiveBlock, /controlledAuthorityForPhone\(normalized, db\)/);
  assert.match(noActiveBlock, /status: 'manual_review'/);
  assert.ok(noActiveBlock.indexOf('controlledAuthorityForPhone(normalized, db)') < noActiveBlock.indexOf('nonActiveExactPhoneOwners(normalized, db)'));
});

test('imported DOB and gender are not seeded into a fresh archive-aware claim session', () => {
  const onboarding = source('src/services/clientIdentityOnboarding.js');
  assert.match(onboarding, /pendingName:\s*null/);
  assert.match(onboarding, /pendingDateOfBirth:\s*null/);
  assert.match(onboarding, /pendingGender:\s*null/);
  assert.doesNotMatch(onboarding, /pendingDateOfBirth:\s*known\?\.date_of_birth/);
  assert.doesNotMatch(onboarding, /pendingGender:\s*known\?\.gender/);
  assert.match(onboarding, /clientId:\s*known\?\.id \|\| null/);
});

test('archive-aware completion locks same canonical client and preserves provenance/history while name promotion owns the display-name projection', () => {
  const onboarding = source('src/services/clientIdentityOnboarding.js');
  assert.match(onboarding, /const clientId = durableIdentity\.legacyClientId/);
  assert.match(onboarding, /SELECT id,source,status FROM clients WHERE id=\$1 FOR UPDATE/);
  assert.match(onboarding, /canonicalClient\.status === "archived"/);
  assert.match(onboarding, /clientSource !== "goldie_import"/);
  assert.match(onboarding, /UPDATE clients SET status='active',date_of_birth=\$2::date/);
  assert.match(onboarding, /promoteClientFacingNameInTransaction/);
  assert.match(onboarding, /EVIDENCE_TYPES\.VERIFIED_REGISTRATION_INTAKE/);
  assert.doesNotMatch(onboarding, /UPDATE clients SET status='active',display_name/);
  assert.doesNotMatch(onboarding, /UPDATE clients SET[^`]*source\s*=/s);
  assert.doesNotMatch(onboarding, /(?:UPDATE|DELETE FROM) appointments/i);
});

test('retained legacy completion revalidates exact-phone ownership and cannot create a new legacy master', () => {
  const onboarding = source('src/services/clientIdentityOnboarding.js');
  const contactLock = onboarding.indexOf("SELECT id,client_id,contact_type FROM client_contacts WHERE normalized_value=$1");
  const reactivate = onboarding.indexOf("UPDATE clients SET status='active'");
  assert.ok(contactLock >= 0 && reactivate >= 0 && contactLock < reactivate);
  assert.match(onboarding, /contacts\.rows\.some\(\(row\) => String\(row\.client_id\) !== String\(clientId\)\)/);
  assert.match(onboarding, /LEGACY_ONBOARDING_IDENTITY_REQUIRED/);
  assert.doesNotMatch(onboarding, /INSERT INTO clients \(date_of_birth,custom_attributes,source\)/);
  assert.match(onboarding, /AMBIGUOUS_CONTACT/);
});

test('archived completion revalidates durable verification and controlled identity before status change', () => {
  const onboarding = source('src/services/clientIdentityOnboarding.js');
  assert.match(onboarding, /controlledAuthorityForPhone\(key, db\)/);
  assert.match(onboarding, /SELECT id FROM client_identity_verifications WHERE client_id=\$1 AND status='active'/);
  assert.match(onboarding, /Archived canonical client already has active durable verification authority/);
});

test('fresh imported registration writes explicit verification evidence and audit metadata on retained client', () => {
  const onboarding = source('src/services/clientIdentityOnboarding.js');
  assert.match(onboarding, /verificationMethod = clientSource === "goldie_import" \? "imported_claim_registration" : "whatsapp_registration"/);
  assert.match(onboarding, /INSERT INTO client_identity_verifications \(client_id,client_contact_id,verification_method,status,verified_at,evidence_reference\)/);
  assert.match(onboarding, /reactivatedFromStatus/);
  assert.match(onboarding, /client\.identity_verified/);
  assert.match(onboarding, /UPDATE client_onboarding_sessions SET client_id=\$2,state='complete',authority_version=\$3/);
});

test('failed/conflicting completion remains transactionally rollback-safe and cannot leave archived client active', () => {
  const onboarding = source('src/services/clientIdentityOnboarding.js');
  assert.match(onboarding, /await db\.query\("BEGIN"\)/);
  assert.match(onboarding, /UPDATE clients SET status='active'/);
  assert.match(onboarding, /catch \(error\) \{\s*await db\.query\("ROLLBACK"\);\s*throw error;/s);
  assert.match(onboarding, /await db\.query\("COMMIT"\)/);
});

test('premium welcome exact-once delivery state is not mutated by reclaim implementation', () => {
  const onboarding = source('src/services/clientIdentityOnboarding.js');
  const resolver = source('src/services/clientVerifiedIdentity.js');
  assert.doesNotMatch(onboarding, /(?:INSERT INTO|UPDATE|DELETE FROM) client_whatsapp_welcome_deliveries/i);
  assert.doesNotMatch(resolver, /(?:INSERT INTO|UPDATE|DELETE FROM) client_whatsapp_welcome_deliveries/i);
  assert.match(onboarding, /const PREMIUM_GREETING = \[/);
});

test('Booking/Admin gate and final commit inherit the centralized discriminated resolver authority', () => {
  const onboarding = source('src/services/clientIdentityOnboarding.js');

  const commit = source('src/services/clientBookingCommit.js');
  const bookingIdentity = source('src/services/whatsappBookingIdentity.js');
  assert.match(onboarding, /resolveVerifiedClientByWhatsApp/);
  assert.match(onboarding, /status:\s*"unique",\s*authorityStatus:\s*"verified_client"/);

  assert.match(commit, /resolveWhatsAppBookingIdentity/);
  assert.match(bookingIdentity, /resolveVerifiedClientByWhatsApp/);
  assert.match(bookingIdentity, /revalidateSessionIdentity/);
});

test('forward migration 074 remains unchanged in role and has no trust backfill after later migrations', () => {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  assert.equal(files.filter((name) => name === '074_client_identity_verification_authority.sql').length, 1);
  assert.ok(files.indexOf('074_client_identity_verification_authority.sql') < files.indexOf('075_goldie_wave_a_customer_descriptions.sql'));
  const migration = source('migrations/074_client_identity_verification_authority.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS client_identity_verifications/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS authority_version/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+client_identity_verifications/i);
  assert.doesNotMatch(migration, /UPDATE\s+clients\s+SET/i);
});

test('production start uses one global read-only migration verifier before app startup', () => {
  const pkg = JSON.parse(source('package.json'));
  const start = pkg.scripts.start;
  const identity = start.indexOf('node scripts/verify-migrations.js');
  const app = start.lastIndexOf(' app.js');
  assert.ok(identity === 0 && app > identity);
  assert.doesNotMatch(start, /ensure-client-identity-verification|ensure-goldie-wave-a-publication/);
  const bootstrap = source('scripts/ensure-client-identity-verification.js');
  assert.match(bootstrap, /074_client_identity_verification_authority\.sql/);
  assert.match(bootstrap, /checksumVerified/);
  assert.match(bootstrap, /verifyMigrationFile/);
});
