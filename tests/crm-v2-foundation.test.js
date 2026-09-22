const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CrmV2Error,
  normalizeMobile,
  localMobile,
  normalizeName,
  createCrmV2ClientService,
} = require('../src/services/crmV2ClientService');

const ROOT = path.resolve(__dirname, '..');
const NOW = new Date('2026-08-27T12:00:00.000Z');

function clone(value) {
  return structuredClone(value);
}

class MemoryCrmV2Repository {
  constructor({ clients = [], legacyClients = [], appointments = [] } = {}) {
    this.clients = clone(clients);
    this.legacyClients = clone(legacyClients);
    this.appointments = clone(appointments);
    this.nextId = this.clients.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1;
    this.locks = [];
    this.calls = [];
  }

  async withTransaction(work) {
    const snapshot = clone({ clients: this.clients, nextId: this.nextId, locks: this.locks });
    try {
      return await work(this);
    } catch (error) {
      this.clients = snapshot.clients;
      this.nextId = snapshot.nextId;
      this.locks = snapshot.locks;
      throw error;
    }
  }

  async lockNormalizedMobile(mobile) {
    this.calls.push('lockNormalizedMobile');
    this.locks.push(mobile);
  }

  async findActiveByNormalizedMobile(mobile) {
    this.calls.push('findActiveByNormalizedMobile');
    return this.clients.filter((row) => row.status === 'active' && row.normalized_mobile === mobile).map(clone);
  }

  async getClientById(id) {
    this.calls.push('getClientById');
    const row = this.clients.find((item) => String(item.id) === String(id));
    return row ? clone(row) : null;
  }

  async insertClient(input) {
    this.calls.push('insertClient');
    if (this.clients.some((row) => row.status === 'active' && row.normalized_mobile === input.normalizedMobile)) {
      const error = new Error('duplicate active mobile');
      error.code = '23505';
      throw error;
    }
    const row = {
      id: this.nextId++,
      name: input.name,
      normalized_mobile: input.normalizedMobile,
      date_of_birth: input.dateOfBirth,
      gender: input.gender,
      profile_status: input.profileStatus,
      mobile_verified_at: input.mobileVerifiedAt,
      source: input.source,
      status: input.status,
      provenance: clone(input.provenance),
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    };
    this.clients.push(row);
    return clone(row);
  }

  async updateClient(id, patch) {
    this.calls.push('updateClient');
    const row = this.clients.find((item) => String(item.id) === String(id));
    if (!row) return null;
    const fields = {
      name: 'name',
      normalizedMobile: 'normalized_mobile',
      dateOfBirth: 'date_of_birth',
      gender: 'gender',
      profileStatus: 'profile_status',
      mobileVerifiedAt: 'mobile_verified_at',
      status: 'status',
      provenance: 'provenance',
    };
    for (const [field, value] of Object.entries(patch)) {
      if (fields[field]) row[fields[field]] = clone(value);
    }
    row.updated_at = NOW.toISOString();
    return clone(row);
  }

  async searchClients({ query, mobileSearch, status, limit }) {
    this.calls.push('searchClients');
    const nameNeedle = query.toLowerCase();
    const digits = mobileSearch || query.replace(/[^0-9]/g, '');
    return this.clients
      .filter((row) => status === null || row.status === status)
      .filter((row) => row.name.toLowerCase().includes(nameNeedle) || (digits && row.normalized_mobile.includes(digits)))
      .slice(0, limit)
      .map(clone);
  }
}

function serviceFor(repository) {
  return createCrmV2ClientService({ repository, clock: () => new Date(NOW) });
}

async function minimalClient(repository, overrides = {}) {
  const service = serviceFor(repository);
  const created = await service.createClient({
    name: overrides.name || 'Sarah Smith',
    mobile: overrides.mobile || '082 123 4567',
    actorReference: 'staff_admin:12',
  });
  return { service, created };
}

test('CRM V2 starts empty and the migration performs zero legacy backfill', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/084_clean_crm_v2_foundation.sql'), 'utf8');
  const repository = new MemoryCrmV2Repository({ legacyClients: [{ id: 99, name: 'Goldie Person' }] });
  assert.equal(repository.clients.length, 0);
  assert.equal(repository.legacyClients.length, 1);
  assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_]|DELETE\s+FROM)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS crm_v2_clients/);
});

test('staff creation needs only a valid name and mobile and returns a permanent canonical id', async () => {
  const repository = new MemoryCrmV2Repository();
  const { created } = await minimalClient(repository);
  assert.equal(created.status, 'created');
  assert.equal(created.client.id, '1');
  assert.equal(created.client.name, 'Sarah Smith');
  assert.equal(created.client.normalizedMobile, '27821234567');
  assert.equal(created.client.source, 'staff');
});

