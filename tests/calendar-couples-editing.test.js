const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createCalendarCouplesEditingService } = require('../src/services/calendarCouplesEditing');

test('paired edits preserve identities, durations and paid allocations; stale, unauthorized, final and conflicting edits fail atomically', async () => {
  const sql = new PGlite();
  await sql.exec(fs.readFileSync('tests/fixtures/couples-edit-schema.sql','utf8'));
  // PGlite has one connection; advisory locks are verified separately with PostgreSQL.
  await sql.exec(`CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE SQL AS 'SELECT NULL::void';`);
  const query = async (text, values = []) => { const result = await sql.query(text,values); return { ...result, rowCount: result.rows.length }; };
  const client = { query, release() {} };
  const db = { query, connect: async () => client };
  const service = createCalendarCouplesEditingService({ db,now: () => new Date('2026-10-12'),clinicHours: async () => ({ covered:true }),authoritativeSchedule: async () => ({ covered:true }) });
  const load = appointmentId => service.get({adminId:1,appointmentId});
  function payload(state, requestId) { return { requestId,expectedGroupRevision:state.revision,members:state.members.map(row=>({appointmentId:row.appointmentId,expectedRevision:row.revision,notes:'Updated '+row.appointmentId})) }; }
  const save = (input, adminId=1) => service.update({adminId,appointmentId:101,input});
  const protectedState = async () => ({
    members:(await query('SELECT id,crm_v2_client_id,total_price,currency,status,ends_at-starts_at AS duration FROM appointments ORDER BY id')).rows,
    links:(await query('SELECT * FROM appointment_group_members ORDER BY guest_position')).rows,
    payments:(await query('SELECT * FROM payment_requests')).rows,
    total:(await query('SELECT total_price FROM appointment_groups')).rows,
  });
  try {
    const first = await load(101); assert.deepEqual(first,await load(102)); assert.equal(first.canMove,true);
    const before = await protectedState();
    await assert.rejects(service.get({adminId:2,appointmentId:101}),{code:'CALENDAR_NOTES_FORBIDDEN'});
    await assert.rejects(save(payload(first,'unauthorized_pair'),2),{code:'CALENDAR_NOTES_FORBIDDEN'});
    const changed = payload(first,'save_pair_notes'); await save(changed);
    assert.deepEqual(await protectedState(),before);
    assert.equal((await query('SELECT notes FROM appointments ORDER BY id')).rows[1].notes,'Updated 102');
    assert.equal((await save(changed)).status,'idempotent_replay');
    await assert.rejects(save({...changed,members:changed.members.map(row=>({...row,notes:'Different'}))}),{code:'CALENDAR_COUPLES_EDIT_IDEMPOTENCY_MISMATCH'});
    await assert.rejects(save(payload(first,'stale_pair_notes')),{code:'CALENDAR_COUPLES_EDIT_STALE'});
    const current = await load(102);
    await assert.rejects(save({...payload(current,'wrong_pair_notes'),members:[{...payload(current,'x').members[0],appointmentId:999},payload(current,'x').members[1]]}),{code:'CALENDAR_COUPLES_EDIT_MEMBERS_CHANGED'});
    await assert.rejects(save({...payload(current,'price_is_locked'),total_price:1}),{code:'CALENDAR_COUPLES_EDIT_INVALID_INPUT'});
    const move = {...payload(current,'move_pair_booking'),startsAt:'2026-11-03T08:00:00.000Z'};
    // A conflict for guest 2 must roll back guest 1, lifecycle and audit writes.
    await query("INSERT INTO calendar_blocks VALUES(9,12,'2026-11-03 08:00Z','2026-11-03 09:00Z')");
    const auditBefore = (await query('SELECT COUNT(*) AS n FROM crm_audit_events')).rows[0].n;
    await assert.rejects(save(move),{code:'CALENDAR_OPERATION_CONFLICT'});
    assert.deepEqual(await load(101),current);
    assert.equal((await query('SELECT COUNT(*) AS n FROM crm_audit_events')).rows[0].n,auditBefore);
    await query('DELETE FROM calendar_blocks'); await save(move);
    assert.deepEqual(await protectedState(),before);
    assert.equal((await load(101)).members[0].startsAt,move.startsAt);
    assert.equal((await query('SELECT ends_at FROM appointment_groups')).rows[0].ends_at.toISOString(),'2026-11-03T09:30:00.000Z');
    await sql.exec("UPDATE appointment_groups SET status='completed'; UPDATE appointments SET status='completed'");
    const completed = await load(101); assert.equal(completed.canMove,false);
    const completedBefore = await protectedState();
    await assert.rejects(save({...payload(completed,'completed_move_pair'),startsAt:'2026-11-04T08:00:00.000Z'}),{code:'CALENDAR_COUPLES_EDIT_FINAL'});
    await save(payload(completed,'completed_pair_notes')); assert.deepEqual(await protectedState(),completedBefore);
    await query("UPDATE appointments SET status='cancelled' WHERE id=102");
    await assert.rejects(load(101),{code:'CALENDAR_COUPLES_EDIT_FINAL'});
  } finally { await sql.close(); }
});

test('paired routes enforce session, origin and CSRF before either guest can be edited', async () => {
  const express = require('express');
  const { createCalendarOperationalMutationRouter } = require('../src/routes/calendarOperationalMutations');
  const app = express(); app.use(express.json());
  const received = [];
  app.use('/calendar/operations',createCalendarOperationalMutationRouter({env:{NODE_ENV:'test'},sessionService:{
    validateSessionToken:async token=>token==='signed-in'?{ok:true,adminId:7}:{ok:false},validateCsrfToken:(_session,token)=>token==='csrf',
  },couplesEditingService:{get:async input=>{received.push(input);return{members:[]};},update:async input=>{received.push(input);return{moved:false};}}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/calendar/operations/appointments/101/couples';
  const headers={origin,cookie:'shiloh_staff_session=signed-in','content-type':'application/json','x-shiloh-csrf-token':'csrf'};
  const patch=extra=>fetch(url,{method:'PATCH',headers:{...headers,...extra},body:JSON.stringify({adminId:999})});
  try {
    assert.equal((await fetch(url)).status,401);
    assert.equal((await patch({cookie:''})).status,401);
    assert.equal((await patch({origin:'https://untrusted.example'})).status,403);
    assert.equal((await patch({'x-shiloh-csrf-token':''})).status,403);
    assert.equal(received.length,0);
    const read=await fetch(url,{headers});assert.equal(read.status,200);assert.match(read.headers.get('cache-control'),/no-store/);
    assert.equal((await patch({})).status,200);assert.equal(received[1].adminId,7);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
