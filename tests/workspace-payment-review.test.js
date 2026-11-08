const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspacePaymentReview, cursor, PAGE_SIZE } = require('../src/services/workspacePaymentReview');
const now = new Date('2026-11-06T10:00:00Z');
const candidate = (id, extra = {}) => ({ appointment_id: id, subject_key: `a:${id}`, group_id: null, has_completed: true, ...extra });
const member = (id, extra = {}) => ({ id, crm_v2_client_id: id + 100, client_id: null, clinic_client: true, private_service: false, status: 'completed', starts_at: '2026-10-01T10:00:00Z', currency: 'ZAR', client_name: `Synthetic ${id}`, service_name: 'Synthetic treatment', staff_names: ['Synthetic staff'], staff_ids: [11], service_ids: [21], group_memberships: 0, ...extra });
function fixture({ rows = [], members = {}, balances = {}, operator = {}, fail, elapsedNow } = {}) {
  const calls = [], positions = [];
  const client = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (fail && sql.includes(fail)) throw Error('Synthetic database unavailable');
    if (sql.includes('WorkspacePaymentReview:candidates')) return { rows };
    if (sql.includes('WorkspacePaymentReview:members')) return { rows: members[params[0]] || [member(params[0])] };
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    throw Error('Unexpected SQL');
  }, release() { calls.push({ sql: 'RELEASE' }); } };
  const review = createWorkspacePaymentReview({ db: { connect: async () => client }, now: () => now, elapsedNow,
    resolveOperator: async () => ({ permissions: { 'client:lookup': true, 'appointment:view': true }, business_role: 'owner', calendarAuthority: { calendarScope: 'all_business', serviceScope: 'all_services' }, ...operator }),
    readPosition: async (_client, _operator, id) => { positions.push(id); if (balances[id] instanceof Error) throw balances[id]; return { state: 'known', outstanding: balances[id] ?? '0.00' }; } });
  return { review, calls, positions };
}
test('review delegates recorded balances, deduplicates whole bookings and never creates receipts or totals', async () => {
  const f = fixture({ rows: [candidate(1), candidate(2), candidate(3, { group_id: 7, subject_key: 'g:7' })], members: { 3: [member(3, { group_memberships: 1 }), member(4, { group_memberships: 1 })] }, balances: { 1: '150.00', 2: '0.00', 3: '300.00' } });
  const result = await f.review({ adminId: 1 });
  assert.equal(result.state, 'known');
  assert.deepEqual(result.items.map(i => [i.appointmentId, i.outstanding, i.reason]), [[1, '150.00', 'Completed visit balance'], [3, '300.00', 'Whole booking balance']]);
  assert.equal(result.items[1].members.length, 2);
  assert.deepEqual(f.positions, [1, 2, 3]);
  assert.equal(result.total, undefined);
  assert.equal(result.next, null);
  assert.ok(f.calls.every(c => !/\b(INSERT|UPDATE|DELETE)\b/.test(c.sql)));
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('unknown receipts, exceptions, historical linkage and mixed outcomes never masquerade as unpaid balances', async () => {
  const f = fixture({ rows: [candidate(1, { unrecorded_payment: true }), candidate(2, { recorded_exception: true }), candidate(3), candidate(4, { group_id: 7, subject_key: 'g:7' }), candidate(6), candidate(7)], members: { 3: [member(3, { client_id: 88 })], 4: [member(4, { group_memberships: 1 }), member(5, { status: 'scheduled', group_memberships: 1 })], 6: [member(6, { starts_at: '2027-01-01' })], 7: [member(7, { currency: null })] } });
  const result = await f.review({ adminId: 1 });
  assert.equal(result.items.length, 6);
  assert.ok(result.items.every(i => i.state === 'review' && i.outstanding === null));
  assert.deepEqual(f.positions, []);
  assert.equal(result.items[1].reason, 'Recorded payment exception', 'historic exception is not claimed to be newly uncaptured cash');
});
test('current permissions and every shared member are checked before financial disclosure', async () => {
  for (const operator of [{ permissions: { 'client:lookup': false } }, { calendarAuthority: { calendarScope: 'own_appointments', serviceScope: 'all_services' } }, { business_role: 'tenant_practitioner' }]) {
    const f = fixture({ rows: [candidate(1)], operator });
    assert.equal((await f.review({ adminId: 1 })).state, 'restricted');
    assert.equal(f.calls.some(c => c.sql.includes('candidates')), false);
  }
  for (const extra of [{ private_service: true }, { clinic_client: false }, { staff_ids: [] }]) {
    const f = fixture({ rows: [candidate(1, { group_id: 7, subject_key: 'g:7' })], members: { 1: [member(1, { group_memberships: 1 }), member(2, { ...extra, group_memberships: 1 })] }, balances: { 1: '650.00' } });
    const result = await f.review({ adminId: 1 });
    assert.equal(result.restricted, true);
    assert.deepEqual(result.items, []);
    assert.deepEqual(f.positions, []);
  }
});
test('bounded candidate pagination does not invent a complete count when a page has no outstanding items', async () => {
  const f = fixture({ rows: Array.from({ length: PAGE_SIZE + 1 }, (_, i) => candidate(i + 1)) });
  const result = await f.review({ adminId: 1 });
  assert.deepEqual(result.items, []);
  assert.equal(result.next, '25');
  assert.equal(f.positions.length, PAGE_SIZE);
  assert.equal(result.total, undefined);
  assert.deepEqual(f.calls.find(c => c.sql.includes('candidates')).params, [0]);
});
test('invalid cursor, ambiguity, cancellation, failures and malformed positions cannot yield a false settled page', async () => {
  for (const value of ['0', '-1', '01', '1\n', [], '9007199254740992']) assert.throws(() => cursor(value));
  assert.equal(cursor(undefined), 0);
  assert.equal(cursor('25'), 25);
  for (const options of [{ rows: [candidate(1), candidate(1)] }, { rows: [candidate(1)], members: { 1: [member(1, { group_memberships: 2 })] } }, { rows: [candidate(1)], balances: { 1: 'bad' } }, { fail: 'candidates' }, { rows: [candidate(1)], balances: { 1: Error('unavailable') } }, { elapsedNow: (() => { let i = 0; return () => i++ * 6000; })() }]) {
    const f = fixture(options);
    assert.deepEqual(await f.review({ adminId: 1 }), { state: 'unavailable', items: [], next: null });
    assert.ok(f.calls.some(c => c.sql === 'ROLLBACK'));
  }
  assert.equal((await fixture({ rows: [candidate(1)] }).review({ adminId: 1, isCancelled: () => true })).state, 'unavailable');
});

test('real synthetic SQL and canonical ledger preserve cash, applied credit and shared booking scope without read writes', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const { install } = require('./helpers/priorPaymentFixture');
  const { createBookingPaymentService } = require('../src/services/bookingPayments');
  const pg = new PGlite(); t.after(() => pg.close());
  const seen = [];
  const query = async (sql, params) => { seen.push(sql); const raw = params ? await pg.query(sql, params) : await pg.exec(sql); const r = Array.isArray(raw) ? raw.at(-1) : raw; return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }; };
  const db = { query, connect: async () => ({ query, release() {} }) };
  await install(db);
  await query("CREATE TABLE crm_v2_client_relationships(client_id bigint,relationship_type text,owner_staff_id bigint); INSERT INTO crm_v2_client_relationships VALUES(101,'clinic',NULL),(102,'clinic',NULL); CREATE TABLE service_visibility_policies(service_id bigint,visibility_scope text,owner_staff_id bigint); ALTER TABLE appointments ADD COLUMN source_client_name text; ALTER TABLE appointment_staff ADD COLUMN staff_name_snapshot text;");
  const service = createBookingPaymentService({ db, now: () => now, ozow: { configured: () => false }, rewards: { syncEligibleEarnings: async () => {} }, deposits: { ensureRequirement: async () => ({ applicable: false }), getPosition: async () => ({ applicable: false }) } });
  let mark = seen.length;
  let result = await service.getWorkspaceReview({ adminId: 1 });
  assert.equal(result.state, 'known');
  assert.equal(result.items.find(i => i.appointmentId === 201).outstanding, '500.00');
  assert.ok(seen.slice(mark).every(sql => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
  const revision = new Date((await query('SELECT updated_at FROM appointments WHERE id=201')).rows[0].updated_at).toISOString();
  await service.recordManual({ adminId: 1, appointmentId: 201, amount: '200.00', method: 'cash', operationId: 'synthetic_workspace_review_payment', expectedRevision: revision });
  result = await service.getWorkspaceReview({ adminId: 1 });
  assert.equal(result.items.find(i => i.appointmentId === 201).outstanding, '300.00');
  const account = (await query('SELECT id FROM booking_payment_accounts WHERE appointment_id=201')).rows[0].id;
  await query("INSERT INTO booking_loyalty_allocations(booking_payment_account_id,state,amount) VALUES($1,'applied',300)", [account]);
  mark = seen.length;
  result = await service.getWorkspaceReview({ adminId: 1 });
  assert.equal(result.items.some(i => i.appointmentId === 201), false);
  assert.ok(seen.slice(mark).every(sql => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)));
  await query("INSERT INTO payment_requests(payment_account_id,state,amount,request_key) VALUES($1,'paid',25,'synthetic_workspace_unrecorded')", [account]);
  result = await service.getWorkspaceReview({ adminId: 1 });
  assert.equal(result.items.find(i => i.appointmentId === 201).reason, 'Payment receipt needs verification');
  assert.equal(result.items.find(i => i.appointmentId === 201).outstanding, null);
  for (const state of ['refunded', 'partially_refunded']) {
    await query("UPDATE payment_requests SET state=$1 WHERE request_key='synthetic_workspace_unrecorded'", [state]);
    const reviewed = await service.getWorkspaceReview({ adminId: 1 });
    assert.equal(reviewed.items.find(i => i.appointmentId === 201).reason, 'Payment receipt needs verification');
    assert.equal(reviewed.items.find(i => i.appointmentId === 201).outstanding, null);
  }
  await query("INSERT INTO appointments(id,crm_v2_client_id,status,total_price,currency,updated_at,starts_at,title) VALUES(301,101,'completed',450,'ZAR',NOW(),'2026-10-20T10:00Z','Synthetic shared one'),(302,102,'completed',450,'ZAR',NOW(),'2026-10-19T10:00Z','Synthetic shared two'); INSERT INTO appointment_staff(appointment_id,staff_id,position) VALUES(301,11,1),(302,11,1); INSERT INTO appointment_services VALUES(301,21,'Synthetic shared one',1),(302,21,'Synthetic shared two',1); INSERT INTO appointment_groups(id,status,total_price,updated_at) VALUES(901,'confirmed',900,NOW()); INSERT INTO appointment_group_members(group_id,appointment_id) VALUES(901,301),(901,302);");
  const groupAccount=(await query("INSERT INTO booking_payment_accounts(appointment_group_id,canonical_amount_due,currency,pricing_revision) VALUES(901,900,'ZAR',NOW()) RETURNING id")).rows[0].id;
  await query("INSERT INTO payment_ledger_entries(payment_account_id,entry_type,amount) VALUES($1,'payment',200)",[groupAccount]);
  result=await service.getWorkspaceReview({adminId:1});
  assert.equal(result.items.filter(i=>i.groupId===901).length,1);
  assert.equal(result.items.find(i=>i.groupId===901).outstanding,'700.00');
  assert.equal(result.items.find(i=>i.groupId===901).members.length,2);
  await query("UPDATE appointment_services SET service_id=99 WHERE appointment_id=302; INSERT INTO service_visibility_policies VALUES(99,'tenant_private',11)");
  result=await service.getWorkspaceReview({adminId:1});
  assert.equal(result.items.some(i=>i.groupId===901),false);
  assert.equal(result.restricted,false,'restricted SQL subjects do not expose their identities through pagination');
  await query("UPDATE staff_admin_accounts SET permissions=permissions-'payment:view' WHERE id=1");
  assert.equal((await service.getWorkspaceReview({ adminId: 1 })).state, 'restricted');
});
