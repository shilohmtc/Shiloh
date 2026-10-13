'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createWorkspaceClientsService } = require('../src/services/workspaceClients');
const { createWorkspaceFormsService } = require('../src/services/workspaceForms');
const { createWorkspaceFormSubmissionsService } = require('../src/services/workspaceFormSubmissions');
const { renderPolicyDocument, injectClientConsultationHistory } = require('../src/presentation/workspaceClientDocumentsUx');
const { renderClientDetailPage } = require('../src/presentation/workspaceClientsUx');
const express = require('express');
const { createWorkspaceClientsRouter } = require('../src/routes/workspaceClients');

test('client document history uses canonical ownership, clinical permissions and immutable saved evidence', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,name TEXT,normalized_mobile TEXT,status TEXT,
      date_of_birth DATE,gender TEXT,profile_status TEXT,mobile_verified_at TIMESTAMPTZ,source TEXT,created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);
    CREATE TABLE staff(id BIGINT PRIMARY KEY,status TEXT);
    CREATE TABLE staff_admin_accounts(id BIGINT PRIMARY KEY,staff_id BIGINT,display_name TEXT,permissions JSONB,business_role TEXT,calendar_scope TEXT,active BOOLEAN);
    CREATE TABLE appointments(id BIGINT PRIMARY KEY,crm_v2_client_id BIGINT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,source_client_name TEXT);
    CREATE TABLE appointment_services(id BIGINT,appointment_id BIGINT,service_id BIGINT,position INTEGER,service_name_snapshot TEXT);
    CREATE TABLE appointment_staff(id BIGINT,appointment_id BIGINT,staff_id BIGINT,position INTEGER,staff_name_snapshot TEXT);
    CREATE TABLE service_visibility_policies(service_id BIGINT,visibility_scope TEXT,owner_staff_id BIGINT);
    CREATE TABLE booking_policy_acceptances(id BIGINT PRIMARY KEY,phone TEXT,policy_version TEXT,accepted_at TIMESTAMPTZ,channel TEXT,
      service_text TEXT,preferred_date TEXT,preferred_time TEXT,therapist_text TEXT,crm_v2_client_id BIGINT,appointment_id BIGINT);
    CREATE TABLE consultation_form_assignments(id BIGINT PRIMARY KEY,appointment_id BIGINT,crm_v2_client_id BIGINT,client_id BIGINT,status TEXT);
    CREATE TABLE consultation_form_templates(id BIGINT PRIMARY KEY,template_key TEXT,title TEXT);
    CREATE TABLE consultation_form_template_versions(id BIGINT PRIMARY KEY,template_id BIGINT);
    CREATE TABLE consultation_form_submissions(id BIGINT PRIMARY KEY,assignment_id BIGINT,template_version_id BIGINT,
      payload_ciphertext TEXT,payload_iv TEXT,payload_auth_tag TEXT,template_snapshot JSONB,consent_text_snapshot TEXT,signature_method TEXT,signed_at TIMESTAMPTZ,submitted_at TIMESTAMPTZ);
    CREATE TABLE clients(id BIGINT PRIMARY KEY,display_name TEXT);
    CREATE TABLE crm_audit_events(actor_admin_id BIGINT,action TEXT,entity_type TEXT,entity_id BIGINT,metadata JSONB);
    INSERT INTO crm_v2_clients(id,name,normalized_mobile,status) VALUES(1,'Client One','27820000001','active'),(2,'Client Two','27820000002','active');
    INSERT INTO staff VALUES(55,'active');
    INSERT INTO staff_admin_accounts VALUES
      (1,NULL,'Owner','{"client:lookup":true,"forms:view":true}','owner','all_business',true),
      (2,NULL,'Reception','{"client:lookup":true,"forms:view":true}','booking_operator','all_business',true),
      (3,55,'Tenant','{"client:lookup":true,"forms:view":true}','tenant_practitioner','own_appointments',true),
      (4,NULL,'No forms','{"client:lookup":true}','booking_operator','all_business',true);
    INSERT INTO appointments VALUES(11,1,'2030-10-14T08:00:00Z','2030-10-14T09:00:00Z','Client One'),
      (22,2,'2030-10-14T10:00:00Z','2030-10-14T11:00:00Z','Client Two'),
      (33,1,'2030-10-15T08:00:00Z','2030-10-15T09:00:00Z','Client One');
    INSERT INTO appointment_services VALUES(1,11,101,1,'Clinic Massage'),(2,22,101,1,'Clinic Massage'),(3,33,103,1,'Tenant Massage');
    INSERT INTO service_visibility_policies VALUES(103,'tenant_private',55);
    INSERT INTO appointment_staff VALUES(1,11,7,1,'Practitioner'),(2,22,7,1,'Practitioner'),(3,33,55,1,'Tenant');
    INSERT INTO consultation_form_templates VALUES(1,'massage','Current template title');
    INSERT INTO consultation_form_template_versions VALUES(1,1);
    INSERT INTO consultation_form_assignments VALUES(111,11,1,NULL,'completed'),(222,22,2,NULL,'completed'),(333,33,1,NULL,'completed');
    INSERT INTO consultation_form_submissions
      SELECT n,a,1,'synthetic-ciphertext-never-render','iv','tag','{"title":"Original form title","version":1,"sections":[]}'::jsonb,
        'Original signed declaration','typed_name','2030-10-13T08:00:00Z','2030-10-13T08:00:00Z'
      FROM (VALUES(1111,111),(2222,222),(3333,333)) AS x(n,a);
  `);
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/193_client_policy_document_snapshots.sql'),'utf8'));
  await db.exec(`INSERT INTO booking_policy_acceptances(id,phone,policy_version,accepted_at,channel,crm_v2_client_id,appointment_id,policy_text_snapshot)
    VALUES(1,'27820000001','old-v1','2030-10-13T08:00:00Z','my_shiloh',1,11,'Original policy <wording>'),
      (2,'27820000002','old-v1','2030-10-13T08:00:00Z','my_shiloh',2,22,'Client two policy'),
      (3,'27820000001','old-v1','2030-10-13T08:00:00Z','clinic_device',1,33,'Tenant policy'),
      (4,'27820000001','historical-v0','2026-09-13T08:00:00Z','whatsapp',1,NULL,NULL),
      (5,'27820000001','old-v1','2030-10-13T08:00:00Z','whatsapp',NULL,NULL,'Unlinked policy');`);
  const reads = {
    getClient: async (id, { scope }) => {
      if (scope.kind === 'tenant_staff' && id !== 1) return null;
      return (await db.query('SELECT * FROM crm_v2_clients WHERE id=$1',[id])).rows[0];
    },
    getClientAppointments: async () => [],
  };
  let decrypts = 0;
  const submissions = createWorkspaceFormSubmissionsService({ db, formsService: createWorkspaceFormsService({ db }),
    decrypt: () => { decrypts++; return { schemaVersion: 1, answers: { allergies: 'no' }, signature: { name: 'Client One', method: 'typed_name' } }; },
  });
  const service = createWorkspaceClientsService({ db, readService: reads, submissionService: submissions, communicationService: { listForClient: async () => [] } });

  await t.test('profile shows only this client and appointment scope; reception gets status without decrypting', async () => {
    const model = await service.getClientDetail({ adminId: 2, clientId: 1 });
    assert.deepEqual(model.policyAcceptances.map(row => Number(row.id)).sort(),[1,4,5]);
    assert.deepEqual(model.consultationHistory.items.map(row => row.submissionId),[1111]);
    assert.equal(model.consultationHistory.items[0].canOpen,false);
    assert.equal(decrypts,0);
    const html = injectClientConsultationHistory(renderClientDetailPage(model),model);
    assert.match(html,/Private answers restricted/);
    assert.match(html,/Client link not verified/);
    assert.doesNotMatch(html,/consultation-forms\/1111|policy-acceptances\/5|Tenant policy/);
  });
  await t.test('crafted other-client and other-scope URLs fail before decryption', async () => {
    await assert.rejects(service.getPolicyDocument({ adminId:1,clientId:1,acceptanceId:2 }), { httpStatus:404 });
    await assert.rejects(service.getPolicyDocument({ adminId:1,clientId:1,acceptanceId:3 }), { httpStatus:404 });
    await assert.rejects(service.getPolicyDocument({ adminId:1,clientId:1,acceptanceId:5 }), { httpStatus:404 });
    await assert.rejects(service.getConsultationDocument({ adminId:1,clientId:1,submissionId:2222 }), { httpStatus:404 });
    await assert.rejects(service.getConsultationDocument({ adminId:1,clientId:1,submissionId:3333 }), { httpStatus:404 });
    await assert.rejects(service.getConsultationDocument({ adminId:2,clientId:1,submissionId:1111 }), { httpStatus:403 });
    assert.equal(decrypts,0);
  });
  await t.test('owner and assigned tenant can open their scoped original signed records; reads are audited', async () => {
    const original = await service.getConsultationDocument({ adminId:1,clientId:1,submissionId:1111 });
    assert.equal(original.form.title,'Original form title');
    assert.equal(original.form.consentText,'Original signed declaration');
    assert.equal(original.signature.name,'Client One');
    const tenant = await service.getConsultationDocument({ adminId:3,clientId:1,submissionId:3333 });
    assert.equal(tenant.appointment.id,33);
    await assert.rejects(service.getConsultationDocument({ adminId:3,clientId:1,submissionId:1111 }), { httpStatus:404 });
    assert.equal(decrypts,2);
    const policy = await service.getPolicyDocument({ adminId:2,clientId:1,acceptanceId:1 });
    const html = renderPolicyDocument(policy);
    assert.match(html,/Original policy &lt;wording&gt;/);
    assert.match(html,/Print \/ Save PDF/);
    const audit = await db.query('SELECT action FROM crm_audit_events');
    assert.equal(audit.rows.filter(row => row.action === 'workspace.form_submission_viewed').length,2);
    assert.equal(audit.rows.filter(row => row.action === 'workspace.policy_acceptance_viewed').length,1);
  });
  await t.test('historical wording is never invented, and lack of forms authority is explicit', async () => {
    const legacy = await service.getPolicyDocument({ adminId:1,clientId:1,acceptanceId:4 });
    assert.match(renderPolicyDocument(legacy),/policy wording was not captured/);
    assert.doesNotMatch(renderPolicyDocument(legacy),/Policy wording recorded at acceptance/);
    const restricted = await service.getClientDetail({ adminId:4,clientId:1 });
    assert.equal(restricted.consultationHistoryRestricted,true);
    await db.exec('UPDATE staff_admin_accounts SET active=false WHERE id=1');
    await assert.rejects(service.getPolicyDocument({ adminId:1,clientId:1,acceptanceId:1 }), { httpStatus:403 });
    await db.exec('UPDATE staff_admin_accounts SET active=true WHERE id=1');
  });
  await t.test('mounted document routes require staff sessions and preserve private response headers', async () => {
    const app = express();
    app.use('/calendar/clients',createWorkspaceClientsRouter({ service,
      env: { SHILOH_CALENDAR_READONLY_UX_ENABLED:'true', SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true' },
      sessionService: { validateSessionToken: async token => ['owner','reception'].includes(token)
        ? { ok:true,adminId:token === 'owner' ? 1 : 2,viewer:{ calendarScope:'all_business' } } : { ok:false } },
    }));
    const server = app.listen(0,'127.0.0.1');
    await new Promise((resolve,reject) => { server.once('listening',resolve); server.once('error',reject); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/calendar/clients/1`;
      const request = (url, token) => fetch(url,{ headers:{ accept:'application/json',...(token ? { cookie:`shiloh_staff_session=${token}` } : {}) } });
      assert.equal((await request(`${base}/policy-acceptances/1`)).status,401);
      const policy = await request(`${base}/policy-acceptances/1`,'reception');
      assert.equal(policy.status,200);
      assert.match(policy.headers.get('cache-control'),/private, no-store/);
      assert.equal(policy.headers.get('referrer-policy'),'no-referrer');
      assert.equal(policy.headers.get('x-frame-options'),'DENY');
      assert.match(await policy.text(),/Original policy &lt;wording&gt;/);
      assert.equal((await request(`${base}/policy-acceptances/2`,'owner')).status,404);
      assert.equal((await request(`${base}/consultation-forms/1111`,'reception')).status,403);
      const signed = await request(`${base}/consultation-forms/1111`,'owner');
      assert.equal(signed.status,200);
      const html = await signed.text();
      assert.match(html,/Original signed declaration/);
      assert.match(html,/Back to client/);
      assert.match(html,/Print \/ Save PDF/);
      assert.doesNotMatch(html,/synthetic-ciphertext-never-render|payload_ciphertext|payload_auth_tag/);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  await t.test('database rejects rewritten wording, dates and reassignment but permits first exact booking link', async () => {
    for (const change of ["policy_text_snapshot='Changed'","accepted_at=NOW()","phone='27829999999'","crm_v2_client_id=2","appointment_id=22"]) {
      await assert.rejects(db.exec(`UPDATE booking_policy_acceptances SET ${change} WHERE id=1`));
    }
    await db.exec('UPDATE booking_policy_acceptances SET crm_v2_client_id=1,appointment_id=11 WHERE id=5');
    assert.equal(Number((await db.query('SELECT appointment_id FROM booking_policy_acceptances WHERE id=5')).rows[0].appointment_id),11);
    await assert.rejects(db.exec("UPDATE booking_policy_acceptances SET policy_text_snapshot='Guessed history' WHERE id=4"));
  });
});
