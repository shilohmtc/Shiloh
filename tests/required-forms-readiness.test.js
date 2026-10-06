const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createWorkspaceFormsService } = require('../src/services/workspaceForms');
const { createMyShilohClientContextService } = require('../src/services/myShilohClientContext');
const { createWorkspaceFormSubmissionsService } = require('../src/services/workspaceFormSubmissions');

// Execute the production queries against PostgreSQL, including identity and staff scope joins.
test('required mappings, signed submission evidence and staff/client identity determine readiness and history', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE staff (id int PRIMARY KEY,status text);
      CREATE TABLE staff_admin_accounts (id int PRIMARY KEY,staff_id int,display_name text,permissions jsonb,business_role text,calendar_scope text,active boolean);
      CREATE TABLE crm_v2_clients (id int PRIMARY KEY,name text);
      CREATE TABLE clients (id int PRIMARY KEY,display_name text);
      CREATE TABLE appointments (id int PRIMARY KEY,crm_v2_client_id int,client_id int,source_client_name text,starts_at timestamptz,ends_at timestamptz,status text);
      CREATE TABLE appointment_staff (id int,appointment_id int,staff_id int,staff_name_snapshot text,position int);
      CREATE TABLE appointment_services (id int,appointment_id int,service_id int,service_name_snapshot text,position int);
      CREATE TABLE consultation_form_templates (id int PRIMARY KEY,template_key text,title text,status text);
      CREATE TABLE consultation_form_template_versions (id int PRIMARY KEY,template_id int);
      CREATE TABLE consultation_form_service_mappings (service_id int,template_version_id int,required boolean);
      CREATE TABLE consultation_form_assignments (id int PRIMARY KEY,appointment_id int,crm_v2_client_id int,client_id int,template_version_id int,status text);
      CREATE TABLE consultation_form_submissions (id int PRIMARY KEY,assignment_id int,template_version_id int,submitted_at timestamptz,signed_at timestamptz NOT NULL);
      INSERT INTO staff VALUES (40,'active'),(41,'active');
      INSERT INTO staff_admin_accounts VALUES
        (1,40,'Therapist','{"forms:view":true}','practitioner','own_appointments',true),
        (2,NULL,'Reception','{"forms:view":true}','booking_operator','all_business',true),
        (3,41,'Christel','{"forms:view":true}','owner','all_business',true),
        (4,NULL,'JP','{"forms:view":true}','business_admin','all_business',true),
        (5,NULL,'No access','{}','owner','all_business',true);
      INSERT INTO crm_v2_clients VALUES (10,'Client A'),(11,'Client B');
      INSERT INTO appointments SELECT n,CASE WHEN n=103 THEN 11 ELSE 10 END,NULL,NULL,NOW()+interval '1 day',NOW()+interval '2 days','confirmed' FROM generate_series(101,104) n;
      INSERT INTO appointment_staff SELECT n,n,CASE WHEN n=103 THEN 41 ELSE 40 END,'Assigned therapist',0 FROM generate_series(101,104) n;
      INSERT INTO appointment_services SELECT n,n,7,'Massage',0 FROM generate_series(101,104) n;
      INSERT INTO consultation_form_templates VALUES (1,'massage_consultation','Consultation','active');
      INSERT INTO consultation_form_template_versions VALUES (8,1);
      INSERT INTO consultation_form_service_mappings VALUES (7,8,true);
      INSERT INTO consultation_form_assignments VALUES (201,101,10,NULL,8,'opened'),(202,102,10,NULL,8,'completed'),(203,103,11,NULL,8,'completed');
      INSERT INTO consultation_form_submissions VALUES (301,203,8,NOW(),NOW());
      -- Foreign assignment on a required appointment must not make Client A ready.
      INSERT INTO consultation_form_assignments VALUES (204,104,11,NULL,8,'completed');
      INSERT INTO consultation_form_submissions VALUES (302,204,8,NOW(),NOW());
    `);
    const forms = createWorkspaceFormsService({db});
    const own = await forms.listTreatmentQueue({adminId:1});
    assert.deepEqual(own.appointments.map(a=>a.id),[101,102,104]);
    assert.ok(own.appointments.every(a=>!a.readiness.ready));
    assert.equal(own.appointments[0].forms[0].status,'opened');
    assert.equal(own.appointments[1].forms[0].status,'needs_review');
    assert.equal(own.appointments[2].forms[0].status,'not_assigned');
    for(const adminId of [2,3,4]) {
      const queue = await forms.listTreatmentQueue({adminId});
      assert.equal(queue.appointments.length,4);
      assert.equal(queue.appointments.find(a=>a.id===103).readiness.ready,true);
      assert.equal(queue.appointments[0].canOpen,adminId!==2);
    }
    await assert.rejects(forms.listTreatmentQueue({adminId:5}),{httpStatus:403});
    const client = createMyShilohClientContextService({db});
    assert.deepEqual(await client.loadForms(10,103),[]);
    assert.equal((await client.loadForms(10,104))[0].status,'not_assigned');
    assert.equal((await client.loadForms(10,102))[0].actionRequired,true);
    await db.exec("INSERT INTO consultation_form_submissions VALUES (303,202,8,NOW(),NOW());");
    assert.equal((await client.loadForms(10,102))[0].actionRequired,false);
    assert.equal((await forms.listTreatmentQueue({adminId:1})).appointments.find(a=>a.id===102).readiness.ready,true);
    const history = createWorkspaceFormSubmissionsService({db,formsService:forms});
    const ownHistory = await history.listHistory({adminId:1,search:'Client A'});
    assert.deepEqual(ownHistory.items.map(a=>a.reference),['303']);
    assert.ok(ownHistory.items.every(a=>a.canOpen));
    const reception = await history.listHistory({adminId:2});
    assert.ok(reception.items.every(a=>!a.canOpen));
    assert.equal((await history.listHistory({adminId:3,search:'Client B'})).items.length,2);
    assert.equal((await history.listHistory({adminId:4,search:"' OR TRUE --"})).items.length,0);
    await assert.rejects(history.listHistory({adminId:1,page:'-1'}),{httpStatus:422});
    await assert.rejects(history.listHistory({adminId:1,search:['Client A']}),{httpStatus:422});
  } finally { await db.close(); }
});
