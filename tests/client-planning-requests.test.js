'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, createClientPlanningRequestService } = require('../src/services/clientPlanningRequests');
const { renderPlanningRequestPage } = require('../src/presentation/myShilohPlanningRequest');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');
const fs = require('node:fs');
const path = require('node:path');

const key = 'a81e1cad-30af-45b4-a204-7d653d1ead31';
const base = { crmV2ClientId:22, submissionKey:key, kind:'flexible', serviceDetail:'Sports massage', specialOccasion:false };
const now = new Date('2026-09-27T04:00:00Z');

test('flexible and group requests validate client choices before a database write', () => {
  assert.equal(validate(base, now).kind, 'flexible');
  assert.throws(() => validate({ ...base, kind:'group' }, now), { code:'PLANNING_GUESTS_REQUIRED' });
  assert.equal(validate({ ...base, kind:'group', guestCount:4, specialOccasion:true, occasionNote:'Birthday' }, now).guests, 4);
  assert.throws(() => validate({ ...base, specialOccasion:true }, now), { code:'PLANNING_OCCASION_REQUIRED' });
  assert.throws(() => validate({ ...base, preferredDate:'2026-02-31' }, now), { code:'PLANNING_DATE_INVALID' });
  assert.throws(() => validate({ ...base, practitionerId:0 }, now), { code:'PLANNING_PRACTITIONER_INVALID' });
});

test('submission is client scoped, idempotent and creates no appointment or payment', async () => {
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.includes('FROM crm_v2_clients')) return { rowCount:1, rows:[{ id:22 }] };
    if (sql.includes('INSERT INTO client_planning_requests')) return { rowCount:1, rows:[{ id:901 }] };
    throw new Error('Unexpected query');
  } };
  const service = createClientPlanningRequestService({ db, now:()=>now });
  assert.deepEqual(await service.submit(base), { id:901, status:'requested', created:true });
  assert.ok(queries.every(item => !/INSERT INTO (appointments|payment_requests|booking_intents)/i.test(item.sql)));
  assert.equal(queries.at(-1).params[2],22);
  assert.equal(queries.at(-1).params[3],'flexible');
});

test('Reception action refuses a practitioner and rechecks an arranged appointment client', async () => {
  const practitioner = { id:3, business_role:'practitioner', calendar_scope:'all_business' };
  const owner = { id:4, business_role:'owner', calendar_scope:'all_business' };
  const db = { async connect() { return {
    async query(sql) {
      if (sql.includes('FROM client_planning_requests')) return { rows:[{ id:901,status:'requested',crm_v2_client_id:22 }] };
      if (sql.includes('FROM appointments')) return { rowCount:0, rows:[] };
      return { rows:[] };
    }, release() {},
  }; } };
  const service = createClientPlanningRequestService({ db });
  await assert.rejects(service.decide({ principal:practitioner,id:901,action:'start_planning' }), { code:'PLANNING_FORBIDDEN' });
  await assert.rejects(service.decide({ principal:owner,id:901,action:'arranged',appointmentId:800 }), { code:'PLANNING_APPOINTMENT_MISMATCH' });
});

test('client and Reception surfaces label requests as unconfirmed and escape client notes', () => {
  const html = renderPlanningRequestPage({ clientFirstName:'Jane', csrfToken:'abc', requests:[{ id:3,request_kind:'group',status:'requested',service_detail:'<spa>' }] });
  assert.match(html,/no appointment is confirmed/i);
  assert.match(html,/&lt;spa&gt;/);
  assert.doesNotMatch(html,/<spa>/);
  const dashboard = renderDashboardPage({
    requestedDateKey:'2026-09-27',operationalDateKey:'2026-09-27',displayName:'Christel',mode:'owner_overview',
    appointments:[],carryOver:[],teamGroups:[],awaitingFinalization:[],bookingRequests:[],rescheduleRequests:[],
    holidayDecisions:[],planningRequests:[{ id:3,request_kind:'group',status:'requested',client_name:'Jane',service_detail:'<spa>',guest_count:4,client_note:'<script>' }],
    calendar:{ timeline:{ staff:[] } },
  });
  assert.match(dashboard,/data-dashboard-planning-request="3"/);
  assert.match(dashboard,/No appointment or payment request has been created/);
  assert.doesNotMatch(dashboard,/<script>/);
});

test('selected service context is escaped and bounded in the Reception request form', () => {
  const html = renderPlanningRequestPage({ serviceDetail:'Deep Tissue <Massage> & care' });
  assert.match(html, /name="serviceDetail"[^>]*>Deep Tissue &lt;Massage&gt; &amp; care<\/textarea>/);
  assert.doesNotMatch(html, /<Massage>/);
});

test('My Shiloh WhatsApp help uses the human Reception number, never the AI number', () => {
  const planning = renderPlanningRequestPage({ humanWhatsAppNumber:'066 239 9138' });
  const app = renderMyShilohPage({ whatsappNumber:'27123456789', humanWhatsAppNumber:'066 239 9138' });
  assert.match(planning, /wa\.me\/27662399138/);
  assert.match(app, /Message Reception/);
  assert.match(app, /wa\.me\/27662399138/);
  assert.doesNotMatch(app, /wa\.me\/27123456789/);
});

