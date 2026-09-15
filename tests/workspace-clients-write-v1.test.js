const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CLIENT_MANAGE_CAPABILITY,
  ORIGIN,
  EVENT_TYPES,
  WorkspaceClientMutationError,
  evaluateClientManageAuthority,
  requireRequestId,
  requireExpectedRevision,
  clientRevision,
  mobileIdentityEvidence,
  mutationFingerprint,
  normalizeRequestedProfile,
  sameClientProfile,
} = require('../src/services/workspaceClientMutations');

function principal(overrides = {}) {
  return {
    id: 41,
    staff_id: 7,
    display_name: 'Synthetic Operator',
    business_role: 'business_admin',
    permissions: { 'client:lookup': true, 'client:manage': true },
    admin_active: true,
    staff_status: 'active',
    ...overrides,
  };
}

function client(overrides = {}) {
  return {
    id: 912,
    name: 'Synthetic Client',
    normalized_mobile: '27821234567',
    date_of_birth: '1994-02-18',
    gender: 'female',
    profile_status: 'registered',
    mobile_verified_at: '2026-08-28T10:00:00.000Z',
    source: 'staff',
    status: 'active',
    updated_at: '2026-09-08T10:00:00.000Z',
    ...overrides,
  };
}

test('client:manage is independent, explicit, active-principal authority', () => {
  const allowed = evaluateClientManageAuthority([principal()]);
  assert.equal(allowed.capability, CLIENT_MANAGE_CAPABILITY);
  assert.equal(allowed.operatorAdminId, 41);
  assert.deepEqual(allowed.clientScope, { kind: 'clinic', ownerStaffId: null });
  assert.equal(evaluateClientManageAuthority([principal({ permissions: { 'client:lookup': true } })]), null);
  assert.equal(evaluateClientManageAuthority([principal({ admin_active: false })]), null);
  assert.equal(evaluateClientManageAuthority([principal({ staff_status: 'inactive' })]), null);
  assert.equal(evaluateClientManageAuthority([principal(), principal({ id: 42 })]), null);
});

test('request identifiers and optimistic revisions are strictly bounded', () => {
  assert.equal(requireRequestId('clientop_123456'), 'clientop_123456');
  assert.throws(() => requireRequestId('short'), WorkspaceClientMutationError);
  const revision = 'a'.repeat(64);
  assert.equal(requireExpectedRevision(revision.toUpperCase()), revision);
  assert.throws(() => requireExpectedRevision('not-a-revision'), WorkspaceClientMutationError);
});

test('profile normalization reuses canonical CRM V2 rules and rejects invalid profile data', () => {
  assert.deepEqual(normalizeRequestedProfile({
    name: '  Synthetic   Client ',
    mobile: '082 123 4567',
    dateOfBirth: '1994-02-18',
    gender: 'Female',
  }), {
    name: 'Synthetic Client',
    normalizedMobile: '27821234567',
    dateOfBirth: '1994-02-18',
    gender: 'female',
  });
  assert.throws(() => normalizeRequestedProfile({ name: 'Synthetic Client', mobile: '0821234567', dateOfBirth: '2099-01-01', gender: 'female' }), /date of birth/i);
  assert.throws(() => normalizeRequestedProfile({ name: 'Synthetic Client', mobile: '0821234567', dateOfBirth: '1994-02-18', gender: 'invented' }), /gender/i);
  assert.throws(() => normalizeRequestedProfile({ name: 'Synthetic Client', mobile: '123', dateOfBirth: '1994-02-18', gender: 'female' }), /mobile/i);
});

test('semantic no-op edit is detected before CRM mutation and preserves the exact revision', () => {
  const current = client();
  const requested = normalizeRequestedProfile({
    name: ' Synthetic Client ',
    mobile: '+27 82 123 4567',
    dateOfBirth: '1994-02-18',
    gender: 'female',
  });
  assert.equal(sameClientProfile(current, requested), true);
  const before = clientRevision(current);
  assert.equal(clientRevision({ ...current }), before);
  assert.equal(before.length, 64);
  assert.equal(sameClientProfile(current, { ...requested, name: 'Changed Client' }), false);
});

test('mobile audit evidence is privacy-safe and deterministic', () => {
  const evidence = mobileIdentityEvidence('082 123 4567');
  assert.match(evidence, /^[a-f0-9]{64}$/);
  assert.equal(evidence, mobileIdentityEvidence('+27 82 123 4567'));
  assert.doesNotMatch(evidence, /27821234567|0821234567/);
  assert.equal(mobileIdentityEvidence('invalid'), null);
});

test('mutation replay fingerprint is deterministic and operation-bound', () => {
  const payload = { clientId: 912, name: 'Synthetic Client' };
  const first = mutationFingerprint('update', payload);
  assert.equal(first, mutationFingerprint('update', payload));
  assert.notEqual(first, mutationFingerprint('archive', payload));
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('bounded mutation implementation retains transaction, replay, audit and relationship-only archive invariants', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'workspaceClientMutations.js'), 'utf8');
  assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /WORKSPACE_CLIENT_REPLAY_MISMATCH/);
  assert.match(source, /staff_auth_security_events/);
  assert.match(source, /origin:\s*ORIGIN/);
  assert.match(source, /beforeRevision/);
  assert.match(source, /afterRevision/);
  assert.match(source, /mobileVerificationReset/);
  assert.match(source, /UPDATE crm_v2_client_relationships/);
  assert.match(source, /canonicalClientPreserved:\s*true/);
  assert.match(source, /otherRelationshipsPreserved:\s*true/);
  assert.match(source, /hardDelete:\s*false/);
  assert.doesNotMatch(source, /crm\.archiveClient/);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+crm_v2_clients/i);
  assert.deepEqual(EVENT_TYPES, {
    create: 'workspace_client_created',
    update: 'workspace_client_updated',
    archive: 'workspace_client_archived',
  });
  assert.equal(ORIGIN, 'workspace.clients');
});

test('Workspace mutation router is private, same-origin, session and CSRF guarded with a strict operation whitelist', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'workspaceClientMutations.js'), 'utf8');
  assert.match(source, /const mutationChain = \[sameOrigin, requireSession, requireCsrf\]/);
  assert.match(source, /router\.post\('\/create'/);
  assert.match(source, /router\.post\('\/:id\/update'/);
  assert.match(source, /router\.post\('\/:id\/archive'/);
  assert.doesNotMatch(source, /router\.(?:put|patch|delete)\s*\(/i);
  assert.match(source, /strictBody\(req\.body, \['requestId', 'name', 'mobile'\]\)/);
  assert.match(source, /strictBody\(req\.body, \['requestId', 'expectedRevision'\]\)/);
  assert.doesNotMatch(source, /adminId\s*:\s*req\.body|operatorAdminId\s*:\s*req\.body/);
});

test('migration grants only active owner/business-admin principals and contains no person-specific authority', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '106_workspace_clients_manage_capability.sql'), 'utf8');
  assert.match(migration, /"client:manage":true/);
  assert.match(migration, /business_role IN \('owner', 'business_admin'\)/);
  assert.match(migration, /active = TRUE/);
  assert.doesNotMatch(migration, /Christel|JP|Naomi|ILince|Abigail|Marietjie/i);
  assert.doesNotMatch(migration, /client:delete|DELETE\s+FROM/i);
});
