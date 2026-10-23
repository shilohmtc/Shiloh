'use strict';
const { createHash } = require('node:crypto');
const { pool } = require('../db/pool');
const { MORNING_OFFER, MORNING_TERMS, visibleDocument, offerTimeEligible, promotionPrice, WebsiteContentError } = require('../domain/websiteContent');

function clinicDate(value) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function eligibleService(item) {
  return !item.prepaidPackage && Number(item.price)>0 && !item.variablePrice
    && (/massage/i.test(String(item.category || '')) || /\b(?:massage|pedicure)\b/i.test(String(item.name || '')));
}
function pricingHash(quote) {
  return createHash('sha256').update(JSON.stringify(quote)).digest('hex');
}
class MorningOfferError extends WebsiteContentError {
  constructor(message='The price or offer changed. Review the updated total before confirming.') { super('BOOKING_OFFER_QUOTE_CHANGED',message,409); }
}
function createMorningWelcomeOfferService({db=pool,now=()=>new Date()}={}) {
  async function activePolicy(queryable=db) {
    const row=(await queryable.query(`/* morningOffer:policy */ SELECT id,slug,kind,rule_code,published
      FROM website_content_posts WHERE rule_code=$1`,[MORNING_OFFER.code])).rows[0];
    return visibleDocument(row,now());
  }
  async function clientBinding(queryable, item) {
    if(item.clientId) {
      const client=(await queryable.query('/* morningOffer:client */ SELECT id,normalized_mobile FROM crm_v2_clients WHERE id=$1',[item.clientId])).rows[0];
      if(!client)throw new MorningOfferError('Your client profile changed. Sign in again before booking.');
      return {clientId:Number(client.id),mobile:client.normalized_mobile};
    }
    if(!/^27[678][0-9]{8}$/.test(String(item.guestMobile || '')))throw new MorningOfferError('Review the guest details again.');
    const client=(await queryable.query('/* morningOffer:guest */ SELECT id,normalized_mobile FROM crm_v2_clients WHERE normalized_mobile=$1 AND status=\'active\' ORDER BY id LIMIT 2',[item.guestMobile])).rows;
    if(client.length>1)throw new MorningOfferError('Review the guest details before booking.');
    return {clientId:client[0] ? Number(client[0].id) : null,mobile:item.guestMobile};
  }
  async function visitHistory(queryable, binding) {
    // Discount eligibility only. This never grants access to, merges, or returns
    // another profile's records. Retained contact history prevents a new account
    // or an archived/recreated profile from resetting a first-visit entitlement.
    const row=(await queryable.query(`/* morningOffer:history */
      WITH same_contact AS (SELECT id FROM crm_v2_clients WHERE normalized_mobile=$2 OR id=$1),
      visits AS (
        SELECT a.* FROM appointments a WHERE a.crm_v2_client_id IN (SELECT id FROM same_contact)
          OR a.client_id IN (SELECT cc.client_id FROM client_contacts cc
            WHERE LOWER(cc.contact_type) IN ('mobile','whatsapp','phone','telephone') AND cc.normalized_value IN ($2,'0'||substring($2 FROM 3),'+'||$2))
      )
      SELECT MIN((v.starts_at AT TIME ZONE 'Africa/Johannesburg')::date)::text AS first_date,
        (SELECT MIN((a.starts_at AT TIME ZONE 'Africa/Johannesburg')::date)::text
          FROM morning_offer_booking_prices p JOIN appointments a ON a.id=p.appointment_id
          WHERE p.crm_v2_client_id IN (SELECT id FROM same_contact)
            AND a.status IN ('scheduled','confirmed','completed','unknown')) AS offer_date
      FROM visits v WHERE v.status IN ('scheduled','confirmed','completed','unknown')`,[binding.clientId,binding.mobile])).rows[0] || {};
    return {firstDate:row.first_date || null,offerDate:row.offer_date || null};
  }
  async function quoteItems(items,{queryable=db,lock=false,useOffer=true,otherPromotion=false}={}) {
    if(typeof useOffer!=='boolean' || typeof otherPromotion!=='boolean')throw new MorningOfferError('Review the promotional offer choice again.');
    const policy=await activePolicy(queryable);
    if(!policy) {
      const priced=items.map(item=>({...promotionPrice(item.price,false),availableDiscount:'0.00',serviceId:Number(item.serviceId),staffId:Number(item.staffId),startsAt:new Date(item.startsAt).toISOString(),identityKey:item.identityKey || `client:${item.clientId}`,visitDate:clinicDate(item.startsAt)}));
      return {items:priced,total:(priced.reduce((sum,p)=>sum+Math.round(Number(p.total)*100),0)/100).toFixed(2),discount:'0.00',terms:[...MORNING_TERMS]};
    }
    const bindings=[];
    for(const item of items)bindings.push(await clientBinding(queryable,item));
    if(lock)await queryable.query('SELECT id FROM crm_v2_clients WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[[...new Set(bindings.map(b=>b.clientId).filter(Boolean))].sort((a,b)=>a-b)]);
    const histories=new Map();
    const priced=[];
    for(const [index,item] of items.entries()) {
      const binding=bindings[index];
      if(!histories.has(binding.mobile))histories.set(binding.mobile,await visitHistory(queryable,binding));
      const history=histories.get(binding.mobile), date=clinicDate(item.startsAt);
      const candidateDates=items.filter((_,i)=>bindings[i].mobile===binding.mobile).map(i=>clinicDate(i.startsAt));
      const firstDate=[history.firstDate,...candidateDates].filter(Boolean).sort()[0];
      const activeAtVisit=policy && (!policy.startsAt || Date.parse(item.startsAt)>=Date.parse(policy.startsAt)) && (!policy.endsAt || Date.parse(item.startsAt)<Date.parse(policy.endsAt));
      const eligible=Boolean(!otherPromotion && activeAtVisit && new Date(item.startsAt)>now() && eligibleService(item) && offerTimeEligible(item.startsAt)
        && date===firstDate && (!history.offerDate || history.offerDate===date));
      const price=promotionPrice(item.price,eligible && useOffer);
      priced.push({...price,availableDiscount:promotionPrice(item.price,eligible).discount,serviceId:Number(item.serviceId),staffId:Number(item.staffId),startsAt:new Date(item.startsAt).toISOString(),
        identityKey:item.identityKey || `client:${binding.clientId}`,visitDate:date});
    }
    return {items:priced,total:(priced.reduce((sum,p)=>sum+Math.round(Number(p.total)*100),0)/100).toFixed(2),
      discount:(priced.reduce((sum,p)=>sum+Math.round(Number(p.discount)*100),0)/100).toFixed(2),terms:[...MORNING_TERMS]};
  }
  function assertReviewed(quote, hash, {required=false}={}) {
    if((hash || required || Number(quote.discount)>0) && hash!==pricingHash(quote))throw new MorningOfferError();
  }
  async function record(queryable,{appointmentId,clientId,price}) {
    if(!price.offerCode || Number(price.discount)<=0)return;
    await queryable.query(`INSERT INTO morning_offer_booking_prices(appointment_id,crm_v2_client_id,offer_code,canonical_subtotal,discount_amount,final_total,terms_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[appointmentId,clientId,MORNING_OFFER.code,price.subtotal,price.discount,price.total,JSON.stringify({version:MORNING_OFFER.code,terms:MORNING_TERMS,visitDate:price.visitDate})]);
  }
  // Calendar reviews persist the server quote in their existing pending session.
  // Guest mobile remains the quote identity before and after a new CRM row is made.
  async function calendarQuote(assignments, people, {queryable=db,lock=false,useOffer=true,otherPromotion=false}={}) {
    const items=assignments.map((a,i)=>({
      clientId:people[i].clientId || people[i].id || null,
      guestMobile:people[i].mobile || people[i].normalized_mobile,
      identityKey:people[i].mobile ? `guest:${people[i].mobile}` : `client:${people[i].clientId || people[i].id}`,
      serviceId:a.service?.id || a.service_id || a.row?.service_id,
      staffId:a.practitioner?.id || a.staff_id || a.row?.staff_id,
      startsAt:a.startsAt,
      name:a.service?.name || a.service_name || a.row?.service_name,
      category:a.service?.categoryName || a.category_name || a.row?.category_name,
      price:a.service?.price ?? a.price ?? a.row?.price,
      variablePrice:a.service?.variablePrice || a.variable_price || a.row?.variable_price,
      prepaidPackage:a.prepaidPackage === true,
    }));
    return quoteItems(items,{queryable,lock,useOffer,otherPromotion});
  }
  return {activePolicy,quoteItems,assertReviewed,record,calendarQuote};
}
function applyCalendarOffer(pricing, quote) {
  if(!quote || Number(quote.discount)<=0)return pricing;
  return {...pricing,subtotal:Number(quote.total),total:Number(quote.total),allocations:quote.items.map(p=>Number(p.total)),offerPricing:quote};
}
async function confirmReviewedCalendarOffer(queryable, session, expectedHash) {
  const offer=createMorningWelcomeOfferService();
  const reviewed=session.morning_offer_quote;
  if (reviewed && expectedHash!==reviewed.hash) throw new MorningOfferError('This booking review changed. Review its current total before creating the appointment.');
  const quote=await offer.quoteItems([{
    clientId:session.crm_v2_client_id,serviceId:session.service_id,staffId:session.staff_id,
    startsAt:session.starts_at,name:session.service_name,category:session.category_name,
    price:session.price,variablePrice:session.variable_price,
  }],{queryable,lock:true,useOffer:reviewed ? reviewed.useOffer : true});
  offer.assertReviewed(quote,reviewed?.hash,{required:Boolean(reviewed)});
  return {quote,offer};
}
module.exports={createMorningWelcomeOfferService,eligibleService,clinicDate,pricingHash,MorningOfferError,applyCalendarOffer,confirmReviewedCalendarOffer};
