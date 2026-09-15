const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CLIENT_RELATIONSHIP_TYPES,
  scopeForPrincipal,
} = require('../src/services/clientRelationshipScope');
const {
  WorkspaceClientsError,
  evaluateClientReadAuthority,
  createWorkspaceClientsService,
} = require('../src/services/workspaceClients');
const {
  WorkspaceClientMutationError,
  evaluateClientManageAuthority,
  clientRelationshipRevision,
  createWorkspaceClientMutationService,
} = require('../src/services/workspaceClientMutations');
const {
  createWorkspaceCommunicationEvidenceService,
} = require('../src/services/workspaceCommunicationEvidence');

function result(rows = []) { return { rows, rowCount: rows.length }; }

function tenantPrincipal(overrides = {}) {
  return {
    id: 81,
    staff_id: 55,
    display_name: 'Marietjie',
    business_role: 'tenant_practitioner',
    permissions: { 'client:lookup': true, 'client:manage': true },
    admin_active: true,
    staff_status: 'active',
    ...overrides,
  };
}

function clinicPrincipal(overrides = {}) {
  return {
    id: 82,
    staff_id: null,
    display_name: 'Clinic Admin',
    business_role: 'business_admin',
    permissions: { 'client:lookup': true, 'client:manage': true },
    admin_active: true,
    staff_status: null,
    ...overrides,
  };
}

function canonicalClient(overrides = {}) {
  return {
    id: 701,
    name: 'Scoped Client',
    normalized_mobile: '27821234567',
    date_of_birth: '1990-05-14',
    gender: 'female',
    profile_status: 'registered',
    mobile_verified_at: '2026-09-10T09:00:00.000Z',
    source: 'staff',
    status: 'active',
    provenance: {},
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-14T08:00:00.000Z',
    ...overrides,
  };
}

test('127 keeps one canonical person and adds independent clinic/tenant client relationships', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '127_scoped_client_relationships.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS crm_v2_client_relationships/);
  assert.match(sql, /relationship_type IN \('clinic', 'tenant_staff'\)/);
  assert.match(sql, /UNIQUE INDEX[\s\S]*relationship_type='clinic'/);
  assert.match(sql, /UNIQUE INDEX[\s\S]*relationship_type='tenant_staff'/);
  assert.match(sql, /JOIN service_visibility_policies visibility/);
  assert.match(sql, /shiloh_sync_client_relationship_from_appointment_service/);
  assert.match(sql, /AFTER INSERT OR UPDATE OF service_id, appointment_id ON appointment_services/);
  assert.match(sql, /"client:manage":true/);
  assert.match(sql, /LOWER\(TRIM\(a\.display_name\)\)='marietjie'/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS crm_v2_clients/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+crm_v2_clients/i);
});

test('tenant client authority is linked to the practitioner while clinic authority stays clinic-scoped', () => {
  const tenantRead = evaluateClientReadAuthority([tenantPrincipal()]);
  const tenantManage = evaluateClientManageAuthority([tenantPrincipal()]);
  assert.deepEqual(tenantRead.clientScope, { kind: CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF, ownerStaffId: 55 });
  assert.deepEqual(tenantManage.clientScope, { kind: CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF, ownerStaffId: 55 });
  assert.equal(tenantRead.linkedStaffId, 55);
  assert.equal(tenantManage.linkedStaffId, 55);

  const clinicRead = evaluateClientReadAuthority([clinicPrincipal()]);
  assert.deepEqual(clinicRead.clientScope, { kind: CLIENT_RELATIONSHIP_TYPES.CLINIC, ownerStaffId: null });
  assert.deepEqual(scopeForPrincipal(clinicPrincipal()), { kind: 'clinic', ownerStaffId: null });

  assert.equal(evaluateClientReadAuthority([tenantPrincipal({ staff_id: null, staff_status: null })]), null);
  assert.equal(evaluateClientManageAuthority([tenantPrincipal({ staff_id: null, staff_status: null })]), null);
});

test('Workspace Clients passes tenant relationship scope into list/search reads', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes('workspaceClients:principal')) return result([tenantPrincipal()]);
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const readService = {
    inputs: [],
    async listClients(input) {
      this.inputs.push(input);
      return [canonicalClient()];
    },
  };
  const service = createWorkspaceClientsService({ db, readService, communicationService: { async listForClient() { return []; } } });
  const model = await service.listClients({ adminId: 81, q: ' Clinic only name ', status: 'active', offset: 0 });
  assert.equal(model.clients.length, 1);
  assert.deepEqual(readService.inputs[0].scope, { kind: 'tenant_staff', ownerStaffId: 55 });
  assert.equal(readService.inputs[0].q, 'Clinic only name');
});

