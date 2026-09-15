const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWorkspaceClientMutationService,
  clientRelationshipRevision,
} = require('../src/services/workspaceClientMutations');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function principal(overrides = {}) {
  return {
    id: 41,
    staff_id: 7,
    display_name: 'Synthetic Operator',
    permissions: { 'client:lookup': true, 'client:manage': true },
    admin_active: true,
    staff_status: 'active',
    ...overrides,
  };
}

function row(overrides = {}) {
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
    provenance: {},
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

function relationshipKey(clientId, type, ownerStaffId) {
  return `${Number(clientId)}:${type}:${ownerStaffId == null ? 'clinic' : Number(ownerStaffId)}`;
}

function createFakeDb({ clients = [], authority = principal(), relationships = null } = {}) {
  const tenantOwner = String(authority?.business_role || '').trim().toLowerCase() === 'tenant_practitioner'
    ? Number(authority?.staff_id) || null
    : null;
  const initialRelationships = relationships || clients.map((item, index) => ({
    id: 5001 + index,
    client_id: Number(item.id),
    relationship_type: tenantOwner ? 'tenant_staff' : 'clinic',
    owner_staff_id: tenantOwner,
    status: 'active',
    source: 'synthetic_backfill',
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
  }));
  const state = {
    clients: new Map(clients.map(item => [Number(item.id), clone(item)])),
    relationships: new Map(initialRelationships.map(item => [relationshipKey(item.client_id, item.relationship_type, item.owner_staff_id), clone(item)])),
    events: [],
    nextId: Math.max(1000, ...clients.map(item => Number(item.id) || 0)) + 1,
    nextRelationshipId: Math.max(5000, ...initialRelationships.map(item => Number(item.id) || 0)) + 1,
    updateCount: 0,
    relationshipUpdateCount: 0,
    clock: 0,
  };
  let snapshot = null;
  function timestamp() {
    state.clock += 1;
    return new Date(Date.UTC(2026, 8, 8, 12, 0, state.clock)).toISOString();
  }
  function rowsForMobile(mobile) {
    return [...state.clients.values()].filter(item => item.normalized_mobile === mobile && item.status === 'active').map(clone);
  }
  function relationshipFor(clientId, type, ownerStaffId) {
    return state.relationships.get(relationshipKey(clientId, type, ownerStaffId)) || null;
  }
  async function query(sql, values = []) {
    const text = String(sql);
    if (/^BEGIN ISOLATION LEVEL SERIALIZABLE/.test(text)) {
      snapshot = {
        clients: clone([...state.clients]),
        relationships: clone([...state.relationships]),
        events: clone(state.events),
        nextId: state.nextId,
        nextRelationshipId: state.nextRelationshipId,
        updateCount: state.updateCount,
        relationshipUpdateCount: state.relationshipUpdateCount,
      };
      return { rows: [] };
    }
    if (/^COMMIT/.test(text)) { snapshot = null; return { rows: [] }; }
    if (/^ROLLBACK/.test(text)) {
      if (snapshot) {
        state.clients = new Map(snapshot.clients.map(([id, item]) => [Number(id), item]));
        state.relationships = new Map(snapshot.relationships);
        state.events = snapshot.events;
        state.nextId = snapshot.nextId;
        state.nextRelationshipId = snapshot.nextRelationshipId;
        state.updateCount = snapshot.updateCount;
        state.relationshipUpdateCount = snapshot.relationshipUpdateCount;
      }
      snapshot = null;
      return { rows: [] };
    }
    if (/FROM staff_admin_accounts a/.test(text)) return { rows: authority ? [clone(authority)] : [] };
    if (/pg_advisory_xact_lock/.test(text)) return { rows: [] };
    if (/SELECT metadata FROM staff_auth_security_events/.test(text)) {
      const [operatorId, origin, requestId] = values;
      const match = [...state.events].reverse().find(event => event.operator_admin_id === operatorId && event.metadata.origin === origin && event.metadata.requestId === requestId);
      return { rows: match ? [{ metadata: clone(match.metadata) }] : [] };
    }
    if (/INSERT INTO staff_auth_security_events/.test(text)) {
      state.events.push({ event_type: values[0], operator_admin_id: values[1], metadata: JSON.parse(values[2]) });
      return { rows: [] };
    }
    if (/workspaceClientMutations:relationship/.test(text)) {
      const clientId = Number(values[0]);
      const tenant = /relationship_type='tenant_staff'/.test(text);
      const relationship = relationshipFor(clientId, tenant ? 'tenant_staff' : 'clinic', tenant ? Number(values[1]) : null);
      return { rows: relationship ? [clone(relationship)] : [] };
    }
    if (/INSERT INTO crm_v2_client_relationships/.test(text)) {
      const clientId = Number(values[0]);
      const tenant = /'tenant_staff'/.test(text);
      const ownerStaffId = tenant ? Number(values[1]) : null;
      const source = tenant ? values[2] : values[1];
      const key = relationshipKey(clientId, tenant ? 'tenant_staff' : 'clinic', ownerStaffId);
      const existing = state.relationships.get(key);
      const now = timestamp();
      const relationship = existing
        ? { ...existing, status: 'active', source, updated_at: now }
        : {
            id: state.nextRelationshipId++,
            client_id: clientId,
            relationship_type: tenant ? 'tenant_staff' : 'clinic',
            owner_staff_id: ownerStaffId,
            status: 'active',
            source,
            created_at: now,
            updated_at: now,
          };
      state.relationships.set(key, relationship);
      return { rows: [{ id: relationship.id, status: relationship.status }] };
    }
    if (/UPDATE crm_v2_client_relationships/.test(text)) {
      const relationshipId = Number(values[0]);
      for (const [key, relationship] of state.relationships.entries()) {
        if (Number(relationship.id) !== relationshipId) continue;
        state.relationships.set(key, { ...relationship, status: 'archived', updated_at: timestamp() });
        state.relationshipUpdateCount += 1;
        break;
      }
      return { rows: [] };
    }
    if (/FROM crm_v2_clients/.test(text) && /normalized_mobile=\$1 AND status='active'/.test(text)) {
      return { rows: rowsForMobile(values[0]) };
    }
    if (/FROM crm_v2_clients/.test(text) && /WHERE id=\$1/.test(text)) {
      const item = state.clients.get(Number(values[0]));
      return { rows: item ? [clone(item)] : [] };
    }
    if (/INSERT INTO crm_v2_clients/.test(text)) {
      const id = state.nextId++;
      const now = timestamp();
      const item = {
        id,
        name: values[0],
        normalized_mobile: values[1],
        date_of_birth: values[2],
        gender: values[3],
        profile_status: values[4],
        mobile_verified_at: values[5],
        source: values[6],
        status: values[7],
        provenance: JSON.parse(values[8]),
        created_at: now,
        updated_at: now,
      };
      state.clients.set(id, item);
      return { rows: [clone(item)] };
    }
    if (/UPDATE crm_v2_clients/.test(text)) {
      const id = Number(values[0]);
      const current = state.clients.get(id);
      if (!current) return { rows: [] };
      const next = clone(current);
      const map = {
        name: 'name',
        normalized_mobile: 'normalized_mobile',
        date_of_birth: 'date_of_birth',
        gender: 'gender',
        profile_status: 'profile_status',
        mobile_verified_at: 'mobile_verified_at',
        status: 'status',
        provenance: 'provenance',
      };
      const matches = [...text.matchAll(/(name|normalized_mobile|date_of_birth|gender|profile_status|mobile_verified_at|status|provenance)=\$(\d+)/g)];
      for (const match of matches) {
        let value = values[Number(match[2]) - 1];
        if (match[1] === 'provenance') value = JSON.parse(value);
        next[map[match[1]]] = value;
      }
      next.updated_at = timestamp();
      state.updateCount += 1;
      state.clients.set(id, next);
      return { rows: [clone(next)] };
    }
    throw new Error(`Unhandled synthetic SQL: ${text.slice(0, 120)}`);
  }
  const client = { query, release() {} };
  return { query, async connect() { return client; }, state };
}

function activeRevision(client) {
  return clientRelationshipRevision(client, 'active');
}

test('create is canonical, relationship-scoped, audited, idempotent and replay mismatch fails closed', async () => {
  const db = createFakeDb();
  const service = createWorkspaceClientMutationService({ db });
  const first = await service.createClient({ adminId: 41, requestId: 'create_123456', name: 'New Client', mobile: '082 555 1234' });
  assert.equal(first.status, 'created');
  assert.equal(first.replayed, false);
  assert.equal(db.state.clients.size, 1);
  assert.equal(db.state.relationships.size, 1);
  assert.equal([...db.state.relationships.values()][0].status, 'active');
  assert.equal(db.state.events.length, 1);
  const event = db.state.events[0];
  assert.equal(event.event_type, 'workspace_client_created');
  assert.equal(event.metadata.origin, 'workspace.clients');
  assert.equal(event.metadata.relationshipType, 'clinic');
  assert.match(event.metadata.changes.mobile.after, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(event.metadata), /27825551234|0825551234/);

  const replay = await service.createClient({ adminId: 41, requestId: 'create_123456', name: 'New Client', mobile: '082 555 1234' });
  assert.equal(replay.replayed, true);
  assert.equal(db.state.clients.size, 1);
  assert.equal(db.state.relationships.size, 1);
  assert.equal(db.state.events.length, 1);

  await assert.rejects(
    () => service.createClient({ adminId: 41, requestId: 'create_123456', name: 'Different Client', mobile: '082 555 1234' }),
    error => error.code === 'WORKSPACE_CLIENT_REPLAY_MISMATCH' && error.httpStatus === 409
  );
  assert.equal(db.state.clients.size, 1);
});

test('mobile edit normalizes, resets verification, audits relationship revisions and stale revision writes nothing', async () => {
  const original = row();
  const db = createFakeDb({ clients: [original] });
  const service = createWorkspaceClientMutationService({ db });
  const beforeRevision = activeRevision(original);
  const result = await service.updateClient({
    adminId: 41,
    clientId: 912,
    expectedRevision: beforeRevision,
    requestId: 'update_123456',
    name: 'Synthetic Client',
    mobile: '083 765 4321',
    dateOfBirth: '1994-02-18',
    gender: 'female',
  });
  assert.equal(result.status, 'updated');
  assert.notEqual(result.revision, beforeRevision);
  assert.equal(db.state.clients.get(912).normalized_mobile, '27837654321');
  assert.equal(db.state.clients.get(912).mobile_verified_at, null);
  assert.equal(db.state.events[0].metadata.changes.mobileVerificationReset, true);
  assert.equal(db.state.events[0].metadata.beforeRevision, beforeRevision);
  assert.equal(db.state.events[0].metadata.afterRevision, result.revision);

  const updatesBeforeStale = db.state.updateCount;
  await assert.rejects(
    () => service.updateClient({ adminId: 41, clientId: 912, expectedRevision: beforeRevision, requestId: 'update_654321', name: 'Unsafe Stale', mobile: '083 765 4321', dateOfBirth: '1994-02-18', gender: 'female' }),
    error => error.code === 'WORKSPACE_CLIENT_STALE_REVISION' && error.httpStatus === 409
  );
  assert.equal(db.state.updateCount, updatesBeforeStale);
  assert.equal(db.state.clients.get(912).name, 'Synthetic Client');
});

test('semantic no-op preserves relationship revision and performs zero CRM row update', async () => {
  const original = row();
  const db = createFakeDb({ clients: [original] });
  const service = createWorkspaceClientMutationService({ db });
  const revision = activeRevision(original);
  const result = await service.updateClient({
    adminId: 41,
    clientId: 912,
    expectedRevision: revision,
    requestId: 'noop_12345678',
    name: '  Synthetic   Client ',
    mobile: '+27 82 123 4567',
    dateOfBirth: '1994-02-18',
    gender: 'Female',
  });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.revision, revision);
  assert.equal(db.state.updateCount, 0);
  assert.equal(db.state.events.length, 1, 'the idempotency/audit request record remains durable even for a no-op');
});

