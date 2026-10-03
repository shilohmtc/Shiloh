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
  assert.match(dashboard,/has not booked a time or requested payment/);
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
