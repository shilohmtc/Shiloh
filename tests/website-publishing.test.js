'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createWebsiteContentService, imageMime } = require('../src/services/websiteContent');
const { createMorningWelcomeOfferService, pricingHash } = require('../src/services/morningWelcomeOffer');
const { normalizeDocument, offerTimeEligible, promotionPrice } = require('../src/domain/websiteContent');
const { renderEditorialArticle } = require('../src/services/publicWebsite');

const EPISODE='b06a730c-30ec-4245-9f98-2dc8eebbb2d0', OFFER='c674d720-8358-4d16-aeb0-c85a7c0f5a16';
const owner={calendarAuthority:{businessRole:'owner',calendarScope:'all_business',serviceScope:'all_services'}};
const startsAt='2026-11-02T06:00:00.000Z';
const item={clientId:1,serviceId:1,staffId:1,startsAt,price:'600.00',name:'Therapeutic Massage',category:'Massage'};
async function fixture(t) {
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY);
    INSERT INTO staff_admin_accounts VALUES(1);
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY,normalized_mobile text,status text);
    INSERT INTO crm_v2_clients VALUES(1,'27821234567','active'),(2,'27821234568','active');
    CREATE TABLE appointments(id bigint PRIMARY KEY,crm_v2_client_id bigint REFERENCES crm_v2_clients(id) ON DELETE SET NULL,client_id bigint,starts_at timestamptz,status text,total_price numeric(12,2));
    CREATE TABLE client_contacts(client_id bigint,contact_type text,normalized_value text);
    CREATE TABLE admin_booking_sessions(admin_id bigint);
    CREATE TABLE booking_payment_accounts(id bigint PRIMARY KEY,appointment_id bigint);
    CREATE TABLE booking_welcome_voucher_allocations(id bigserial PRIMARY KEY,booking_payment_account_id bigint,state text DEFAULT 'applied');
  `);
  await pg.exec(fs.readFileSync('migrations/199_website_publishing_morning_offer.sql','utf8'));
  const db={async query(sql,params){const r=await pg.query(sql,params);return {...r,rowCount:r.rows.length || r.affectedRows || 0};},async connect(){return{query:db.query,release(){}};}};
  const clock={value:new Date('2026-10-22T10:00:00Z')};
  const auth={value:owner};
  const content=createWebsiteContentService({db,now:()=>clock.value,authorize:async()=>auth.value});
  const pricing=createMorningWelcomeOfferService({db,now:()=>clock.value});
  async function publish(id=OFFER,changes={}) {
    const row=(await content.model({adminId:1})).posts.find(p=>p.id===id);
    return content.edit({adminId:1,postId:id,revision:row.revision,action:'publish',document:{...row.draft,...changes}});
  }
  return{pg,db,content,pricing,clock,auth,publish};
}
test('morning boundary is South African appointment start, excluding Saturday; finishing later is allowed',()=>{
  for(const [time,expected] of [['2026-11-02T05:59:00Z',false],['2026-11-02T06:00:00Z',true],['2026-11-02T09:59:00Z',true],['2026-11-02T10:00:00Z',false],['2026-10-24T07:00:00Z',false]])assert.equal(offerTimeEligible(time),expected,time);
  assert.equal(offerTimeEligible('invalid'),false);
  assert.deepEqual(promotionPrice('99.99',true),{subtotal:'99.99',discount:'20.00',total:'79.99',offerCode:'morning_welcome_v1'});
  assert.throws(()=>promotionPrice(null,true));
});
test('documents reject unknown fields, invalid schedules and missing image descriptions',()=>{
  const doc={title:'A story',summary:'A short introduction',body:'Readable text',episode:1};
  assert.equal(normalizeDocument(doc,'episode').endsAt,null);
  assert.throws(()=>normalizeDocument({...doc,html:'<script>'},'episode'));
  assert.throws(()=>normalizeDocument({...doc,episode:0},'episode'));
  assert.throws(()=>normalizeDocument({...doc,startsAt:'2026-11-01T08:00:00+02:00',endsAt:'2026-10-01T08:00:00+02:00'},'episode'));
  assert.throws(()=>normalizeDocument({...doc,imageId:'7288766e-3296-4d85-9761-56a64acb889d'},'episode'));
});
test('draft saves preserve the published article; version conflicts fail without replacing either version',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.content.publicPosts(),[]);
  const published=await f.publish(EPISODE);
  const changed=await f.content.edit({adminId:1,postId:EPISODE,revision:published.revision,document:{...published.draft,title:'A draft title'}});
  assert.notEqual((await f.content.publicPost('episode',published.slug)).title,'A draft title');
  await assert.rejects(f.content.edit({adminId:1,postId:EPISODE,revision:published.revision,document:published.draft}),{code:'WEBSITE_REVISION_CHANGED'});
  assert.equal((await f.content.model({adminId:1})).posts.find(p=>p.id===EPISODE).draft.title,changed.draft.title);
  assert.equal((await f.content.history({adminId:1,postId:EPISODE})).length,3);
});
test('restore creates an unpublished draft, retaining the current published version',async t=>{
  const f=await fixture(t);const post=await f.publish(EPISODE,{title:'Published newer title'});
  const restored=await f.content.edit({adminId:1,postId:EPISODE,revision:post.revision,action:'restore',restoreRevision:1});
  assert.equal(restored.published.title,'Published newer title');assert.match(restored.draft.title,/No two bodies/);
});
test('scheduled publication and exact expiry agree between public pages and booking eligibility',async t=>{
  const f=await fixture(t);
  await f.publish(OFFER,{startsAt:'2026-11-01T06:00:00+02:00',endsAt:'2026-11-03T12:00:00+02:00'});
  assert.equal((await f.content.publicPosts()).length,0);
  assert.equal((await f.pricing.quoteItems([item])).discount,'0.00');
  f.clock.value=new Date('2026-11-01T06:00:00+02:00');
  assert.equal((await f.content.publicPosts()).length,1);assert.equal((await f.pricing.quoteItems([item])).discount,'120.00');
  f.clock.value=new Date('2026-11-03T12:00:00+02:00');assert.equal((await f.content.publicPosts()).length,0);assert.equal((await f.pricing.quoteItems([item])).discount,'0.00');
});
test('unpublishing prevents new claims while retaining agreed appointment prices',async t=>{
  const f=await fixture(t);const post=await f.publish();const quote=await f.pricing.quoteItems([item]);
  await f.db.query("INSERT INTO appointments VALUES(10,1,NULL,$1,'scheduled',480)",[startsAt]);
  await f.pricing.record(f.db,{appointmentId:10,clientId:1,price:quote.items[0]});
  await f.content.edit({adminId:1,postId:OFFER,revision:post.revision,action:'unpublish'});
  assert.equal((await f.pricing.quoteItems([item])).discount,'0.00');
  assert.equal((await f.db.query('SELECT total_price FROM appointments WHERE id=10')).rows[0].total_price,'480.00');
  assert.equal((await f.db.query('SELECT count(*) FROM morning_offer_booking_prices')).rows[0].count,1);
});
test('all eligible first-visit treatments receive 20%, while later dates and other promotions do not',async t=>{
  const f=await fixture(t);await f.publish();
  const pedi={...item,serviceId:2,name:'Pedicure',category:'Pedicures & Foot Care',price:'400.00',startsAt:'2026-11-02T08:00:00Z'};
  const quote=await f.pricing.quoteItems([item,pedi]);assert.equal(quote.total,'800.00');assert.equal(quote.discount,'200.00');
  assert.equal((await f.pricing.quoteItems([item,pedi],{otherPromotion:true})).discount,'0.00');
  assert.equal((await f.pricing.quoteItems([item,{...pedi,startsAt:'2026-11-03T08:00:00Z'}])).discount,'120.00');
  assert.equal((await f.pricing.quoteItems([{...item,name:'Facial',category:'Skin'}])).discount,'0.00');
  assert.equal((await f.pricing.quoteItems([{...item,prepaidPackage:true}])).discount,'0.00');
});
test('real visit history, including retained contact history, prevents an account reset claim',async t=>{
  const f=await fixture(t);await f.publish();
  await f.db.query("INSERT INTO appointments VALUES(20,1,NULL,'2026-10-01T06:00:00Z','completed',600)");
  assert.equal((await f.pricing.quoteItems([item])).discount,'0.00');
  await f.db.query('DELETE FROM appointments');
  await f.db.query("INSERT INTO client_contacts VALUES(77,'Phone','+27821234567')");
  await f.db.query("INSERT INTO appointments VALUES(21,NULL,77,'2026-10-01T06:00:00Z','completed',600)");
  assert.equal((await f.pricing.quoteItems([item])).discount,'0.00');
});
test('changed eligibility invalidates the reviewed price before appointment writes',async t=>{
  const f=await fixture(t);await f.publish();const reviewed=await f.pricing.quoteItems([item]);
  f.pricing.assertReviewed(reviewed,pricingHash(reviewed));
  await f.db.query("INSERT INTO appointments VALUES(20,1,NULL,'2026-10-01T06:00:00Z','completed',600)");
  const changed=await f.pricing.quoteItems([item]);assert.throws(()=>f.pricing.assertReviewed(changed,pricingHash(reviewed)),{code:'BOOKING_OFFER_QUOTE_CHANGED'});
  assert.throws(()=>f.pricing.assertReviewed(reviewed,null),{code:'BOOKING_OFFER_QUOTE_CHANGED'});
});
test('database backstop rejects invalid claims/moves while preserving later authorised financial adjustments',async t=>{
  const f=await fixture(t);await f.publish();const quote=await f.pricing.quoteItems([item]);
  await f.db.query("INSERT INTO appointments VALUES(10,1,NULL,$1,'scheduled',480)",[startsAt]);
  await f.pricing.record(f.db,{appointmentId:10,clientId:1,price:quote.items[0]});
  await assert.rejects(f.db.query("UPDATE appointments SET starts_at='2026-11-02T11:00:00Z' WHERE id=10"),/08:00/);
  await f.db.query("INSERT INTO appointments VALUES(11,2,NULL,$1,'scheduled',400)",[startsAt]);
  await assert.rejects(f.pricing.record(f.db,{appointmentId:11,clientId:2,price:quote.items[0]}),/reviewed booking total/);
  await f.db.query('UPDATE appointments SET total_price=400 WHERE id=10');
  assert.equal((await f.db.query('SELECT final_total FROM morning_offer_booking_prices WHERE appointment_id=10')).rows[0].final_total,'480.00');
  assert.equal((await f.db.query('SELECT total_price FROM appointments WHERE id=10')).rows[0].total_price,'400.00');
});
test('only clinic administrators publish, and draft images do not become public until publication',async t=>{
  const f=await fixture(t);const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  const image=await f.content.uploadImage({adminId:1,bytes});assert.equal(await f.content.media({id:image.id}),null);
  await f.publish(EPISODE,{imageId:image.id,imageAlt:'A treatment illustration'});
  assert.equal((await f.content.media({id:image.id})).mime_type,'image/png');
  f.auth.value={calendarAuthority:{businessRole:'practitioner',calendarScope:'own',serviceScope:'own_services'}};
  await assert.rejects(f.content.model({adminId:1}),{code:'WEBSITE_ACCESS_DENIED'});
  await assert.rejects(f.content.media({id:image.id,adminId:1}),{code:'WEBSITE_ACCESS_DENIED'});
  assert.throws(()=>imageMime(Buffer.from('<svg onload="alert(1)"></svg>')),{code:'WEBSITE_IMAGE_TYPE'});
});
test('a promotional welcome voucher cannot stack with the morning saving; other bookings and gift payments remain available',async t=>{
  const f=await fixture(t);await f.publish();const quote=await f.pricing.quoteItems([item]);
  await f.db.query("INSERT INTO appointments VALUES(10,1,NULL,$1,'scheduled',480)",[startsAt]);
  await f.pricing.record(f.db,{appointmentId:10,clientId:1,price:quote.items[0]});
  await f.db.query('INSERT INTO booking_payment_accounts VALUES(1,10)');
  await assert.rejects(f.db.query('INSERT INTO booking_welcome_voucher_allocations(booking_payment_account_id) VALUES(1)'),{code:'P0M02'});
  assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM booking_welcome_voucher_allocations')).rows[0].n),0);
  await f.db.query("INSERT INTO appointments VALUES(11,2,NULL,$1,'scheduled',600)",[startsAt]);
  await f.db.query('INSERT INTO booking_payment_accounts VALUES(2,11)');
  await f.db.query('INSERT INTO booking_welcome_voucher_allocations(booking_payment_account_id) VALUES(2)');
  await f.pg.exec('CREATE TABLE booking_gift_voucher_allocations(booking_payment_account_id bigint,amount numeric(12,2))');
  await f.db.query('INSERT INTO booking_gift_voucher_allocations VALUES(1,480)');
  assert.equal((await f.db.query('SELECT amount FROM booking_gift_voucher_allocations')).rows[0].amount,'480.00');
  assert.equal((await f.db.query('SELECT total_price FROM appointments WHERE id=10')).rows[0].total_price,'480.00');
});
test('website output keeps readable terms and escapes editable article content',()=>{
  const html=renderEditorialArticle({kind:'offer',slug:'test',title:'<script>alert(1)</script>',summary:'Clear terms',body:'<img src=x onerror=alert(1)>',imageId:null});
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('before 12:00'));assert.ok(html.includes('Saturdays'));assert.ok(html.includes('gift vouchers'));
});