test('website planning deep link retains sign-in intent while submission stays session and CSRF guarded', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/myShiloh.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../public/my-shiloh/assets/app.js'), 'utf8');
  assert.match(routes, /router\.get\('\/my-shiloh\/request', optionalSession[\s\S]*?res\.redirect\(303, `\/my-shiloh\/[\s\S]*?#plan-visit`\)[\s\S]*?requireSession/);
  assert.match(routes, /router\.post\('\/my-shiloh\/api\/planning-requests', sameOrigin, requireSession, requireCsrf/);
  assert.match(client, /function signedInLanding\(\)/);
  assert.match(client, /window\.location\.replace\(`\/my-shiloh\/request\$\{planningServiceQuery\(\)\}`\)/);
});

test('retired planning and decline actions never open a write transaction', async () => {
  const service = createClientPlanningRequestService({ db: { async connect() { throw new Error('No write allowed'); } } });
  for (const action of ['start_planning', 'decline', 'cannot_accommodate']) {
    await assert.rejects(service.decide({ principal:{ id:4,business_role:'owner',calendar_scope:'all_business' },id:901,action }), { code:'PLANNING_ACTION_INVALID' });
  }
});

test('arranged requests list every approved upcoming booking and recheck eligibility before linking', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY,name text,normalized_mobile text);
    CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY);
    CREATE TABLE services(id bigint PRIMARY KEY,name text);
    CREATE TABLE staff(id bigint PRIMARY KEY,display_name text);
    CREATE TABLE appointments(id bigint PRIMARY KEY,crm_v2_client_id bigint,starts_at timestamptz,status text);
    CREATE TABLE appointment_booking_approvals(appointment_id bigint PRIMARY KEY,status text);
    CREATE TABLE appointment_services(id bigint PRIMARY KEY,appointment_id bigint,service_id bigint);
    CREATE TABLE appointment_staff(appointment_id bigint,staff_id bigint);
    INSERT INTO crm_v2_clients(id,name) VALUES(22,'Synthetic client'),(23,'Other client');
    INSERT INTO staff_admin_accounts VALUES(4);
    INSERT INTO staff VALUES(7,'Synthetic practitioner');
    INSERT INTO services VALUES(5,'Synthetic treatment');
    INSERT INTO appointments SELECT n,22,NOW()+interval '1 day'*n,'scheduled' FROM generate_series(1,10) n;
    INSERT INTO appointments VALUES(11,23,NOW()+interval '1 day','scheduled'),(12,22,NOW()-interval '1 day','scheduled'),
      (13,22,NOW()+interval '1 day','cancelled'),(14,22,NOW()+interval '1 day','scheduled'),(15,22,NOW()+interval '1 day','confirmed');
    INSERT INTO appointment_booking_approvals VALUES(14,'pending'),(15,'awaiting_client_confirmation'),(10,'approved');
    INSERT INTO appointment_services VALUES(1,10,5);
    INSERT INTO appointment_staff VALUES(10,7);
  `);
  await pg.exec(fs.readFileSync(path.join(__dirname,'../migrations/163_client_planning_requests.sql'),'utf8'));
  await pg.query(`INSERT INTO client_planning_requests(submission_key,payload_digest,crm_v2_client_id,request_kind,service_detail,special_occasion,preferred_date)
    VALUES($1,$2,22,'flexible','Synthetic treatment',false,'2030-12-16')`,[key,'a'.repeat(64)]);
  const db = { query:(...args)=>pg.query(...args), async connect() { return { query:(...args)=>pg.query(...args),release() {} }; } };
  const service=createClientPlanningRequestService({ db });
  const principal={ id:4,business_role:'owner',calendar_scope:'all_business' };
  assert.deepEqual(await service.forReception({ id:3,business_role:'practitioner' }),[]);
  await assert.rejects(service.appointmentsForRequest({ principal:{ id:3,business_role:'practitioner' },id:1 }),{ code:'PLANNING_FORBIDDEN' });
  const items=(await service.appointmentsForRequest({ principal,id:1 })).appointments;
  assert.equal(items.length,10);
  assert.equal(items.at(-1).serviceName,'Synthetic treatment');
  assert.equal(items.at(-1).staffNames,'Synthetic practitioner');
  const queue=await service.forReception(principal);
  assert.equal(queue[0].preferred_date,'2030-12-16');
  assert.deepEqual(queue[0].candidate_appointments.map(row=>Number(row.id)),items.map(row=>Number(row.id)));
  for(const appointmentId of [11,12,13,14,15]) {
    await assert.rejects(service.decide({ principal,id:1,action:'arranged',appointmentId }),{ code:'PLANNING_APPOINTMENT_MISMATCH' });
    assert.equal((await pg.query('SELECT status FROM client_planning_requests WHERE id=1')).rows[0].status,'requested');
  }
  await pg.exec("UPDATE appointments SET status='cancelled' WHERE id=1");
  await assert.rejects(service.decide({ principal,id:1,action:'arranged',appointmentId:1 }),{ code:'PLANNING_APPOINTMENT_MISMATCH' });
  await pg.exec("UPDATE client_planning_requests SET status='planning',planning_started_at=NOW(),planning_by_admin_id=4 WHERE id=1");
  assert.deepEqual(await service.decide({ principal,id:1,action:'arranged',appointmentId:10 }),{ id:1,status:'arranged' });
  const row=(await pg.query('SELECT * FROM client_planning_requests WHERE id=1')).rows[0];
  assert.equal(Number(row.linked_appointment_id),10); assert.equal(Number(row.decided_by_admin_id),4);
  assert.ok(row.planning_started_at); assert.ok(row.decided_at);
  assert.equal((await pg.query('SELECT status FROM appointments WHERE id=10')).rows[0].status,'scheduled');
  assert.equal((await service.appointmentsForRequest({ principal,id:1 })).appointments.length,0);
  await assert.rejects(service.decide({ principal,id:1,action:'arranged',appointmentId:10 }),{ code:'PLANNING_ALREADY_RESOLVED' });
});
