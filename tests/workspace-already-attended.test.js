'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { alreadyAttended } = require('../src/services/workspaceAlreadyAttended');
const { listUnresolvedBookingRequests } = require('../src/services/workspaceBookingRequestRouting');
const principal = { id: 7, display_name: 'Synthetic owner', business_role: 'owner', calendar_scope: 'all_business', permissions: { 'appointment:view': true, 'booking:update': true } };
const rev = '2020-01-01T00:00:00.000Z';
async function setup(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE appointments(id bigint PRIMARY KEY,client_id bigint,crm_v2_client_id bigint,location_id bigint,starts_at timestamptz,ends_at timestamptz,status text,updated_at timestamptz,total_price numeric,financial_classification text,pre_adjustment_total_price numeric,source_client_name text,title text);
    CREATE TABLE clients(id bigint,display_name text);
    CREATE TABLE crm_v2_clients(id bigint,name text,status text,normalized_mobile text);
    CREATE TABLE staff(id bigint,display_name text,status text,resource_type text);
    CREATE TABLE services(id bigint,name text,status text);
    CREATE TABLE locations(id bigint,name text,status text);
    CREATE TABLE client_contacts(client_id bigint,contact_type text,normalized_value text,is_primary boolean,id bigint);
    CREATE TABLE appointment_staff(id bigint,appointment_id bigint,position int,staff_id bigint,staff_name_snapshot text);
    CREATE TABLE appointment_services(id bigint,appointment_id bigint,position int,service_id bigint,service_name_snapshot text);
    CREATE TABLE appointment_group_members(group_id bigint,appointment_id bigint,guest_position int);
    CREATE TABLE appointment_groups(id bigint,source text,group_type text,final_total numeric);
    CREATE TABLE staff_operational_team_members(staff_id bigint,team_id bigint,active boolean);
    CREATE TABLE staff_operational_teams(id bigint,display_name text,active boolean);
    CREATE TABLE staff_services(staff_id bigint,service_id bigint);
    CREATE TABLE appointment_booking_approvals(appointment_id bigint PRIMARY KEY,approver_staff_id bigint,status text,requested_at timestamptz,requested_revision timestamptz,requested_client_id bigint,requested_crm_v2_client_id bigint,requested_location_id bigint,requested_staff_id bigint,requested_staff_ids bigint[],requested_service_id bigint,requested_service_ids bigint[],requested_starts_at timestamptz,requested_ends_at timestamptz,decided_at timestamptz,decided_by_admin_id bigint,decision_note text,updated_at timestamptz,proposal_version int DEFAULT 0,proposal_expires_at timestamptz,proposed_staff_id bigint,proposed_starts_at timestamptz,proposed_ends_at timestamptz,planning_started_at timestamptz,client_occasion_note text,client_special_occasion boolean);
    CREATE TABLE appointment_status_history(appointment_id bigint,from_status text,to_status text,changed_by text,reason text);
    CREATE TABLE appointment_lifecycle(appointment_id bigint,status text,updated_at timestamptz);
    CREATE TABLE crm_audit_events(actor_admin_id bigint,action text,entity_type text,entity_id text,metadata jsonb);
    INSERT INTO clients VALUES(1,'Synthetic client');
    INSERT INTO staff VALUES(11,'Synthetic practitioner','active','practitioner');
    INSERT INTO services VALUES(21,'Synthetic treatment','active');
    INSERT INTO staff_services VALUES(11,21);
    INSERT INTO appointments VALUES(100,1,NULL,31,'2020-01-02 10:00Z','2020-01-02 11:00Z','scheduled','2020-01-01',500,'standard',NULL,NULL,NULL);
    INSERT INTO appointment_staff VALUES(1,100,1,11,'Practitioner');
    INSERT INTO appointment_services VALUES(1,100,1,21,'Treatment');
    INSERT INTO appointment_lifecycle VALUES(100,'scheduled','2020-01-01');
    INSERT INTO appointment_booking_approvals(appointment_id,approver_staff_id,status,requested_revision,requested_client_id,requested_location_id,requested_staff_id,requested_staff_ids,requested_service_id,requested_service_ids,requested_starts_at,requested_ends_at)
      VALUES(100,11,'pending','2020-01-01',1,31,11,ARRAY[11],21,ARRAY[21],'2020-01-02 10:00Z','2020-01-02 11:00Z');
    UPDATE appointment_booking_approvals SET updated_at='2020-01-01';
  `);
  let failAudit = false;
  const sql = [];
  const query = async (statement, params) => {
    sql.push(statement);
    if (failAudit && statement.includes("'client.booking_request.already_attended'")) throw new Error('synthetic audit failure');
    return pg.query(statement, params);
  };
  const dbPool = { query, connect: async () => ({ query, release() {} }) };
  const input = { dbPool, principal, appointmentId: 100, expectedRevision: rev, expectedAppointmentRevision: rev, expectedApprovalRevision: rev };
  return { pg, input, sql, failAudit: () => { failAudit = true; } };
}
async function state(pg) {
  const result = {};
  for (const table of ['appointments', 'appointment_booking_approvals', 'appointment_lifecycle', 'appointment_status_history', 'crm_audit_events']) result[table] = (await pg.query(`SELECT * FROM ${table}`)).rows;
  return result;
}
test('one atomic action completes visit, clears queue, retains booking snapshot and writes both audits', async t => {
  const { pg, input, sql } = await setup(t);
  const before = await state(pg);
  assert.equal((await listUnresolvedBookingRequests({ db: input.dbPool, principal })).length, 1);
  assert.equal((await alreadyAttended(input)).ok, true);
  const after = await state(pg);
  assert.equal(after.appointments[0].status, 'completed');
  assert.equal(Number(after.appointments[0].total_price), 500);
  assert.equal(after.appointment_lifecycle[0].status, 'completed');
  assert.equal(after.appointment_status_history.length, 1);
  assert.equal(after.crm_audit_events.length, 2);
  assert.equal(after.appointment_booking_approvals[0].decision_note, 'workspace_already_attended');
  assert.deepEqual(after.appointment_booking_approvals[0].requested_revision, before.appointment_booking_approvals[0].requested_revision);
  assert.equal((await listUnresolvedBookingRequests({ db: input.dbPool, principal })).length, 0);
  assert.equal(sql.filter(s => s === 'COMMIT').length, 1);
  assert.ok(sql.some(s => s.includes('FOR UPDATE OF aba,a,ast,aps')));
  assert.ok(!sql.some(s => /INSERT INTO.*(payment|notification|outbox)|CREATE TABLE|ALTER TABLE/.test(s)));
  await assert.rejects(alreadyAttended(input), { code: 'BOOKING_REQUEST_STALE' });
  assert.deepEqual(await state(pg), after);
});
test('existing completed no-charge visit only resolves approval, preserving outcome, lifecycle and money', async t => {
  const { pg, input } = await setup(t);
  await pg.exec("UPDATE appointments SET status='completed',financial_classification='no_charge',total_price=0,pre_adjustment_total_price=500,updated_at='2020-01-03'; UPDATE appointment_lifecycle SET status='completed';");
  input.expectedAppointmentRevision = '2020-01-03T00:00:00.000Z';
  const before = await state(pg);
  await alreadyAttended(input);
  const after = await state(pg);
  assert.deepEqual(after.appointments, before.appointments);
  assert.deepEqual(after.appointment_lifecycle, before.appointment_lifecycle);
  assert.deepEqual(after.appointment_status_history, []);
  assert.equal(after.crm_audit_events.length, 1);
});
test('outstanding proposal is closed without replacing booked time or erasing proposal history', async t => {
  const { pg, input } = await setup(t);
  await pg.exec("UPDATE appointment_booking_approvals SET status='awaiting_client_confirmation',proposal_version=2,proposed_starts_at='2099-01-01',proposal_expires_at='2099-01-02'");
  await alreadyAttended(input);
  const after = await state(pg);
  assert.equal(after.appointments[0].starts_at.toISOString(), '2020-01-02T10:00:00.000Z');
  assert.equal(after.appointment_booking_approvals[0].proposal_version, 2);
  assert.equal(after.appointment_booking_approvals[0].status, 'approved');
});
for (const [name, change, code] of [
  ['future end', "UPDATE appointments SET ends_at='2099-01-01'", 'BOOKING_REQUEST_NOT_ENDED'],
  ['cancelled', "UPDATE appointments SET status='cancelled'", 'BOOKING_REQUEST_STALE'],
  ['no-show', "UPDATE appointments SET status='no_show'", 'BOOKING_REQUEST_STALE'],
  ['changed appointment revision', "UPDATE appointments SET updated_at='2020-01-04'", 'BOOKING_REQUEST_STALE'],
  ['new proposal while card is open', "UPDATE appointment_booking_approvals SET updated_at='2020-01-04',proposal_version=1", 'BOOKING_REQUEST_STALE'],
  ['changed approval revision', "UPDATE appointment_booking_approvals SET requested_revision='2020-01-04'", 'BOOKING_REQUEST_STALE'],
  ['changed client', 'UPDATE appointments SET client_id=2', 'BOOKING_REQUEST_CANONICAL_DRIFT'],
  ['changed staff', 'UPDATE appointment_staff SET staff_id=12', 'BOOKING_REQUEST_CANONICAL_DRIFT'],
  ['changed service', 'UPDATE appointment_services SET service_id=22', 'BOOKING_REQUEST_CANONICAL_DRIFT'],
  ['group member', 'INSERT INTO appointment_group_members VALUES(1,100,1)', 'BOOKING_REQUEST_GROUP_REVIEW'],
]) test(`${name} fails closed without any partial writes`, async t => {
  const { pg, input } = await setup(t); await pg.exec(change); const before = await state(pg);
  await assert.rejects(alreadyAttended(input), { code }); assert.deepEqual(await state(pg), before);
});
test('missing revisions and revoked completion or booking-request permission cannot mutate', async t => {
  const { pg, input } = await setup(t); const before = await state(pg);
  await assert.rejects(alreadyAttended({ ...input, expectedAppointmentRevision: null }), { code: 'BOOKING_REQUEST_INVALID' });
  for (const permission of ['booking:update', 'appointment:view', 'booking_requests:manage']) {
    await assert.rejects(alreadyAttended({ ...input, principal: { ...principal, permissions: { ...principal.permissions, [permission]: false } } }), /authority|scope/);
  }
  assert.deepEqual(await state(pg), before);
});
test('audit failure rolls back completion, lifecycle, status history and approval together', async t => {
  const { pg, input, failAudit } = await setup(t); const before = await state(pg); failAudit();
  await assert.rejects(alreadyAttended(input), /synthetic audit failure/);
  assert.deepEqual(await state(pg), before);
});
