'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createMyShilohBookingService } = require('../src/services/myShilohBooking');
const { renderMyShilohBookingPage } = require('../src/presentation/myShilohBooking');
const { renderMyShilohPage } = require('../src/presentation/myShilohPwa');
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('signed-in My Shiloh booking stays inside the app instead of /book', () => {
  const authenticated = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue: [{ id:1, name:'Hot Stone Massage', category:'Massage', duration:'60 min', price:'R650' }],
    client: { id:'55', name:'Naledi Mokoena', firstName:'Naledi' },
  });
  assert.match(authenticated, /href="\/my-shiloh\/book">Book an appointment/);
  assert.match(authenticated, /href="\/my-shiloh\/book">Book this service/);

  const guest = renderMyShilohPage({
    whatsappNumber: '27830000000',
    catalogue: [],
    client: null,
  });
  assert.match(guest, /href="\/book">Book an appointment/);

  const experience = buildClientExperience({
    generatedAt:'2026-09-23T18:00:00.000Z',
    client:{ id:55, name:'Naledi Mokoena' },
    nextAppointment:null,
    forms:[],
    payment:null,
  });
  assert.equal(experience.home.primaryAction.href, '/my-shiloh/book');
});

test('native booking page is a My Shiloh treatment-practitioner-time-review wizard', () => {
  const html = renderMyShilohBookingPage({
    catalogue:[{ id:1, name:'Hot Stone Massage', category:'Massage', duration:'60 min', price:'R650' }],
    clientFirstName:'Naledi',
    csrfToken:'csrf-test',
    bookingPolicyText:'Shiloh Booking Policy',
    depositPolicy:{
      rateBasisPoints:5000,
      freeNoticeHours:48,
      partialNoticeHours:24,
      partialForfeitBasisPoints:5000,
      lateForfeitBasisPoints:10000,
    },
  });
  assert.match(html, /Choose your next appointment, Naledi/);
  assert.match(html, /1 · Treatment/);
  assert.match(html, /2 · Practitioner/);
  assert.match(html, /3 · Time/);
  assert.match(html, /4 · Review/);
  assert.match(html, /50% is required after Shiloh approves/);
  assert.match(html, /Marietjie’s appointments are deposit-exempt/);
  assert.match(html, /data-submit-booking/);
  assert.match(html, /\/my-shiloh\/assets\/booking\.js/);
  assert.doesNotMatch(html, /wa\.me|whatsapp:\/\//i);
});

test('booking routes are session-owned and confirmation is same-origin + CSRF protected', () => {
  const route = read('src/routes/myShiloh.js');
  assert.match(route, /router\.get\('\/my-shiloh\/book', requireSession/);
  assert.match(route, /router\.get\('\/my-shiloh\/api\/booking\/practitioners', requireSession/);
  assert.match(route, /router\.get\('\/my-shiloh\/api\/booking\/availability', requireSession/);
  assert.match(route, /router\.post\('\/my-shiloh\/api\/booking\/confirm', sameOrigin, requireSession, requireCsrf/);
  assert.doesNotMatch(route, /payload\.crmV2ClientId|req\.body\?\.crmV2ClientId/);
  assert.match(route, /req\.myShilohClientSession\.crmV2ClientId/);
});

test('native booking reuses canonical client booking authorities rather than creating a second engine', () => {
  const service = read('src/services/myShilohBooking.js');
  assert.match(service, /authoritativeSlotsForIntent/);
  assert.match(service, /resolveEligibleStaff/);
  assert.match(service, /resolveWhatsAppBookingIdentity/);
  assert.match(service, /commitAcceptedClientBooking/);
  assert.match(service, /stageCreatedBookingForApproval/);
  assert.match(service, /recordAcceptance/);
  assert.match(read('src/services/clientBookingCommit.js'), /policyChannel: lockedIntent\.policy_channel/);
  assert.doesNotMatch(service, /INSERT INTO appointments/);
  assert.doesNotMatch(service, /INSERT INTO appointment_staff/);
  assert.doesNotMatch(service, /INSERT INTO appointment_services/);
});

test('native booking request is bound to signed-in CRM V2 identity and stages Workspace approval', async () => {
  const queries = [];
  const db = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes('FROM crm_v2_clients')) {
        return { rows:[{ id:55, name:'Naledi Mokoena', normalized_mobile:'27821234567', status:'active', profile_status:'registered' }], rowCount:1 };
      }
      if (sql.includes('FROM services s')) {
        return { rows:[{
          id:7, name:'Hot Stone Massage', status:'active', price:'650.00', variable_price:false,
          duration_minutes:60, processing_time_minutes:0, extra_time_minutes:0, category_name:'Massage',
        }], rowCount:1 };
      }
      if (sql.includes('FROM booking_intents')) return { rows:[], rowCount:0 };
      if (sql.includes('INSERT INTO booking_intents')) return { rows:[{ phone:'27821234567' }], rowCount:1 };
      if (sql.includes('DELETE FROM booking_intents')) return { rows:[], rowCount:1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const calls = [];
  const startsAt = '2026-09-30T08:00:00.000Z';
  const service = createMyShilohBookingService({
    db,
    catalogueProvider:async()=>[],
    eligibleStaff:async()=>[{ id:11, display_name:'Christel' }],
    availability:async()=>({
      status:'available',
      slots:[{
        staff_id:11,
        staff_name:'Christel',
        service_id:7,
        service_name:'Hot Stone Massage',
        starts_at:startsAt,
        ends_at:'2026-09-30T09:00:00.000Z',
      }],
    }),
    identityResolver:async phone=>({
      status:'unique',
      bookingReady:true,
      clientIdentity:{ identityModel:'crm_v2', crmV2ClientId:'55' },
      client:{ id:'55', name:'Naledi Mokoena', normalizedMobile:phone, status:'active' },
    }),
    ensureIntentTable:async()=>calls.push(['ensureIntentTable']),
    ensurePolicy:async()=>calls.push(['ensurePolicy']),
    acceptPolicy:async(phone, channel)=>{ calls.push(['acceptPolicy',phone,channel]); return { phone }; },
    commitBooking:async(phone)=>{ calls.push(['commit',phone]); return { handled:true,status:'created',appointmentId:812 }; },
    stageApproval:async result=>{ calls.push(['stage',result.appointmentId]); return { ...result,status:'pending_resolution' }; },
    depositPolicy:{ async loadPolicy(){ return { rateBasisPoints:5000, exemptStaffId:13 }; } },
    now:()=>new Date('2026-09-23T18:00:00.000Z'),
  });

  const result = await service.createRequest({
    crmV2ClientId:55,
    serviceId:7,
    staffId:11,
    startsAt,
    policyAccepted:true,
  });

  assert.equal(result.status, 'pending_resolution');
  assert.equal(result.appointmentId, 812);
  assert.deepEqual(calls.find(item=>item[0]==='acceptPolicy'), ['acceptPolicy','27821234567','my_shiloh']);
  assert.deepEqual(calls.find(item=>item[0]==='commit'), ['commit','27821234567']);
  assert.deepEqual(calls.find(item=>item[0]==='stage'), ['stage',812]);
  assert.equal(queries.some(call=>call.sql.includes('INSERT INTO appointments')), false);
});
