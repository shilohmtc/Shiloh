const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const {
  buildCalendarHandoffUrl,
  createStaffCalendarHandoffService,
} = require('../src/services/staffCalendarHandoff');
const {
  renderStaffCalendarHandoffPage,
  staffCalendarHandoffClientScript,
} = require('../src/presentation/staffCalendarHandoffUx');

function principal(overrides = {}) {
  return {
    id: 20,
    staff_id: null,
    display_name: 'Synthetic Staff',
    role: 'admin',
    business_role: 'business_admin',
    calendar_scope: 'all_business',
    service_scope: 'all_services',
    permissions: { 'appointment:view': true },
    active: true,
    admin_active: true,
    staff_status: null,
    normalized_whatsapp: '27720000000',
    ...overrides,
  };
}

function fakeDb(initialAdmins = [principal()]) {
  const state = {
    admins: initialAdmins.map((row) => ({ ...row })),
    handoffs: [],
    sessions: [],
    nextHandoffId: 1,
    nextSessionId: 1,
  };

  const db = {
    state,
    async connect() { return db; },
    async query(sql, params = []) {
      const text = String(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text.trim())) return { rows: [], rowCount: 0 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };

      if (text.includes('FROM staff_admin_accounts a')) {
        let rows;
        if (text.includes('a.normalized_whatsapp = $1')) {
          rows = state.admins.filter((row) => row.active === true && row.normalized_whatsapp === params[0]);
        } else {
          rows = state.admins.filter((row) => row.active === true && Number(row.id) === Number(params[0]));
        }
        return { rows: rows.slice(0, 2).map((row) => ({ ...row, admin_active: row.active === true })), rowCount: Math.min(rows.length, 2) };
      }

      if (text.includes('UPDATE staff_browser_emergency_bootstraps') && text.includes('WHERE admin_id = $1')) {
        let changed = 0;
        for (const row of state.handoffs) {
          if (Number(row.admin_id) === Number(params[0]) && row.consumed_at == null && row.revoked_at == null) {
            row.revoked_at = params[1];
            changed += 1;
          }
        }
        return { rows: [], rowCount: changed };
      }

      if (text.includes('INSERT INTO staff_browser_emergency_bootstraps')) {
        state.handoffs.push({
          id: state.nextHandoffId++,
          admin_id: params[0],
          token_hash: params[1],
          issued_at: params[2],
          expires_at: params[3],
          issued_via: 'whatsapp_admin',
          consumed_at: null,
          revoked_at: null,
        });
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('FROM staff_browser_emergency_bootstraps')) {
        const row = state.handoffs.find((candidate) => candidate.token_hash === params[0]);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      if (text.includes('UPDATE staff_browser_emergency_bootstraps SET revoked_at = $2 WHERE id = $1')) {
        const row = state.handoffs.find((candidate) => Number(candidate.id) === Number(params[0]));
        if (!row) return { rows: [], rowCount: 0 };
        row.revoked_at = params[1];
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      if (text.includes('UPDATE staff_browser_emergency_bootstraps') && text.includes('SET consumed_at = $2')) {
        const row = state.handoffs.find((candidate) => Number(candidate.id) === Number(params[0]));
        if (!row || row.consumed_at != null || row.revoked_at != null) return { rows: [], rowCount: 0 };
        row.consumed_at = params[1];
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      if (text.includes('SELECT id') && text.includes('FROM staff_browser_sessions')) {
        const rows = state.sessions.filter((row) => Number(row.admin_id) === Number(params[0]) && row.revoked_at == null);
        const row = rows.at(-1);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }

      if (text.includes('UPDATE staff_browser_sessions') && text.includes("revoke_reason = 'rotated'")) {
        let changed = 0;
        for (const row of state.sessions) {
          if (Number(row.admin_id) === Number(params[0]) && row.revoked_at == null) {
            row.revoked_at = params[1];
            row.revoke_reason = 'rotated';
            changed += 1;
          }
        }
        return { rows: [], rowCount: changed };
      }

      if (text.includes('INSERT INTO staff_browser_sessions')) {
        const row = {
          id: state.nextSessionId++,
          admin_id: params[0],
          token_hash: params[1],
          csrf_hash: params[2],
          issued_at: params[3],
          expires_at: params[4],
          rotated_from_session_id: params[5],
          client_fingerprint_hash: params[6],
          auth_method: params[7],
          reauthenticated_at: params[3],
          recovery_required: params[8],
          revoked_at: null,
        };
        state.sessions.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${text.slice(0, 120)}`);
    },
  };
  return db;
}

function deterministicRandomBytes() {
  let value = 3;
  return (size) => Buffer.alloc(size, value++);
}

test('canonical inbound WhatsApp viewer gets hash-only short-lived handoff and one successful session exchange', async () => {
  const db = fakeDb();
  const current = new Date('2026-08-29T14:30:00.000Z');
  const service = createStaffCalendarHandoffService({
    db,
    now: () => new Date(current),
    randomBytes: deterministicRandomBytes(),
  });

  const issued = await service.issueForWhatsapp({ whatsapp: '+27 72 000 0000' });
  assert.equal(issued.ok, true);
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.adminId, 20);
  assert.deepEqual(issued.viewer, { calendarScope: 'business_all_staff' });
  assert.equal(db.state.handoffs.length, 1);
  assert.notEqual(db.state.handoffs[0].token_hash, issued.token, 'plaintext handoff token must not be stored');
  assert.equal(JSON.stringify(db.state.handoffs).includes(issued.token), false, 'stored handoff state must not contain plaintext token');
  assert.equal(new Date(issued.expiresAt).getTime() - current.getTime(), 2 * 60 * 1000);

  const exchanged = await service.exchange({ token: issued.token, requestFingerprintHash: 'a'.repeat(64) });
  assert.equal(exchanged.ok, true);
  assert.equal(exchanged.adminId, 20);
  assert.deepEqual(exchanged.viewer, { calendarScope: 'business_all_staff' });
  assert.equal(db.state.handoffs[0].consumed_at instanceof Date, true);
  assert.equal(db.state.sessions.length, 1);
  assert.equal(db.state.sessions[0].admin_id, 20);
  assert.equal(db.state.sessions[0].auth_method, 'emergency_bootstrap', 'retained schema enum is storage compatibility only');
  assert.equal(db.state.sessions[0].client_fingerprint_hash, 'a'.repeat(64));

  const replay = await service.exchange({ token: issued.token });
  assert.deepEqual(replay, { ok: false, code: 'STAFF_CALENDAR_HANDOFF_INVALID' });
  assert.equal(db.state.sessions.length, 1, 'replay must not mint another session');
});

test('handoff fails closed for duplicate sender identity and authority drift before exchange', async () => {
  const duplicateDb = fakeDb([
    principal({ id: 20 }),
    principal({ id: 21 }),
  ]);
  const duplicateService = createStaffCalendarHandoffService({
    db: duplicateDb,
    now: () => new Date('2026-08-29T14:30:00.000Z'),
    randomBytes: deterministicRandomBytes(),
  });
  assert.deepEqual(
    await duplicateService.issueForWhatsapp({ whatsapp: '27720000000' }),
    { ok: false, code: 'STAFF_CALENDAR_HANDOFF_FORBIDDEN' },
  );
  assert.equal(duplicateDb.state.handoffs.length, 0);

  const driftDb = fakeDb();
  const driftService = createStaffCalendarHandoffService({
    db: driftDb,
    now: () => new Date('2026-08-29T14:30:00.000Z'),
    randomBytes: deterministicRandomBytes(),
  });
  const issued = await driftService.issueForWhatsapp({ whatsapp: '27720000000' });
  assert.equal(issued.ok, true);
  driftDb.state.admins[0].permissions = {};
  const drifted = await driftService.exchange({ token: issued.token });
  assert.deepEqual(drifted, { ok: false, code: 'STAFF_CALENDAR_HANDOFF_INVALID' });
  assert.equal(driftDb.state.handoffs[0].revoked_at instanceof Date, true);
  assert.equal(driftDb.state.sessions.length, 0);
});

test('handoff rejects inactive staff and expires without minting a session', async () => {
  const inactiveDb = fakeDb([principal({ staff_id: 7, staff_status: 'inactive' })]);
  const inactiveService = createStaffCalendarHandoffService({
    db: inactiveDb,
    now: () => new Date('2026-08-29T14:30:00.000Z'),
    randomBytes: deterministicRandomBytes(),
  });
  assert.deepEqual(
    await inactiveService.issueForWhatsapp({ whatsapp: '27720000000' }),
    { ok: false, code: 'STAFF_CALENDAR_HANDOFF_FORBIDDEN' },
  );
  assert.equal(inactiveDb.state.handoffs.length, 0);

  const expiryDb = fakeDb();
  let current = new Date('2026-08-29T14:30:00.000Z');
  const expiryService = createStaffCalendarHandoffService({
    db: expiryDb,
    now: () => new Date(current),
    randomBytes: deterministicRandomBytes(),
  });
  const issued = await expiryService.issueForWhatsapp({ whatsapp: '27720000000' });
  assert.equal(issued.ok, true);
  current = new Date('2026-08-29T14:32:00.001Z');
  assert.deepEqual(
    await expiryService.exchange({ token: issued.token }),
    { ok: false, code: 'STAFF_CALENDAR_HANDOFF_INVALID' },
  );
  assert.equal(expiryDb.state.handoffs[0].revoked_at instanceof Date, true);
  assert.equal(expiryDb.state.sessions.length, 0);
});

test('handoff URL keeps credential in fragment on an isolated landing page and browser strips it before exchange', () => {
  const token = Buffer.alloc(32, 9).toString('base64url');
  const url = buildCalendarHandoffUrl(token, { SHILOH_CALENDAR_PUBLIC_ORIGIN: 'https://calendar.example.test/path' });
  assert.equal(url, `https://calendar.example.test/calendar/staff/handoff#handoff=${token}`);

  const page = renderStaffCalendarHandoffPage();
  assert.match(page, /\/calendar\/staff\/handoff\.js/);
  assert.match(page, /Shiloh Workspace/);
  assert.doesNotMatch(page, /Shiloh Calendar/);
  assert.doesNotMatch(page, /\/calendar\/staff\/client\.js/);
  assert.doesNotMatch(page, new RegExp(token));

  const script = staffCalendarHandoffClientScript();
  assert.match(script, /\^#handoff=\(\[A-Za-z0-9_-\]\{43\}\)\$/);
  assert.match(script, /calendar-handoff\/exchange/);
  assert.match(script, /Open Workspace/);
  assert.match(script, /window\.location\.replace\(CALENDAR_PATH\)/);
  assert.ok(script.indexOf('window.history.replaceState') < script.indexOf("postJson(AUTH_BASE+'/calendar-handoff/exchange'"), 'fragment must be removed before network exchange');
  assert.doesNotMatch(url.split('#')[0], /handoff=/);

  const route = read('src/routes/staffCalendarAccessUx.js');
  assert.match(route, /router\.get\('\/handoff', createStaffCalendarHandoffPageHandler\(options\)\)/);
  assert.doesNotMatch(route, /decorateHandoffAccessPage/);
});

test('handoff remains canonical session transport only and cannot write scheduling business state', () => {
  const handoff = read('src/services/staffCalendarHandoff.js');
  const route = read('src/routes/staffBrowserSession.js');
  assert.match(handoff, /resolveAuthority\(client, \{ whatsapp: normalized, forUpdate: true \}\)/);
  assert.match(handoff, /const adminId = Number\(handoff\?\.admin_id\)/);
  assert.match(handoff, /resolveAuthority\(client, \{ adminId, forUpdate: true \}\)/);
  assert.match(handoff, /issueStaffBrowserSession\(\{/);
  assert.match(handoff, /consumed_at IS NULL/);
  assert.match(handoff, /revoked_at IS NULL/);
  assert.match(route, /router\.post\('\/calendar-handoff\/exchange', sameOrigin/);
  assert.match(route, /return sendAuthenticatedSession\(res, result\)/);
  assert.doesNotMatch(handoff, /INSERT INTO appointments|UPDATE appointments|DELETE FROM appointments/i);
  assert.doesNotMatch(handoff, /EMERGENCY_ADMIN_ID|staffBrowserPilotGate|SHILOH_STAFF_BROWSER_PILOT|SHILOH_EMERGENCY_CHRISTEL_CALENDAR_BOOKING_ENABLED/);
});
