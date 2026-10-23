'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('./helpers/calendarCouplesCreationFixture');

for (const grouped of [false,true]) {
  test(`Morning Welcome Offer charges all eligible ${grouped?'group':'couples'} guests atomically, preserving payment totals and retries`,async t=>{
    const f=await createFixture({morningOffer:true});t.after(f.close);
    const service=grouped?f.groupService:f.service;
    const input={...(grouped?f.groupInput:f.input),date:'2099-10-26'};
    const review=await service.prepare(input);
    const count=grouped?3:2;
    assert.equal(Number(review.review.offerPricing.discount),118*count);
    assert.equal(review.review.pricing.total,472*count);
    f.state.failQueue=true;
    await assert.rejects(service.confirm({adminId:7,quoteHash:review.review.quoteHash}),{code:grouped?'GROUP_CONFIRMATION_QUEUE_FAILED':'COUPLES_CONFIRMATION_QUEUE_FAILED'});
    for(const table of ['crm_v2_clients','appointments','morning_offer_booking_prices','appointment_groups'])assert.equal(Number((await f.db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),0,table);
    f.state.failQueue=false;
    await assert.rejects(service.confirm({adminId:7,quoteHash:'0'.repeat(64)}),{code:'BOOKING_OFFER_QUOTE_CHANGED'});
  const result=await service.confirm({adminId:7,quoteHash:review.review.quoteHash});assert.equal(result.appointmentIds.length,count);
    assert.deepEqual((await f.db.query('SELECT total_price FROM appointments ORDER BY id')).rows.map(p=>Number(p.total_price)),Array(count).fill(472));
    assert.deepEqual((await f.db.query('SELECT price_snapshot FROM appointment_services ORDER BY appointment_id')).rows.map(p=>Number(p.price_snapshot)),Array(count).fill(472));
    assert.deepEqual((await f.db.query('SELECT allocated_price FROM appointment_group_members ORDER BY guest_position')).rows.map(p=>Number(p.allocated_price)),Array(count).fill(472));
    const group=(await f.db.query('SELECT total_price,final_total,discounted_by_admin_id FROM appointment_groups')).rows[0];
    assert.equal(Number(group.total_price),472*count);assert.equal(Number(group.final_total),472*count);assert.equal(group.discounted_by_admin_id,null);
    assert.equal(Number((await f.db.query('SELECT SUM(discount_amount) AS saving FROM morning_offer_booking_prices')).rows[0].saving),118*count);
    await assert.rejects(service.confirm({adminId:7,quoteHash:review.review.quoteHash}));
    assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM appointments')).rows[0].n),count);
  });
}
test('manual group promotion replaces Morning Welcome Offer, while the explicit opt-out retains original prices',async t=>{
  const f=await createFixture({morningOffer:true});t.after(f.close);
  const input={...f.input,date:'2099-10-26'};
  let review=await f.service.prepare({...input,discount:{type:'amount',value:100}});
  assert.equal(review.review.offerPricing.discount,'0.00');assert.equal(review.review.pricing.total,1080);
  review=await f.service.prepare({...input,useMorningOffer:false});
  assert.equal(review.review.offerPricing.discount,'0.00');assert.equal(review.review.pricing.total,1180);
  assert.deepEqual(review.review.offerPricing.items.map(p=>p.availableDiscount),['118.00','118.00']);
  await f.service.confirm({adminId:7,quoteHash:review.review.quoteHash});
  assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM morning_offer_booking_prices')).rows[0].n),0);
});
test('publication changes invalidate a pending discounted review without creating clients or appointments',async t=>{
  const f=await createFixture({morningOffer:true});t.after(f.close);
  const review=await f.service.prepare({...f.input,date:'2099-10-26'});
  await f.db.query("UPDATE website_content_posts SET published=NULL WHERE kind='offer'");
  await assert.rejects(f.service.confirm({adminId:7,quoteHash:review.review.quoteHash}),{code:'BOOKING_OFFER_QUOTE_CHANGED'});
  for(const table of ['crm_v2_clients','appointments','morning_offer_booking_prices'])assert.equal(Number((await f.db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),0);
});
test('a returning guest keeps their canonical price while a new guest receives the offer',async t=>{
  const f=await createFixture({morningOffer:true});t.after(f.close);
  await f.db.query("INSERT INTO crm_v2_clients(name,normalized_mobile,profile_status,source) VALUES('Returning guest','27820000001','minimal','staff')");
  const id=(await f.db.query('SELECT id FROM crm_v2_clients')).rows[0].id;
  await f.db.query("INSERT INTO appointments(crm_v2_client_id,starts_at,ends_at,status,total_price) VALUES($1,'2026-10-01T06:00:00Z','2026-10-01T07:30:00Z','completed',590)",[id]);
  const review=await f.service.prepare({...f.input,date:'2099-10-26',guests:[{...f.input.guests[0],clientId:id},f.input.guests[1]]});
  assert.equal(review.review.pricing.total,1062);
  await f.service.confirm({adminId:7,quoteHash:review.review.quoteHash});
  assert.deepEqual((await f.db.query("SELECT total_price FROM appointments WHERE status='scheduled' ORDER BY id")).rows.map(p=>Number(p.total_price)),[590,472]);
});

test('concurrent first-visit dates serialize on the canonical client and recheck history', {skip:!process.env.TEST_CALENDAR_COUPLES_DATABASE_URL}, async t=>{
  const f=await createFixture({morningOffer:true});t.after(f.close);
  const {Client}=require('pg');
  const other=new Client({connectionString:process.env.TEST_CALENDAR_COUPLES_DATABASE_URL});await other.connect();
  t.after(()=>other.end());
  const schema=(await f.db.query('SELECT current_schema() AS name')).rows[0].name;
  assert.match(schema,/^calendar_couples_creation_[0-9_]+$/);
  await other.query(`SET search_path TO ${schema}`);
  await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(55,'Synthetic Client','27821234567','test')");
  const offer=require('../src/services/morningWelcomeOffer').createMorningWelcomeOfferService({db:f.db});
  const item={clientId:55,serviceId:81,staffId:11,price:'590',name:'Massage',category:'Massage',startsAt:'2099-10-26T06:00:00Z'};
  await f.db.query('BEGIN');
  const first=await offer.quoteItems([item],{queryable:f.db,lock:true});assert.equal(first.discount,'118.00');
  await other.query('BEGIN');
  let completed=false;
  const waiting=offer.quoteItems([{...item,startsAt:'2099-10-27T06:00:00Z'}],{queryable:other,lock:true}).then(value=>{completed=true;return value;});
  // Observe the real server lock wait rather than using timing as proof.
  let blocked=false;
  for(let attempt=0;attempt<20&&!blocked;attempt++){
    const locks=await f.db.query('SELECT cardinality(pg_blocking_pids($1)) AS n',[other.processID]);
    blocked=Number(locks.rows[0].n)>0;
    if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(blocked,true);assert.equal(completed,false);
  const appointment=(await f.db.query("INSERT INTO appointments(crm_v2_client_id,starts_at,ends_at,status,total_price) VALUES(55,$1,$1::timestamptz+interval '90 minutes','scheduled',472) RETURNING id",[item.startsAt])).rows[0];
  await offer.record(f.db,{appointmentId:appointment.id,clientId:55,price:first.items[0]});
  await f.db.query('COMMIT');
  const second=await waiting;assert.equal(second.discount,'0.00');await other.query('ROLLBACK');
});

test('My Shiloh paired request persists the reviewed discount, deposit, child prices and approval holds',async t=>{
  const {setup}=require('./helpers/couplesRequestFixture');
  const f=await setup(t,{morningOffer:true,start:'2030-11-04T08:00:00Z'});
  const input=await f.input();const review=await f.service.review(input);
  assert.equal(review.offerPricing.discount,'216.00');assert.equal(review.total,'864.01');
  const result=await f.service.createRequest(input);
  assert.equal(result.total,'864.01');
  assert.deepEqual((await f.query('SELECT total_price FROM appointments ORDER BY id')).rows.map(p=>Number(p.total_price)),[432,432.01]);
  assert.deepEqual((await f.query('SELECT price_snapshot FROM appointment_services ORDER BY appointment_id')).rows.map(p=>Number(p.price_snapshot)),[432,432.01]);
  assert.equal(Number((await f.query('SELECT SUM(discount_amount) AS n FROM morning_offer_booking_prices')).rows[0].n),216);
  assert.equal(Number((await f.query('SELECT total_price FROM appointment_groups')).rows[0].total_price),864.01);
  assert.equal((await f.query('SELECT count(*)::int AS n FROM appointment_booking_approvals')).rows[0].n,2);
  const replay=await f.service.createRequest(input);assert.equal(replay.replay,true);
  assert.equal((await f.query('SELECT count(*)::int AS n FROM morning_offer_booking_prices')).rows[0].n,2);
});

test('ordinary client and Workspace commits save the reviewed final amount and reject stale quotes before writing',async t=>{
  const f=await createFixture({morningOffer:true});t.after(f.close);
  await f.sql.exec(`ALTER TABLE locations ADD name text;UPDATE locations SET name='Synthetic clinic';
    CREATE TABLE booking_intents(phone text PRIMARY KEY,service_text text,preferred_date text,preferred_time text,therapist_text text,service_verified boolean,status text,policy_version text,policy_accepted_at timestamptz,policy_channel text);
    ALTER TABLE admin_booking_sessions ADD client_id bigint,ADD crm_v2_client_id bigint,ADD source_client_name text,ADD client_mobile_snapshot text,ADD staff_id bigint,ADD service_id bigint,ADD location_id bigint,ADD starts_at timestamptz,ADD ends_at timestamptz,ADD state text;
    INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(55,'Synthetic Client','27821234567','test');
    INSERT INTO booking_intents VALUES('27821234567','Synthetic Swedish','2099-10-26','08:30','Synthetic practitioner A',true,'policy_accepted','synthetic-policy',NOW(),'my_shiloh');`);
  const startsAt='2099-10-26T06:30:00.000Z',endsAt='2099-10-26T08:00:00.000Z';
  const pricing=require('../src/services/morningWelcomeOffer');const offer=pricing.createMorningWelcomeOfferService({db:f.db});
  const quoted=await offer.quoteItems([{clientId:55,serviceId:81,staffId:11,price:'590.00',name:'Synthetic Swedish',category:'Massage',startsAt}]);
  const replacements=[
    ['../src/db/pool',{pool:f.db}],
    ['../src/services/bookingIntent',{getIntent:async()=> (await f.db.query('SELECT * FROM booking_intents')).rows[0],verifyService:async()=>({verified:true,canonicalName:'Synthetic Swedish'})}],
    ['../src/services/adminAvailability',{checkAvailability:async()=>({status:'available',staff:{id:11},service:{id:81},startsAt,endsAt}),checkAuthoritativeSchedule:async()=>({covered:true}),getConflicts:async()=>[]}],
    ['../src/services/clinicHours',{getDefaultActiveLocation:async()=>({id:1}),checkClinicHours:async()=>({covered:true})}],
    ['../src/services/assistantBookingHours',{checkAssistantBookingHours:async()=>({covered:true})}],
    ['../src/services/customerBookingConfirmation',{queueCustomerBookingConfirmation:async()=>({queued:true}),sendCustomerBookingConfirmationForAppointment:async()=>({sent:false,deliveryStatus:'synthetic_only'})}],
  ];
  const originals=replacements.map(([path,overrides])=>{const resolved=require.resolve(path),original=require(resolved);require.cache[resolved].exports={...original,...overrides};return[resolved,original];});
  const clientPath=require.resolve('../src/services/clientBookingCommit'),workspacePath=require.resolve('../src/services/calendarDirectBookingConfirmation');
  const cachedClient=require.cache[clientPath],cachedWorkspace=require.cache[workspacePath];let clientCommit,workspaceCommit;
  try{delete require.cache[clientPath];delete require.cache[workspacePath];clientCommit=require(clientPath).commitAcceptedClientBooking;workspaceCommit=require(workspacePath).confirmCalendarV2BookingDirect;}
  finally{for(const [path,original]of originals)require.cache[path].exports=original;delete require.cache[clientPath];delete require.cache[workspacePath];if(cachedClient)require.cache[clientPath]=cachedClient;if(cachedWorkspace)require.cache[workspacePath]=cachedWorkspace;}
  await assert.rejects(clientCommit('27821234567',{crmV2ClientId:55,enableMorningOffer:true,pricingReviewHash:'0'.repeat(64)}),{code:'BOOKING_OFFER_QUOTE_CHANGED'});
  assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM appointments')).rows[0].n),0);
  const created=await clientCommit('27821234567',{crmV2ClientId:55,enableMorningOffer:true,pricingReviewHash:pricing.pricingHash(quoted)});assert.equal(created.status,'created');
  assert.equal(Number((await f.db.query('SELECT total_price FROM appointments')).rows[0].total_price),472);
  assert.equal(Number((await f.db.query('SELECT price_snapshot FROM appointment_services')).rows[0].price_snapshot),472);
  await f.db.query(`INSERT INTO admin_booking_sessions(admin_id,crm_v2_client_id,client_mobile_snapshot,staff_id,service_id,location_id,starts_at,ends_at,state,morning_offer_quote)
    VALUES(7,55,'27821234567',11,81,1,$1,$2,'confirm',$3::jsonb)`,[startsAt,endsAt,JSON.stringify({quote:quoted,hash:pricing.pricingHash(quoted),useOffer:true})]);
  const workspace=await workspaceCommit({id:7,display_name:'Synthetic Owner'},{morningOfferReviewHash:pricing.pricingHash(quoted)});assert.equal(workspace.status,'created');
  assert.equal(Number((await f.db.query('SELECT SUM(total_price) AS n FROM appointments')).rows[0].n),944);
  assert.equal(Number((await f.db.query('SELECT SUM(discount_amount) AS n FROM morning_offer_booking_prices')).rows[0].n),236);
});

test('Workspace multi-treatment visit carries each qualifying saving into child and combined amounts',async t=>{
  const f=await createFixture({morningOffer:true});t.after(f.close);
  await f.sql.exec(require('node:fs').readFileSync('migrations/145_multi_service_client_bookings.sql','utf8'));
  await f.db.query("INSERT INTO crm_v2_clients(id,name,normalized_mobile,source) VALUES(55,'Synthetic Client','27821234567','test')");
  const replacements=[['adminAvailability',{checkAuthoritativeSchedule:async()=>({covered:true}),getConflicts:async()=>[]}],['clinicHours',{getDefaultActiveLocation:async()=>({id:1}),checkClinicHours:async()=>({covered:true})}]];
  const originals=replacements.map(([name,values])=>{const path=require.resolve('../src/services/'+name),original=require(path);require.cache[path].exports={...original,...values};return[path,original];});
  const path=require.resolve('../src/services/calendarMultiServiceBooking'),cached=require.cache[path];let service;
  try{delete require.cache[path];service=require(path).createCalendarMultiServiceBookingService({db:f.db,standardBooking:f.standardBooking,
    morningOffer:require('../src/services/morningWelcomeOffer').createMorningWelcomeOfferService({db:f.db}),
    crmV2Service:{getClientById:async()=>({id:55,name:'Synthetic Client',normalizedMobile:'27821234567',status:'active'})},
    queueConfirmation:async()=>({queued:true}),sendConfirmation:async()=>({sent:false,deliveryStatus:'synthetic_only'})});}
  finally{for(const[path,original]of originals)require.cache[path].exports=original;delete require.cache[path];if(cached)require.cache[path]=cached;}
  const review=await service.prepare({adminId:7,clientId:55,date:'2099-10-26',treatments:[{serviceId:81,staffId:11,startTime:'08:30'},{serviceId:81,staffId:11,startTime:'10:00'}]});
  assert.equal(review.review.offerPricing.discount,'236.00');assert.equal(review.review.subtotal,944);
  await assert.rejects(service.confirm({adminId:7,quoteHash:'0'.repeat(64)}),{code:'BOOKING_OFFER_QUOTE_CHANGED'});
  const result=await service.confirm({adminId:7,quoteHash:review.review.quoteHash});assert.equal(result.status,'created');
  assert.deepEqual((await f.db.query('SELECT total_price FROM appointments ORDER BY id')).rows.map(a=>Number(a.total_price)),[472,472]);
  assert.equal(Number((await f.db.query('SELECT total_price FROM appointment_groups')).rows[0].total_price),944);
  assert.equal(Number((await f.db.query('SELECT SUM(discount_amount) AS n FROM morning_offer_booking_prices')).rows[0].n),236);
});