test('crafted direct client URL outside Marietjie relationship stops before revision/history/communications', async () => {
  const dbCalls = [];
  const db = {
    async query(sql) {
      dbCalls.push(String(sql));
      if (String(sql).includes('workspaceClients:principal')) return result([tenantPrincipal()]);
      throw new Error('No subordinate database read should occur after scoped client miss');
    },
  };
  const reads = {
    calls: [],
    async getClient(id, options) {
      this.calls.push({ method: 'getClient', id, options });
      return null;
    },
    async getClientAppointments() {
      this.calls.push({ method: 'getClientAppointments' });
      throw new Error('history must not be reached');
    },
  };
  const communications = {
    calls: 0,
    async listForClient() { this.calls += 1; throw new Error('communications must not be reached'); },
  };
  const service = createWorkspaceClientsService({ db, readService: reads, communicationService: communications });
  await assert.rejects(
    service.getClientDetail({ adminId: 81, clientId: 999 }),
    error => error instanceof WorkspaceClientsError && error.code === 'WORKSPACE_CLIENT_NOT_FOUND' && error.httpStatus === 404
  );
  assert.deepEqual(reads.calls, [{ method: 'getClient', id: 999, options: { scope: { kind: 'tenant_staff', ownerStaffId: 55 } } }]);
  assert.equal(communications.calls, 0);
  assert.equal(dbCalls.filter(sql => sql.includes('workspaceClients:revision')).length, 0);
});

test('tenant communication history is appointment-scoped and never falls back to unscoped customer-care rows', async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      return result([]);
    },
  };
  const service = createWorkspaceCommunicationEvidenceService({ db });
  await service.listForClient({
    clientId: 701,
    waId: '27821234567',
    limit: 30,
    scope: { kind: 'tenant_staff', ownerStaffId: 55 },
  });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.sql, /service_visibility_policies/);
    assert.match(call.sql, /owner_staff_id=\$2/);
    assert.deepEqual(call.values, [701, 55, 30]);
  }
  assert.equal(calls.some(call => call.sql.includes('customerCare')), false);
});

test('tenant archive changes only Marietjie relationship and never globally archives the canonical client', async () => {
  const current = canonicalClient();
  const expectedRevision = clientRelationshipRevision(current, 'active');
  const calls = [];
  const query = async (sql, values = []) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: compact, values });
    if (compact === 'BEGIN ISOLATION LEVEL SERIALIZABLE' || compact === 'COMMIT' || compact === 'ROLLBACK') return result();
    if (compact.includes('FROM staff_admin_accounts')) return result([tenantPrincipal()]);
    if (compact.includes('pg_advisory_xact_lock')) return result([{}]);
    if (compact.includes('FROM staff_auth_security_events')) return result([]);
    if (compact.includes('workspaceClientMutations:relationship')) {
      return result([{ id: 901, client_id: 701, relationship_type: 'tenant_staff', owner_staff_id: 55, status: 'active', source: 'appointment_service' }]);
    }
    if (compact.includes('FROM crm_v2_clients') && compact.includes('WHERE id=$1')) return result([current]);
    if (compact.startsWith('UPDATE crm_v2_client_relationships')) return result();
    if (compact.startsWith('INSERT INTO staff_auth_security_events')) return result([{ id: 1 }]);
    throw new Error(`Unexpected SQL: ${compact}`);
  };
  const client = { query, release() {} };
  const service = createWorkspaceClientMutationService({ db: { query, async connect() { return client; } } });
  const outcome = await service.archiveClient({
    adminId: 81,
    clientId: 701,
    expectedRevision,
    requestId: 'tenant_archive_001',
  });
  assert.equal(outcome.status, 'archived');
  assert.equal(calls.some(call => /^UPDATE crm_v2_clients/i.test(call.sql)), false);
  assert.equal(calls.some(call => call.sql.startsWith('UPDATE crm_v2_client_relationships')), true);
  assert.equal(calls.some(call => /DELETE\s+FROM\s+crm_v2_clients/i.test(call.sql)), false);
});

test('tenant update outside relationship fails before canonical profile read or mutation', async () => {
  const calls = [];
  const query = async (sql, values = []) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: compact, values });
    if (compact === 'BEGIN ISOLATION LEVEL SERIALIZABLE' || compact === 'ROLLBACK') return result();
    if (compact.includes('FROM staff_admin_accounts')) return result([tenantPrincipal()]);
    if (compact.includes('pg_advisory_xact_lock')) return result([{}]);
    if (compact.includes('FROM staff_auth_security_events')) return result([]);
    if (compact.includes('workspaceClientMutations:relationship')) return result([]);
    throw new Error(`Unexpected SQL after relationship denial: ${compact}`);
  };
  const client = { query, release() {} };
  const service = createWorkspaceClientMutationService({ db: { query, async connect() { return client; } } });
  await assert.rejects(
    service.updateClient({
      adminId: 81,
      clientId: 999,
      expectedRevision: 'a'.repeat(64),
      requestId: 'tenant_update_001',
      name: 'Clinic Only Client',
      mobile: '0821234567',
      dateOfBirth: null,
      gender: null,
    }),
    error => error instanceof WorkspaceClientMutationError && error.code === 'WORKSPACE_CLIENT_NOT_FOUND' && error.httpStatus === 404
  );
  assert.equal(calls.some(call => call.sql.includes('FROM crm_v2_clients')), false);
  assert.equal(calls.some(call => /^UPDATE crm_v2_clients/i.test(call.sql)), false);
});

test('relationship-aware revision changes when only the client-list relationship state changes', () => {
  const current = canonicalClient();
  const active = clientRelationshipRevision(current, 'active');
  const archived = clientRelationshipRevision(current, 'archived');
  assert.match(active, /^[a-f0-9]{64}$/);
  assert.match(archived, /^[a-f0-9]{64}$/);
  assert.notEqual(active, archived);
});