test('mobile collision and missing manage authority fail closed without client mutation', async () => {
  const first = row();
  const second = row({ id: 913, name: 'Other Client', normalized_mobile: '27839990000', mobile_verified_at: null });
  const db = createFakeDb({ clients: [first, second] });
  const service = createWorkspaceClientMutationService({ db });
  await assert.rejects(
    () => service.updateClient({ adminId: 41, clientId: 912, expectedRevision: activeRevision(first), requestId: 'collision_123', name: 'Synthetic Client', mobile: '083 999 0000', dateOfBirth: '1994-02-18', gender: 'female' }),
    error => error.code === 'WORKSPACE_CLIENT_MOBILE_CONFLICT' && error.httpStatus === 409
  );
  assert.equal(db.state.updateCount, 0);
  assert.equal(db.state.clients.get(912).normalized_mobile, '27821234567');

  const deniedDb = createFakeDb({ clients: [first], authority: principal({ permissions: { 'client:lookup': true } }) });
  const denied = createWorkspaceClientMutationService({ db: deniedDb });
  await assert.rejects(
    () => denied.archiveClient({ adminId: 41, clientId: 912, expectedRevision: activeRevision(first), requestId: 'archive_12345' }),
    error => error.code === 'WORKSPACE_CLIENT_MANAGE_FORBIDDEN' && error.httpStatus === 403
  );
  assert.equal(deniedDb.state.updateCount, 0);
  assert.equal(deniedDb.state.relationshipUpdateCount, 0);
});

test('archive removes only the scoped relationship and preserves canonical identity/history', async () => {
  const original = row();
  const db = createFakeDb({ clients: [original] });
  const service = createWorkspaceClientMutationService({ db });
  const result = await service.archiveClient({ adminId: 41, clientId: 912, expectedRevision: activeRevision(original), requestId: 'archive_98765' });
  assert.equal(result.status, 'archived');
  assert.equal(db.state.clients.size, 1);
  assert.equal(db.state.clients.get(912).status, 'active');
  assert.equal(db.state.updateCount, 0, 'canonical CRM row must not be archived by a relationship removal');
  assert.equal(db.state.relationshipUpdateCount, 1);
  assert.equal([...db.state.relationships.values()][0].status, 'archived');
  assert.equal(db.state.events[0].event_type, 'workspace_client_archived');
  assert.equal(db.state.events[0].metadata.changes.canonicalClientPreserved, true);
  assert.equal(db.state.events[0].metadata.changes.otherRelationshipsPreserved, true);
  assert.equal(db.state.events[0].metadata.changes.hardDelete, false);
  assert.equal(db.state.events[0].metadata.changes.appointmentHistoryPreserved, true);
});
