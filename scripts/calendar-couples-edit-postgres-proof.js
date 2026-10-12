const { Pool } = require('pg');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createCalendarCouplesEditingService } = require('../src/services/calendarCouplesEditing');

async function main() {
  assert.ok(process.env.TEST_COUPLES_EDIT_DATABASE_URL, 'Dedicated synthetic PostgreSQL URL required');
  const root = new Pool({ connectionString: process.env.TEST_COUPLES_EDIT_DATABASE_URL });
  const schema = `couples_edit_proof_${process.pid}`;
  const db = new Pool({ connectionString: process.env.TEST_COUPLES_EDIT_DATABASE_URL, options: `-c search_path=${schema}`, max:5 });
  try {
    await root.query(`CREATE SCHEMA ${schema}`);
    await db.query(fs.readFileSync('tests/fixtures/couples-edit-schema.sql','utf8'));
    const service=createCalendarCouplesEditingService({ db,now:()=>new Date('2026-10-12'),clinicHours:async()=>({covered:true}),authoritativeSchedule:async()=>({covered:true}) });
    const state=await service.get({adminId:1,appointmentId:101});
    const input={requestId:'postgres_couples_edit_race',expectedGroupRevision:state.revision,members:state.members.map(row=>({appointmentId:row.appointmentId,expectedRevision:row.revision,notes:'Synthetic PostgreSQL edit'}))};
    const save=input=>service.update({adminId:1,appointmentId:101,input});
    const protectedTables=['appointment_group_members','payment_requests'];
    const before=await Promise.all(protectedTables.map(table=>db.query(`SELECT * FROM ${table}`)));
    const race=await Promise.all([save(input),save(input)]);
    assert.equal(race.filter(row=>row.status==='idempotent_replay').length,1);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM crm_audit_events WHERE action='calendar.couples_booking_edited'")).rows[0].n,1);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM appointments WHERE notes='Synthetic PostgreSQL edit'")).rows[0].n,2);
    const current=await service.get({adminId:1,appointmentId:102});
    const move={...input,requestId:'postgres_couples_move',expectedGroupRevision:current.revision,members:current.members.map(row=>({appointmentId:row.appointmentId,expectedRevision:row.revision,notes:'Both retained'})),startsAt:'2026-11-03T08:00:00.000Z'};
    await db.query("INSERT INTO calendar_blocks VALUES(9,12,'2026-11-03 08:00Z','2026-11-03 09:00Z')");
    await assert.rejects(save(move),{code:'CALENDAR_OPERATION_CONFLICT'});
    assert.deepEqual(await service.get({adminId:1,appointmentId:101}),current);
    await db.query('DELETE FROM calendar_blocks');await save(move);
    const after=await Promise.all(protectedTables.map(table=>db.query(`SELECT * FROM ${table}`)));
    before.forEach((result,index)=>assert.deepEqual(after[index].rows,result.rows));
    assert.deepEqual((await db.query('SELECT EXTRACT(EPOCH FROM ends_at-starts_at)::int AS seconds FROM appointments ORDER BY id')).rows,[{seconds:5400},{seconds:3600}]);
    assert.equal((await service.get({adminId:1,appointmentId:102})).startsAt,move.startsAt);
    console.log('Couples PostgreSQL proof passed: concurrent replay, both-member locks, second-guest conflict rollback, shared move, durations and paid allocations preserved.');
  } finally { await db.end();await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await root.end(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