test('staff-created client is minimal with nullable date of birth and gender', async () => {
  const repository = new MemoryCrmV2Repository();
  const { created } = await minimalClient(repository);
  assert.equal(created.client.profileStatus, 'minimal');
  assert.equal(created.client.dateOfBirth, null);
  assert.equal(created.client.gender, null);
  assert.equal(created.client.mobileVerifiedAt, null);
  assert.equal(created.client.status, 'active');
});

test('South African mobile formatting normalizes deterministically', () => {
  assert.equal(normalizeMobile('082 123 4567'), '27821234567');
  assert.equal(normalizeMobile('+27 (82) 123-4567'), '27821234567');
  assert.equal(normalizeMobile('0027 82 123 4567'), '27821234567');
  assert.equal(normalizeMobile('012 123 4567'), null);
  assert.equal(normalizeMobile('082123456'), null);
});

test('South African mobile display/storage projection uses the local 0-format', () => {
  assert.equal(localMobile('082 123 4567'), '0821234567');
  assert.equal(localMobile('+27 (82) 123-4567'), '0821234567');
  assert.equal(localMobile('27821234567'), '0821234567');
  assert.equal(localMobile('0027 82 123 4567'), '0821234567');
  assert.equal(localMobile('012 123 4567'), null);
});

test('practical Unicode names are accepted while markup is rejected', () => {
  assert.equal(normalizeName('  Zoë   Dlamini-Smith '), 'Zoë Dlamini-Smith');
  assert.equal(normalizeName("O'Neil van der Merwe"), "O'Neil van der Merwe");
  assert.equal(normalizeName('Sarah <script>'), null);
});

test('exact normalized mobile lookup returns the staff-created canonical client', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  const found = await service.resolveExactMobile('+27 82 123 4567');
  assert.equal(found.status, 'found');
  assert.equal(found.client.id, '1');
});

test('a duplicate active mobile returns the existing client without creating or renaming', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  const second = await service.createClient({ name: 'Different Name', mobile: '+27821234567' });
  assert.equal(second.status, 'existing');
  assert.equal(second.client.id, '1');
  assert.equal(second.client.name, 'Sarah Smith');
  assert.equal(repository.clients.length, 1);
});

test('corrupt duplicate active ownership fails closed as an explicit conflict', async () => {
  const repository = new MemoryCrmV2Repository({ clients: [
    { id: 1, name: 'One', normalized_mobile: '27821234567', date_of_birth: null, gender: null, profile_status: 'minimal', mobile_verified_at: null, source: 'staff', status: 'active', provenance: {}, created_at: NOW, updated_at: NOW },
    { id: 2, name: 'Two', normalized_mobile: '27821234567', date_of_birth: null, gender: null, profile_status: 'minimal', mobile_verified_at: null, source: 'staff', status: 'active', provenance: {}, created_at: NOW, updated_at: NOW },
  ] });
  const result = await serviceFor(repository).createClient({ name: 'Three', mobile: '0821234567' });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.clientIds, ['1', '2']);
  assert.equal(repository.clients.length, 2);
});

test('name similarity alone never resolves or merges clients', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository, { name: 'Sarah Smith', mobile: '0821234567' });
  const second = await service.createClient({ name: 'Sarah Smith', mobile: '0831234567' });
  assert.equal(second.status, 'created');
  assert.notEqual(second.client.id, '1');
  assert.equal(repository.clients.length, 2);
});

test('date-of-birth similarity alone never resolves or merges clients', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository, { name: 'Sarah Smith', mobile: '0821234567' });
  await service.completeRegistration({ clientId: 1, name: 'Sarah Smith', dateOfBirth: '1990-05-14', gender: 'female' });
  const second = await service.createClient({ name: 'Sara Smyth', mobile: '0831234567' });
  assert.equal(second.status, 'created');
  assert.equal(second.client.dateOfBirth, null);
  assert.equal(repository.clients.length, 2);
});

test('legacy and Goldie identity stores are never consulted for normal resolution', async () => {
  const repository = new MemoryCrmV2Repository({ legacyClients: [{ id: 835, normalizedMobile: '27821234567' }] });
  const created = await serviceFor(repository).createClient({ name: 'Clean Client', mobile: '0821234567' });
  assert.equal(created.status, 'created');
  assert.equal(repository.legacyClients.length, 1);
  assert.deepEqual(repository.calls, ['lockNormalizedMobile', 'findActiveByNormalizedMobile', 'insertClient']);
});

