'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./support/clinicIpadHandoverFixture');
const {createMyShilohProfileService}=require('../src/services/myShilohProfile');
const options={realPostgres:Boolean(process.env.TEST_IPAD_DATABASE_URL)};
async function prepare(f) {const result=await f.service.queueForm(2,1,42,7);return result.handoffId;}
async function handover(f) {const id=await prepare(f);await f.service.confirmHandover(3,1,id,true);return f.service.formDetails(f.deviceToken);}
function confirmation(details,dob) {return {confirmationToken:details.confirmationToken,detailsCorrect:'yes',...(dob?{dateOfBirth:dob}:{})};}
test('explicit authorized handover binds one device, client and assignment before disclosure',async()=>{
  const f=await fixture(options);try {
    await assert.rejects(f.service.queueForm(4,1,42,7),{httpStatus:403});
    await assert.rejects(f.service.queueForm(2,1,43,7),{httpStatus:409});
    const id=await prepare(f);
    assert.equal(await f.service.readyForm(f.deviceToken),false);
    await assert.rejects(f.service.formDetails(f.deviceToken),{httpStatus:409});
    await assert.rejects(f.service.confirmHandover(4,1,id,true),{httpStatus:403});
    await assert.rejects(f.service.confirmHandover(2,1,id,false),{httpStatus:422});
    await assert.rejects(f.service.confirmHandover(2,2,id,true),{httpStatus:409});
    await f.service.confirmHandover(3,1,id,true);
    await assert.rejects(f.service.confirmHandover(3,1,id,true),{httpStatus:409});
    const details=await f.service.formDetails(f.deviceToken);assert.match(details.mobile,/4567/);assert.equal(details.dateOfBirth,null);
    await assert.rejects(f.service.formDetails(f.otherDeviceToken),{httpStatus:409});
    const rows=(await f.db.query('SELECT event_type,metadata FROM staff_auth_security_events')).rows;
    assert.deepEqual(rows.map(r=>r.event_type),['clinic_ipad_handover_prepared','clinic_ipad_handover_confirmed']);
    assert.equal(String(rows[1].metadata.clientId),'10');assert.doesNotMatch(JSON.stringify(rows),/27821234567|dateOfBirth|confirmationToken/);
  }finally{await f.close();}
});
test('missing DOB is validated and atomically saved to only the bound CRM record with one-use claim',async()=>{
  const f=await fixture(options);try {
    const details=await handover(f);
    for(const dob of ['','2035-01-01','2020-02-31'])await assert.rejects(f.service.beginForm(f.deviceToken,confirmation(details,dob)),{httpStatus:422});
    await assert.rejects(f.service.beginForm(f.deviceToken,{...confirmation(details,'1985-05-14'),clientId:11}),{httpStatus:422});
    const outcomes=await Promise.allSettled([f.service.beginForm(f.deviceToken,confirmation(details,'1985-05-14')),f.service.beginForm(f.deviceToken,confirmation(details,'1985-05-14'))]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    const successful=outcomes.find(r=>r.status==='fulfilled').value;
    assert.deepEqual(await f.service.formAccess(successful.formToken,successful.visitToken),{kiosk:true,allowed:true});
    const clients=(await f.db.query('SELECT id,date_of_birth::text FROM crm_v2_clients ORDER BY id')).rows;
    assert.equal(clients[0].date_of_birth,'1985-05-14');assert.equal(clients[1].date_of_birth,null);
    await assert.rejects(f.service.formDetails(f.deviceToken),{httpStatus:409});
    await f.service.cancelDeviceForm(f.deviceToken);
    assert.deepEqual(await f.service.formAccess(successful.formToken,successful.visitToken),{kiosk:true,allowed:false});
  }finally{await f.close();}
});
test('existing DOB cannot be overwritten and stale CRM/appointment identity requires new staff handover',async()=>{
  const f=await fixture({...options,dob:'1985-05-14'});try {
    const details=await handover(f);
    await assert.rejects(f.service.beginForm(f.deviceToken,confirmation(details,'1990-01-01')),{httpStatus:422});
    await assert.rejects(f.service.beginForm(f.deviceToken,{...confirmation(details),mobile:'0829876543'}),{httpStatus:422});
    await f.db.query("UPDATE crm_v2_clients SET normalized_mobile='27821234568',updated_at=NOW() WHERE id=10");
    await assert.rejects(f.service.formDetails(f.deviceToken),{httpStatus:409});
    await assert.rejects(f.service.beginForm(f.deviceToken,confirmation(details)),{httpStatus:409});
    assert.equal((await f.db.query('SELECT date_of_birth::text FROM crm_v2_clients WHERE id=10')).rows[0].date_of_birth,'1985-05-14');
  }finally{await f.close();}
});
test('expired, revoked, cancelled, reassigned and completed forms fail closed',async()=>{
  for(const change of ['expired','revoked','cancelled','reassigned','completed']) {
    const f=await fixture(options);try {
      const details=await handover(f);
      if(change==='expired')f.setClock(new Date(Date.now()+16*60*1000));
      if(change==='revoked')await f.service.revoke(2,1);
      if(change==='cancelled')await f.service.cancelDeviceForm(f.deviceToken,{includeQueued:true});
      if(change==='reassigned')await f.db.query('UPDATE appointments SET crm_v2_client_id=11 WHERE id=42');
      if(change==='completed')await f.db.query("UPDATE consultation_form_assignments SET status='completed' WHERE id=7");
      await assert.rejects(f.service.beginForm(f.deviceToken,confirmation(details,'1985-05-14')));
      await assert.rejects(f.service.formDetails(f.deviceToken));
      assert.equal((await f.db.query('SELECT date_of_birth FROM crm_v2_clients WHERE id=10')).rows[0].date_of_birth,null);
    }finally{await f.close();}
  }
});
test('audit failure rolls back DOB, token issuance and claim together',async()=>{
  const f=await fixture(options);try {
    const details=await handover(f);
    await f.db.query("ALTER TABLE staff_auth_security_events ADD CONSTRAINT fail_claim_audit CHECK(event_type<>'clinic_ipad_handover_claimed')");
    await assert.rejects(f.service.beginForm(f.deviceToken,confirmation(details,'1985-05-14')));
    assert.equal((await f.db.query('SELECT date_of_birth FROM crm_v2_clients WHERE id=10')).rows[0].date_of_birth,null);
    assert.equal((await f.db.query('SELECT access_token_hash FROM consultation_form_assignments WHERE id=7')).rows[0].access_token_hash,null);
    assert.equal((await f.db.query('SELECT status FROM clinic_checkin_form_handoffs')).rows[0].status,'queued');
  }finally{await f.close();}
});
test('one-time DOB request is account-bound and advisory for existing clients',async()=>{
  const f=await fixture(options);try {
    await f.db.query('UPDATE crm_v2_clients SET mobile_verified_at=NOW() WHERE id=10');
    const profile=createMyShilohProfileService({db:f.db});
    const loaded=await profile.loadProfile({crmV2ClientId:10});
    assert.equal(loaded.requiresDobBeforeBooking,false);assert.equal(loaded.dobRequestNeeded,true);
    await assert.rejects(profile.acknowledgeDobRequest({sessionId:77,crmV2ClientId:11}),{httpStatus:401});
    await Promise.all([profile.acknowledgeDobRequest({sessionId:77,crmV2ClientId:10}),profile.acknowledgeDobRequest({sessionId:77,crmV2ClientId:10})]);
    assert.equal((await profile.loadProfile({crmV2ClientId:10})).dobRequestNeeded,false);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM client_auth_security_events')).rows[0].n,1);
    await f.db.query("UPDATE crm_v2_clients SET provenance='{\"actorReference\":\"my_shiloh_sms\"}' WHERE id=11");
    await f.db.query('UPDATE crm_v2_clients SET mobile_verified_at=NOW() WHERE id=11');
    await f.db.query('DELETE FROM consultation_form_assignments WHERE appointment_id=43');await f.db.query('DELETE FROM appointments WHERE id=43');
    assert.equal((await profile.loadProfile({crmV2ClientId:11})).requiresDobBeforeBooking,true);
  }finally{await f.close();}
});

test('note existence obeys canonical notes authority and never returns contents',async()=>{
  const f=await fixture(options);try {
    const {createWorkspaceAppointmentNotesService}=require('../src/services/workspaceAppointmentNotes');
    const notes=createWorkspaceAppointmentNotesService({db:f.db});
    await f.db.query("UPDATE appointments SET notes='SYNTHETIC PRIVATE BOOKING NOTE' WHERE id=42");
    const present=await notes.presence({adminId:2,appointmentIds:[42,43]});assert.deepEqual([...present],['42']);
    await assert.rejects(notes.presence({adminId:4,appointmentIds:[42]}),{httpStatus:403});
    await f.db.query("UPDATE staff_admin_accounts SET permissions='{\"schedule:manage\":true}',service_scope='own_services',staff_id=12 WHERE id=3");
    await f.db.query("INSERT INTO staff VALUES(12,'active')");
    await f.db.query('CREATE TABLE staff_services(staff_id bigint,service_id bigint)');await f.db.query('CREATE TABLE services(id bigint,status text)');
    await f.db.query('INSERT INTO staff_services VALUES(12,8)');await f.db.query("INSERT INTO services VALUES(8,'active')");
    assert.equal((await notes.presence({adminId:3,appointmentIds:[42]})).size,0);
    await f.db.query("UPDATE appointments SET notes='   ' WHERE id=42");assert.equal((await notes.presence({adminId:2,appointmentIds:[42]})).size,0);
  }finally{await f.close();}
});

test('a DOB supplied concurrently by staff is preserved and the stale missing-DOB confirmation is rejected',async()=>{
  const f=await fixture(options);try {
    const details=await handover(f);
    const staff=await f.db.connect();
    await staff.query('BEGIN');await staff.query("UPDATE crm_v2_clients SET date_of_birth='1990-01-01',updated_at=NOW() WHERE id=10");
    const claiming=f.service.beginForm(f.deviceToken,confirmation(details,'1985-05-14'));
    const observed=claiming.then(()=>null,error=>error);
    await staff.query('COMMIT');staff.release();
    assert.equal((await observed).httpStatus,409);
    assert.equal((await f.db.query('SELECT date_of_birth::text FROM crm_v2_clients WHERE id=10')).rows[0].date_of_birth,'1990-01-01');
    const prepared=(await f.db.query('SELECT id FROM clinic_checkin_form_handoffs')).rows[0].id;
    await assert.rejects(f.service.cancelHandover(4,1,prepared),{httpStatus:403});
    await f.service.cancelHandover(3,1,prepared);
    const fresh=await handover(f);assert.equal(fresh.dateOfBirth,'1990-01-01');
    await assert.rejects(f.service.beginForm(f.deviceToken,confirmation(details,'1985-05-14')),{httpStatus:409});
  }finally{await f.close();}
});

test('finishing the bound visit atomically expires access and audits once',async()=>{
  const f=await fixture(options);try{
    const details=await handover(f);const visit=await f.service.beginForm(f.deviceToken,confirmation(details,'1985-05-14'));
    assert.equal(await f.service.finishForm(visit.formToken,'x'.repeat(43)),false);
    assert.equal(await f.service.finishForm(visit.formToken,visit.visitToken),true);
    assert.equal(await f.service.finishForm(visit.formToken,visit.visitToken),false);
    assert.equal((await f.service.formAccess(visit.formToken,visit.visitToken)).allowed,false);
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM staff_auth_security_events WHERE event_type='clinic_ipad_handover_finished'")).rows[0].n,1);
  }finally{await f.close();}
});