test('a minimal client completes to registered with name, date of birth, and gender', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  const completed = await service.completeRegistration({
    clientId: 1,
    name: 'Sarah Jane Smith',
    dateOfBirth: '1990-05-14',
    gender: 'Female',
  });
  assert.equal(completed.status, 'registered');
  assert.equal(completed.client.profileStatus, 'registered');
  assert.equal(completed.client.name, 'Sarah Jane Smith');
  assert.equal(completed.client.dateOfBirth, '1990-05-14');
  assert.equal(completed.client.gender, 'female');
});

test('registration fails closed when date of birth or gender is absent', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  await assert.rejects(
    service.completeRegistration({ clientId: 1, name: 'Sarah Smith', dateOfBirth: '1990-05-14' }),
    (error) => error instanceof CrmV2Error && error.code === 'CRM_V2_GENDER_REQUIRED'
  );
  assert.equal(repository.clients[0].profile_status, 'minimal');
});

test('verified inbound WhatsApp interaction sets and monotonically updates mobile_verified_at', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  const first = await service.recordVerifiedWhatsAppInteraction({ mobile: '0821234567', occurredAt: '2026-08-27T10:00:00Z' });
  const older = await service.recordVerifiedWhatsAppInteraction({ mobile: '+27821234567', occurredAt: '2026-08-26T10:00:00Z' });
  const newer = await service.recordVerifiedWhatsAppInteraction({ mobile: '0027821234567', occurredAt: '2026-08-27T11:00:00Z' });
  assert.equal(first.status, 'verified');
  assert.equal(older.client.mobileVerifiedAt, '2026-08-27T10:00:00.000Z');
  assert.equal(newer.client.mobileVerifiedAt, '2026-08-27T11:00:00.000Z');
});

test('verified inbound interaction never creates a client when exact mobile is absent', async () => {
  const repository = new MemoryCrmV2Repository();
  const result = await serviceFor(repository).recordVerifiedWhatsAppInteraction({ mobile: '0821234567' });
  assert.equal(result.status, 'not_found');
  assert.equal(repository.clients.length, 0);
});

test('WhatsApp registration creates a clean registered client from the inbound sender', async () => {
  const repository = new MemoryCrmV2Repository({ legacyClients: [{ id: 5, normalizedMobile: '27821234567' }] });
  const result = await serviceFor(repository).registerWhatsAppClient({
    senderMobile: '+27821234567',
    name: 'Sarah Smith',
    dateOfBirth: '1990-05-14',
    gender: 'female',
    occurredAt: '2026-08-27T10:00:00Z',
  });
  assert.equal(result.status, 'created');
  assert.equal(result.client.profileStatus, 'registered');
  assert.equal(result.client.source, 'whatsapp');
  assert.equal(result.client.mobileVerifiedAt, '2026-08-27T10:00:00.000Z');
  assert.equal(repository.legacyClients.length, 1);
});

test('WhatsApp registration exact-resolves and completes an existing minimal client', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  const result = await service.registerWhatsAppClient({
    senderMobile: '+27821234567',
    name: 'Sarah Smith',
    dateOfBirth: '1990-05-14',
    gender: 'female',
  });
  assert.equal(result.status, 'registered');
  assert.equal(result.client.id, '1');
  assert.equal(repository.clients.length, 1);
});

test('canonical ids remain consistent across create, get, exact lookup, and search', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service, created } = await minimalClient(repository);
  const got = await service.getClientById(created.client.id);
  const exact = await service.resolveExactMobile(created.client.normalizedMobile);
  const searched = await service.searchClients({ query: 'Sarah' });
  assert.equal(got.id, created.client.id);
  assert.equal(exact.client.id, created.client.id);
  assert.equal(searched[0].id, created.client.id);
});

test('operator search finds CRM V2 clients by name and mobile only', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository, { name: 'Sarah Smith', mobile: '0821234567' });
  await service.createClient({ name: 'Thandi Ndlovu', mobile: '0839876543' });
  assert.deepEqual((await service.searchClients({ query: 'thandi' })).map((row) => row.name), ['Thandi Ndlovu']);
  assert.deepEqual((await service.searchClients({ query: '082 123' })).map((row) => row.name), ['Sarah Smith']);
});

test('changing mobile fails closed on duplicate ownership and leaves the client unchanged', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository, { name: 'Sarah Smith', mobile: '0821234567' });
  await service.createClient({ name: 'Thandi Ndlovu', mobile: '0839876543' });
  const result = await service.updateClient({ clientId: 1, mobile: '0839876543' });
  assert.equal(result.status, 'conflict');
  assert.equal(repository.clients[0].normalized_mobile, '27821234567');
});

test('changing mobile clears inbound WhatsApp verification', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  await service.recordVerifiedWhatsAppInteraction({ mobile: '0821234567' });
  const updated = await service.updateClient({ clientId: 1, mobile: '0831234567' });
  assert.equal(updated.status, 'updated');
  assert.equal(updated.client.normalizedMobile, '27831234567');
  assert.equal(updated.client.mobileVerifiedAt, null);
});

test('archive is non-destructive and permits a later active client to claim the mobile', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  const archived = await service.archiveClient({ clientId: 1 });
  const replacement = await service.createClient({ name: 'Replacement Client', mobile: '0821234567' });
  assert.equal(archived.client.status, 'archived');
  assert.equal(replacement.status, 'created');
  assert.equal(repository.clients.length, 2);
});

test('failed registration rolls back every CRM V2 write', async () => {
  const repository = new MemoryCrmV2Repository();
  const { service } = await minimalClient(repository);
  const originalUpdate = repository.updateClient.bind(repository);
  repository.updateClient = async (...args) => {
    await originalUpdate(...args);
    throw new Error('simulated persistence failure');
  };
  await assert.rejects(service.completeRegistration({ clientId: 1, name: 'Sarah Smith', dateOfBirth: '1990-05-14', gender: 'female' }));
  assert.equal(repository.clients[0].profile_status, 'minimal');
  assert.equal(repository.clients[0].date_of_birth, null);
});

test('existing appointments and legacy clients remain byte-for-byte unchanged', async () => {
  const legacyClients = [{ id: 10, name: 'Legacy' }];
  const appointments = [{ id: 592, client_id: 10, source_client_name: 'Legacy' }];
  const repository = new MemoryCrmV2Repository({ legacyClients, appointments });
  await serviceFor(repository).createClient({ name: 'Clean Client', mobile: '0821234567' });
  assert.deepEqual(repository.legacyClients, legacyClients);
  assert.deepEqual(repository.appointments, appointments);
});

test('appointment compatibility seam is nullable and has no row mutation', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/084_clean_crm_v2_foundation.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS crm_v2_client_id BIGINT/);
  assert.doesNotMatch(sql, /crm_v2_client_id\s+BIGINT\s+NOT NULL/i);
  assert.doesNotMatch(sql, /UPDATE\s+appointments|INSERT\s+INTO\s+appointments|DELETE\s+FROM\s+appointments/i);
});

test('CRM V2 runtime has no provider calls or legacy authority state machinery', () => {
  const runtime = [
    'src/services/crmV2ClientService.js',
    'src/repositories/crmV2ClientRepository.js',
  ].map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  const migration = fs.readFileSync(path.join(ROOT, 'migrations/084_clean_crm_v2_foundation.sql'), 'utf8');
  assert.doesNotMatch(runtime, /sendWhatsAppMessage|axios|fetch\s*\(|Meta|Goldie|goldie|user_profiles/);
  assert.doesNotMatch(runtime, /operator_confirmed|client_facing_name_authorities|confirmationSafe|client_identity_verifications/);
  assert.doesNotMatch(migration, /(?:FROM|JOIN)\s+(?:clients|client_contacts|user_profiles|external_records|client_identity_verifications)\b/i);
});

test('foundation adds no HTTP mutation route or staff-permission expansion', () => {
  const adminRoutes = fs.readFileSync(path.join(ROOT, 'src/routes/admin.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const runtime = [
    'src/services/crmV2ClientService.js',
    'src/repositories/crmV2ClientRepository.js',
  ].map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  assert.doesNotMatch(adminRoutes, /crmV2|crm\/v2/);
  assert.doesNotMatch(app, /app\.use\([^\n]*(?:crmV2|crm\/v2)/);
  assert.doesNotMatch(runtime, /staff_admin_accounts|permissions/);
});

test('migration owns one-active-mobile enforcement and registered completeness', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/084_clean_crm_v2_foundation.sql'), 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_v2_clients_active_mobile/);
  assert.match(sql, /WHERE status = 'active'/);
  assert.match(sql, /crm_v2_registered_profile_complete/);
  assert.match(sql, /profile_status <> 'registered'/);
});

test('service provenance is server-derived and does not retain raw formatted mobile', async () => {
  const repository = new MemoryCrmV2Repository();
  const { created } = await minimalClient(repository);
  assert.deepEqual(created.client.provenance, { createdVia: 'staff', actorReference: 'staff_admin:12' });
  assert.doesNotMatch(JSON.stringify(created.client.provenance), /082|27821234567/);
});
