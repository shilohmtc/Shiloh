const crypto = require('crypto');
const { pool } = require('../db/pool');
const {
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  sendWhatsAppCtaUrl,
  sendWhatsAppReplyButtons,
} = require('./whatsapp');
const { postConfirmationButtons, bookingConfirmationV2QuickReplyPayloads } = require('./clientBookingInteractive');
const { createAppointment: enrollAppointmentLifecycle } = require('./appointmentLifecycle');
const { resolveClientFacingName } = require('./clientFacingNameAuthority');
const { exactPhoneCandidates } = require('./clientVerifiedIdentity');
const { assertTarget: assertControlledMessagingTestTarget } = require('./controlledMessagingTestLane');
const { verifyMigrationFiles } = require('./migrations');
const { createBookingPaymentService } = require('./bookingPayments');
const logger = require('../lib/logger');
const { queueBookingConfirmationMyShilohNotification } = require('./sh05ChannelIndependence');

const LIVE_BOOKING_CONFIRMATION_V1 = 'shiloh_booking_confirmation_v1';
const LIVE_BOOKING_CONFIRMATION_V2 = 'shiloh_booking_confirmation_v2';
const CURRENT_BOOKING_CONFIRMATION_TEMPLATES = new Set([LIVE_BOOKING_CONFIRMATION_V1, LIVE_BOOKING_CONFIRMATION_V2]);
const BOOKING_CONFIRMATION_RETRY_MS = 5 * 60 * 1000;
const BOOKING_CONFIRMATION_RECOVERY_STALE_MS = 10 * 60 * 1000;
const MAX_AUTOMATIC_ASYNC_PROVIDER_ATTEMPTS = 3;
let deliveryTableReady = false;
let deliveryScheduler = null;

function fmtDate(v){return new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(v));}
function fmtTime(v){return new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}
function googleStamp(v){return new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
function baseUrl(){return String(process.env.SHILOH_PUBLIC_BASE_URL||process.env.RENDER_EXTERNAL_URL||'').replace(/\/$/,'');}
function shouldSendLegacyConfirmationSupplements(template){return !CURRENT_BOOKING_CONFIRMATION_TEMPLATES.has(String(template||'').trim());}
function bookingConfirmationTemplatePayload({template,appointmentId,clientName,serviceName,staffName,date,time,google,ics}){
  if(String(template||'').trim()===LIVE_BOOKING_CONFIRMATION_V2){
    return {
      bodyParameters:[clientName||'there',serviceName,staffName,date,time],
      quickReplyPayloads:bookingConfirmationV2QuickReplyPayloads(appointmentId),
    };
  }
  return {
    bodyParameters:[clientName||'there',serviceName,staffName,date,time,google,ics||google],
    quickReplyPayloads:[],
  };
}
function providerMessageId(response){return response?.messages?.[0]?.id||null;}

async function ensureDeliveryTable(){
  if(deliveryTableReady)return {initialized:true,verifiedOnly:true};
  await verifyMigrationFiles([
    '071_booking_confirmation_template_evidence.sql',
    '083_initial_booking_confirmation_guarantee.sql',
    '085_calendar_clean_crm_v2_cutover.sql',
  ]);
  const verification=await pool.query(`
    SELECT
      to_regclass('public.customer_message_deliveries') IS NOT NULL AS delivery_table,
      (SELECT COUNT(*)::int FROM information_schema.columns
        WHERE table_schema='public' AND table_name='customer_message_deliveries'
          AND column_name IN ('template_name','provider_message_id','client_id','crm_v2_client_id',
            'recipient_mobile','client_name_snapshot','contact_id','name_authority_id','attempt_count',
            'last_attempt_at','next_attempt_at','last_error')) = 12 AS required_columns,
      (SELECT COUNT(*)::int FROM pg_constraint
        WHERE conrelid='customer_message_deliveries'::regclass
          AND conname IN ('customer_message_deliveries_status_check',
            'customer_message_deliveries_attempt_count_check',
            'customer_message_deliveries_one_client_model_check',
            'customer_message_deliveries_v2_recipient_check')
          AND convalidated) = 4 AS required_constraints,
      EXISTS (SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='idx_customer_message_deliveries_retry') AS retry_index,
      EXISTS (SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='idx_customer_message_deliveries_crm_v2_client_id') AS crm_v2_index
  `);
  const state=verification.rows[0]||{};
  if(!state.delivery_table||!state.required_columns||!state.required_constraints||!state.retry_index||!state.crm_v2_index){
    throw new Error('Booking confirmation delivery schema verification failed; run controlled migration tooling before startup');
  }
  deliveryTableReady=true;
  return {initialized:true,verifiedOnly:true};
}

async function loadBookingConfirmationAuthority(appointmentId,db=pool){
  const result=await db.query(`
    SELECT a.id AS appointment_id,a.client_id,a.crm_v2_client_id,
           CASE
             WHEN a.crm_v2_client_id IS NOT NULL AND a.client_id IS NULL THEN 'crm_v2'
             WHEN a.client_id IS NOT NULL AND a.crm_v2_client_id IS NULL THEN 'legacy'
             ELSE 'invalid'
           END AS identity_model,
           COALESCE(c.status,v2.status) AS client_status,
           contact.id AS contact_id,
           COALESCE(v2.normalized_mobile,contact.normalized_value) AS client_phone,
           delivery.recipient_mobile AS delivery_recipient_mobile,
           COALESCE(delivery.client_name_snapshot,a.source_client_name,v2.name) AS client_name_snapshot,
           contact.contact_verified,contact.identity_verification_id,
           contact.verification_client_id,contact.verification_contact_id,
           name_authority.id AS name_authority_id
      FROM appointments a
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id
      LEFT JOIN customer_message_deliveries delivery
        ON delivery.appointment_id=a.id AND delivery.message_kind='booking_confirmation'
      LEFT JOIN LATERAL (
        SELECT cc.id,cc.normalized_value,
               (cc.verified_at IS NOT NULL) AS contact_verified,
               verification.id AS identity_verification_id,
               verification.client_id AS verification_client_id,
               verification.client_contact_id AS verification_contact_id
          FROM client_contacts cc
          LEFT JOIN LATERAL (
            SELECT v.id,v.client_id,v.client_contact_id
              FROM client_identity_verifications v
             WHERE v.client_id=c.id
               AND v.client_contact_id=cc.id
               AND v.status='active'
             ORDER BY v.verified_at DESC,v.id DESC
             LIMIT 1
          ) verification ON TRUE
         WHERE c.id IS NOT NULL
           AND cc.client_id=c.id
           AND LOWER(cc.contact_type) IN ('whatsapp','mobile')
           AND cc.normalized_value ~ '^[0-9]{10,15}$'
         ORDER BY CASE WHEN cc.verified_at IS NOT NULL AND verification.id IS NOT NULL THEN 0 ELSE 1 END,
                  cc.is_primary DESC,cc.verified_at DESC NULLS LAST,
                  CASE LOWER(cc.contact_type) WHEN 'whatsapp' THEN 0 ELSE 1 END,
                  cc.id
         LIMIT 1
      ) contact ON TRUE
      LEFT JOIN LATERAL (
        SELECT authority.id
          FROM client_facing_name_authorities authority
         WHERE c.id IS NOT NULL
           AND authority.client_id=c.id AND authority.revoked_at IS NULL
         ORDER BY authority.promoted_at DESC,authority.id DESC
         LIMIT 1
      ) name_authority ON TRUE
     WHERE a.id=$1`,[appointmentId]);
  return result.rows[0]||null;
}

function initialDeliveryFailure(authority){
  if(!authority)return 'appointment_not_found';
  const identityModel=authority.identity_model||(authority.crm_v2_client_id?'crm_v2':'legacy');
  if(identityModel==='crm_v2'){
    if(authority.client_id!=null||!authority.crm_v2_client_id)return 'crm_v2_identity_invalid';
    if(authority.client_status!=='active')return 'crm_v2_client_inactive';
    if(!/^27[678][0-9]{8}$/.test(String(authority.client_phone||'')))return 'crm_v2_recipient_missing';
    if(authority.delivery_recipient_mobile
      &&String(authority.delivery_recipient_mobile)!==String(authority.client_phone))return 'crm_v2_recipient_changed';
    if(!String(authority.client_name_snapshot||'').trim())return 'crm_v2_name_missing';
    return null;
  }
  if(identityModel!=='legacy')return 'crm_v2_identity_invalid';
  if(authority.client_status!=='active')return 'canonical_client_inactive';
  if(!authority.contact_id||!authority.client_phone)return 'client_contact_not_found';
  if(authority.contact_verified!==true||!authority.identity_verification_id
    ||String(authority.verification_client_id)!==String(authority.client_id)
    ||String(authority.verification_contact_id)!==String(authority.contact_id))return 'client_contact_unverified';
  if(!authority.name_authority_id)return 'client_name_authority_not_found';
  return null;
}

async function contactOwnershipFailure(authority,db=pool){
  const identityModel=authority?.identity_model||(authority?.crm_v2_client_id?'crm_v2':'legacy');
  if(identityModel==='crm_v2')return null;
  const candidates=await exactPhoneCandidates(authority.client_phone,db);
  const candidate=candidates[0];
  const contactIds=candidate?.contact_ids||[];
  if(candidates.length!==1
    ||String(candidate.id)!==String(authority.client_id)
    ||!contactIds.some((contactId)=>String(contactId)===String(authority.contact_id))){
    return 'client_contact_ambiguous';
  }
  return null;
}

async function queueCustomerBookingConfirmation(appointmentId,{db=pool,recovery=false}={}){
  if(db===pool)await ensureDeliveryTable();
  if(!recovery){
    const legacy=await db.query(`SELECT 1 FROM crm_audit_events WHERE action='customer.booking_confirmation_sent' AND entity_type='appointment' AND entity_id=$1 LIMIT 1`,[appointmentId]);
    if(legacy.rowCount)return {queued:false,status:'sent',reason:'already_sent'};
  }
  const authority=await loadBookingConfirmationAuthority(appointmentId,db);
  if(!authority)return {queued:false,status:'failed',reason:'appointment_not_found'};
  const identityModel=authority.identity_model||(authority.crm_v2_client_id?'crm_v2':'legacy');
  const initialFailure=initialDeliveryFailure(authority);
  const failure=initialFailure||await contactOwnershipFailure(authority,db);
  const inserted=await db.query(`
    INSERT INTO customer_message_deliveries
      (appointment_id,message_kind,status,client_id,contact_id,name_authority_id,next_attempt_at,last_error,
       crm_v2_client_id,recipient_mobile,client_name_snapshot)
    VALUES ($1,'booking_confirmation',$2,$3,$4,$5,NOW(),$6,$7,$8,$9)
    ON CONFLICT (appointment_id,message_kind) DO NOTHING
    RETURNING appointment_id,status
  `,[
    appointmentId,
    failure?'failed':'pending',
    authority.client_id,
    authority.contact_id,
    authority.name_authority_id,
    failure,
    identityModel==='crm_v2'?authority.crm_v2_client_id:null,
    identityModel==='crm_v2'?authority.client_phone:null,
    identityModel==='crm_v2'?String(authority.client_name_snapshot||'').trim():null,
  ]);
  if(!inserted.rowCount){
    const existing=await db.query(`SELECT status,last_error FROM customer_message_deliveries WHERE appointment_id=$1 AND message_kind='booking_confirmation'`,[appointmentId]);
    return {queued:false,status:existing.rows[0]?.status||'unknown',reason:existing.rows[0]?.last_error||'already_queued'};
  }
  const auditMetadata=identityModel==='crm_v2'
    ? {crmV2ClientId:Number(authority.crm_v2_client_id),identityModel:'crm_v2_exact_mobile',initialStatus:failure?'failed':'pending',reason:failure}
    : failure==='client_contact_ambiguous'
      ? {initialStatus:'failed',reason:failure}
      : {clientId:Number(authority.client_id),contactId:authority.contact_id?Number(authority.contact_id):null,identityVerificationId:authority.identity_verification_id?Number(authority.identity_verification_id):null,nameAuthorityId:authority.name_authority_id?Number(authority.name_authority_id):null,initialStatus:failure?'failed':'pending',reason:failure};
  await db.query(`
    INSERT INTO crm_audit_events(action,entity_type,entity_id,metadata)
    VALUES('customer.booking_confirmation_queued','appointment',$1,$2::jsonb)`,[
    String(appointmentId),
    JSON.stringify(auditMetadata),
  ]);
  return identityModel==='crm_v2'
    ? {queued:true,status:failure?'failed':'pending',reason:failure,crmV2ClientId:Number(authority.crm_v2_client_id),identityModel}
    : {queued:true,status:failure?'failed':'pending',reason:failure,clientId:Number(authority.client_id),contactId:authority.contact_id?Number(authority.contact_id):null,identityVerificationId:authority.identity_verification_id?Number(authority.identity_verification_id):null,nameAuthorityId:authority.name_authority_id?Number(authority.name_authority_id):null,identityModel};
}

async function claimBookingConfirmation(appointmentId,{clientId=null,contactId=null,nameAuthorityId=null,db=pool,recovery=false}={}){
  if(db===pool)await ensureDeliveryTable();
  if(!recovery){
    const legacy=await db.query(`SELECT 1 FROM crm_audit_events WHERE action='customer.booking_confirmation_sent' AND entity_type='appointment' AND entity_id=$1 LIMIT 1`,[appointmentId]);
    if(legacy.rowCount){
      await db.query(`UPDATE customer_message_deliveries SET status='sent',sent_at=COALESCE(sent_at,NOW()),updated_at=NOW(),last_error=NULL WHERE appointment_id=$1 AND message_kind='booking_confirmation'`,[appointmentId]);
      return false;
    }
  }
  const claimed=await db.query(`
    UPDATE customer_message_deliveries
       SET status='sending',claimed_at=NOW(),updated_at=NOW(),last_attempt_at=NOW(),
           attempt_count=attempt_count+1,last_error=NULL,
           client_id=COALESCE($2,client_id),contact_id=COALESCE($3,contact_id),name_authority_id=COALESCE($4,name_authority_id)
     WHERE appointment_id=$1 AND message_kind='booking_confirmation'
       AND status IN ('pending','failed') AND next_attempt_at<=NOW()
       AND provider_delivered_at IS NULL AND provider_read_at IS NULL
       AND (provider_sent_at IS NULL OR (provider_failed_at IS NOT NULL AND provider_failed_at>provider_sent_at))
     RETURNING appointment_id
  `,[appointmentId,clientId,contactId,nameAuthorityId]);
  return claimed.rowCount===1;
}

async function releaseBookingConfirmationClaim(appointmentId,reason='send_failed',db=pool){
  await db.query(`
    UPDATE customer_message_deliveries
       SET status='failed',updated_at=NOW(),next_attempt_at=NOW()+INTERVAL '5 minutes',last_error=$2
     WHERE appointment_id=$1 AND message_kind='booking_confirmation' AND status='sending'`,[appointmentId,String(reason||'send_failed').slice(0,1000)]);
}

async function markBookingConfirmationSent(appointmentId,{templateName=null,providerMessageId=null,resetProviderEvidence=false}={},db=pool){
  const marked=await db.query(`UPDATE customer_message_deliveries SET status='sent',sent_at=NOW(),updated_at=NOW(),next_attempt_at=NOW(),last_error=NULL,template_name=$2,provider_message_id=$3,
    provider_sent_at=CASE WHEN $4 THEN NULL ELSE provider_sent_at END,
    provider_delivered_at=CASE WHEN $4 THEN NULL ELSE provider_delivered_at END,
    provider_read_at=CASE WHEN $4 THEN NULL ELSE provider_read_at END,
    provider_failed_at=CASE WHEN $4 THEN NULL ELSE provider_failed_at END,
    provider_error=CASE WHEN $4 THEN NULL ELSE provider_error END
    WHERE appointment_id=$1 AND message_kind='booking_confirmation' AND status='sending'`,[appointmentId,templateName,providerMessageId,resetProviderEvidence]);
  if(marked.rowCount!==1)throw new Error('Booking confirmation accepted but durable sent transition failed');
}

async function markBookingConfirmationFailure(appointmentId,reason,{clientId=null,contactId=null,nameAuthorityId=null,db=pool}={}){
  await db.query(`
    UPDATE customer_message_deliveries
       SET status='failed',updated_at=NOW(),last_attempt_at=NOW(),attempt_count=attempt_count+1,
           next_attempt_at=NOW()+INTERVAL '5 minutes',last_error=$2,
           client_id=COALESCE($3,client_id),contact_id=$4,name_authority_id=$5
     WHERE appointment_id=$1 AND message_kind='booking_confirmation' AND status IN ('pending','failed')`,[
    appointmentId,String(reason||'delivery_unavailable').slice(0,1000),clientId,contactId,nameAuthorityId,
  ]);
}

async function markBookingConfirmationUncertain(appointmentId,db=pool){
  await db.query(`
    UPDATE customer_message_deliveries
       SET status='uncertain',updated_at=NOW(),next_attempt_at=NOW(),last_error='provider_delivery_unknown'
     WHERE appointment_id=$1 AND message_kind='booking_confirmation' AND status='sending'`,[appointmentId]);
}

function providerOutcome(row={}){
  if(row.provider_read_at)return 'read';
  if(row.provider_delivered_at)return 'delivered';
  const sentAt=row.provider_sent_at?new Date(row.provider_sent_at).getTime():0;
  const failedAt=row.provider_failed_at?new Date(row.provider_failed_at).getTime():0;
  if(sentAt||failedAt)return failedAt>sentAt?'failed':'provider_sent';
  const status=String(row.status||'').toLowerCase();
  if(['failed','uncertain','pending','sending','sent'].includes(status))return status;
  return 'not_sent';
}

function recoveryState(row,now=new Date()){
  if(!row)return {recoverable:true,reason:'not_sent'};
  const outcome=providerOutcome(row);
  if(['read','delivered','provider_sent','sent'].includes(outcome))return {recoverable:false,reason:'already_sent'};
  if(outcome==='failed'||outcome==='uncertain')return {recoverable:true,reason:outcome};
  const last=row.last_attempt_at||row.claimed_at||row.updated_at;
  const staleAt=last?new Date(last).getTime():0;
  const stale=Number.isFinite(staleAt)&&staleAt>0&&now.getTime()-staleAt>=BOOKING_CONFIRMATION_RECOVERY_STALE_MS;
  return stale?{recoverable:true,reason:'pending_too_long'}:{recoverable:false,reason:'already_in_progress'};
}

async function prepareBookingConfirmationRecovery(appointmentId,{db=pool,operatorAdminId=null,now=new Date()}={}){
  const result=await db.query(`/* customerBookingConfirmation:recoveryState */
    SELECT a.id AS appointment_id,a.status AS appointment_status,a.starts_at,
           delivery.status,delivery.claimed_at,delivery.updated_at,delivery.last_attempt_at,
           delivery.provider_message_id,delivery.provider_sent_at,delivery.provider_delivered_at,
           delivery.provider_read_at,delivery.provider_failed_at,
           EXISTS(SELECT 1 FROM crm_audit_events audit
                   WHERE audit.action='customer.booking_confirmation_sent'
                     AND audit.entity_type='appointment' AND audit.entity_id=a.id) AS sent_audit
      FROM appointments a
      LEFT JOIN customer_message_deliveries delivery
        ON delivery.appointment_id=a.id AND delivery.message_kind='booking_confirmation'
     WHERE a.id=$1`,[appointmentId]);
  const row=result.rows[0];
  if(!row)return {prepared:false,reason:'appointment_not_found'};
  if(!['scheduled','confirmed'].includes(String(row.appointment_status||''))||new Date(row.starts_at).getTime()<=now.getTime()){
    return {prepared:false,reason:'appointment_not_eligible'};
  }
  const authority=await loadBookingConfirmationAuthority(appointmentId,db);
  const authorityFailure=initialDeliveryFailure(authority)||await contactOwnershipFailure(authority,db);
  if(authorityFailure)return {prepared:false,reason:authorityFailure};
  const hasDelivery=Boolean(row.status);
  if(!hasDelivery&&row.sent_audit===true)return {prepared:false,reason:'already_sent'};
  const state=recoveryState(hasDelivery?row:null,now);
  if(!state.recoverable)return {prepared:false,reason:state.reason};
  if(hasDelivery){
    const prepared=await db.query(`/* customerBookingConfirmation:prepareRecovery */
      UPDATE customer_message_deliveries
         SET status='failed',next_attempt_at=NOW(),updated_at=NOW(),last_error='operator_recovery_requested'
       WHERE appointment_id=$1 AND message_kind='booking_confirmation'
         AND provider_delivered_at IS NULL AND provider_read_at IS NULL
         AND (provider_sent_at IS NULL OR (provider_failed_at IS NOT NULL AND provider_failed_at>provider_sent_at))
         AND (status IN ('failed','uncertain','sent')
           OR (status IN ('pending','sending') AND COALESCE(last_attempt_at,claimed_at,updated_at)<=NOW()-INTERVAL '10 minutes'))
       RETURNING appointment_id`,[appointmentId]);
    if(prepared.rowCount!==1)return {prepared:false,reason:'evidence_changed'};
  }
  await db.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
    VALUES($2,'customer.booking_confirmation_recovery_requested','appointment',$1,$3::jsonb)`,[
    String(appointmentId),operatorAdminId,JSON.stringify({priorState:state.reason,canonicalRecipientRevalidated:true}),
  ]);
  return {prepared:true,reason:state.reason};
}

async function ensureToken(appointmentId,db=pool){
  const existing=await db.query(`SELECT token FROM appointment_calendar_share_tokens WHERE appointment_id=$1`,[appointmentId]);
  if(existing.rows[0]?.token)return existing.rows[0].token;
  const token=crypto.randomBytes(24).toString('base64url');
  const created=await db.query(`INSERT INTO appointment_calendar_share_tokens (appointment_id,token) VALUES ($1,$2) ON CONFLICT (appointment_id) DO UPDATE SET appointment_id=EXCLUDED.appointment_id RETURNING token`,[appointmentId,token]);
  return created.rows[0].token;
}

function googleCalendarUrl({serviceName,staffName,locationName,startsAt,endsAt}){
  const p=new URLSearchParams({action:'TEMPLATE',text:`Shiloh — ${serviceName}`,dates:`${googleStamp(startsAt)}/${googleStamp(endsAt)}`,details:`Appointment with ${staffName} at Shiloh.`,location:locationName||'Shiloh'});
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

async function sendOptionalConfirmationAction(label, sendAction, context){
  try{
    await sendAction();
    return true;
  }catch(error){
    logger.error({err:error,...context,action:label},'Booking confirmation supplemental action failed');
    return false;
  }
}

async function sendCustomerBookingConfirmation(data,{
  db=pool,
  sendMessage=sendWhatsAppMessage,
  sendTemplate=sendWhatsAppTemplate,
  sendCta=sendWhatsAppCtaUrl,
  sendButtons=sendWhatsAppReplyButtons,
  enrollLifecycle=enrollAppointmentLifecycle,
  resolveName=resolveClientFacingName,
  assertE2eTarget=assertControlledMessagingTestTarget,
  env=process.env,
  recovery=false,
  controlledE2e=false,
}={}){
  const {appointmentId,clientId,clientName:_suppliedClientName,serviceName,staffName,locationName,startsAt,endsAt,source='shiloh'}=data;
  let claimed=false;
  let providerAttempted=false;
  let providerAccepted=false;
  let acceptedProviderMessageId=null;
  try{
    await queueCustomerBookingConfirmation(appointmentId,{db,recovery});
    const authority=await loadBookingConfirmationAuthority(appointmentId,db);
    const identityModel=authority?.identity_model||(authority?.crm_v2_client_id?'crm_v2':'legacy');
    const authorityFailure=initialDeliveryFailure(authority);
    if(authorityFailure){
      await markBookingConfirmationFailure(appointmentId,authorityFailure,{clientId:authority?.client_id||clientId,contactId:authority?.contact_id||null,nameAuthorityId:authority?.name_authority_id||null,db});
      return {sent:false,reason:authorityFailure,deliveryStatus:'manual_action_required',retryable:true};
    }
    const nameResolution=identityModel==='crm_v2'
      ? {name:String(authority.client_name_snapshot||'').trim(),authorityId:null}
      : await resolveName(authority.client_id,db);
    if(!nameResolution?.name||(identityModel==='legacy'&&!nameResolution?.authorityId)){
      await markBookingConfirmationFailure(appointmentId,'client_name_authority_not_found',{clientId:authority.client_id,contactId:authority.contact_id,nameAuthorityId:null,db});
      return {sent:false,reason:'client_name_authority_not_found',deliveryStatus:'manual_action_required',retryable:true};
    }
    const clientName=nameResolution.name;
    const phone=authority.client_phone;
    const ownershipFailure=await contactOwnershipFailure(authority,db);
    if(ownershipFailure){
      await markBookingConfirmationFailure(appointmentId,ownershipFailure,{clientId:authority.client_id,contactId:authority.contact_id,nameAuthorityId:nameResolution.authorityId||authority.name_authority_id,db});
      return {sent:false,reason:ownershipFailure,deliveryStatus:'manual_action_required',retryable:true};
    }
    claimed=await claimBookingConfirmation(appointmentId,{clientId:authority.client_id,contactId:authority.contact_id,nameAuthorityId:nameResolution.authorityId||authority.name_authority_id,db,recovery});
    if(!claimed){
      const existing=await db.query(`SELECT status,last_error FROM customer_message_deliveries WHERE appointment_id=$1 AND message_kind='booking_confirmation'`,[appointmentId]);
      const state=existing.rows[0];
      return {sent:false,reason:state?.status==='sent'?'already_sent':state?.last_error||'already_sent_or_in_progress',deliveryStatus:state?.status||'unknown'};
    }
    await queueBookingConfirmationMyShilohNotification({
      appointmentId,
      crmV2ClientId: authority.crm_v2_client_id,
      clientName,
      serviceName,
      startsAt,
      endsAt,
    });
    const token=await ensureToken(appointmentId,db);const root=baseUrl();
    const ics=root?`${root}/calendar/${token}.ics`:'';
    const google=googleCalendarUrl({serviceName,staffName,locationName,startsAt,endsAt});
    const date=fmtDate(startsAt),time=`${fmtTime(startsAt)}–${fmtTime(endsAt)}`;
    const template=env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE;

    if(controlledE2e){
      await assertE2eTarget({
        clientId:authority.client_id,
        crmV2ClientId:authority.crm_v2_client_id,
        phone,
        env,
      });
    }

    await enrollLifecycle({
      appointmentId,
      clientId:authority.client_id,
      crmV2ClientId:authority.crm_v2_client_id,
      clientName,
      phone,
      service:serviceName,
      appointmentAt:startsAt,
      appointmentEndsAt:endsAt,
      therapist:staffName,
      source,
    });

    let confirmationActions={googleCalendar:false,appleOutlook:false,changeButtons:false,postConfirmationMenu:false};
    if(template){
      const payload=bookingConfirmationTemplatePayload({template,appointmentId,clientName,serviceName,staffName,date,time,google,ics});
      providerAttempted=true;
      const response=await sendTemplate(phone,template,payload.bodyParameters,env.WHATSAPP_TEMPLATE_LANGUAGE||'en',payload.quickReplyPayloads);
      acceptedProviderMessageId=providerMessageId(response);
      providerAccepted=true;
    }else{
      const greeting=clientName?`Hi ${clientName}, your appointment is confirmed.`:'Your appointment is confirmed.';
      const lines=['*Booking confirmed 🌿*','',greeting,'',`✨ *Service:* ${serviceName}`,`👤 *With:* ${staffName}`,`📅 *Date:* ${date}`,`🕙 *Time:* ${time}`];
      if(locationName)lines.push(`📍 *Location:* ${locationName}`);
      lines.push('','We look forward to seeing you. 🌿');
      providerAttempted=true;
      const response=await sendMessage(phone,lines.join('\n'));
      acceptedProviderMessageId=providerMessageId(response);
      providerAccepted=true;
    }

    await markBookingConfirmationSent(appointmentId,{templateName:template||null,providerMessageId:acceptedProviderMessageId,resetProviderEvidence:recovery},db);

    const supplementalActionsSuppressed=!shouldSendLegacyConfirmationSupplements(template);
    if(!supplementalActionsSuppressed){
      const actionContext=identityModel==='crm_v2'
        ? {appointmentId,crmV2ClientId:Number(authority.crm_v2_client_id)}
        : {appointmentId,clientId:Number(authority.client_id)};
      confirmationActions.googleCalendar=await sendOptionalConfirmationAction('google_calendar',()=>sendCta(phone,'Add to Google Calendar','Google Calendar',google),actionContext);
      if(ics){
        confirmationActions.appleOutlook=await sendOptionalConfirmationAction('apple_outlook_calendar',()=>sendCta(phone,'Add to Apple / Outlook','Apple / Outlook',ics),actionContext);
      }
      confirmationActions.changeButtons=await sendOptionalConfirmationAction('booking_change_buttons',()=>sendButtons(phone,'*Need to make a change?*\nUse a button below, or type *RESCHEDULE* or *CANCEL*.',[
        {id:'client_reschedule_booking',title:'Reschedule'},
        {id:'client_cancel_booking',title:'Cancel booking'},
      ]),actionContext);
      confirmationActions.postConfirmationMenu=await sendOptionalConfirmationAction('post_confirmation_menu',()=>sendButtons(phone,'*What would you like to do next?*\nYou can also type *BOOK ANOTHER TREATMENT*, *MY APPOINTMENTS*, or *MAIN MENU*.',postConfirmationButtons()),actionContext);
    }

    const sentAuditMetadata=identityModel==='crm_v2'
      ? {crmV2ClientId:Number(authority.crm_v2_client_id),identityModel:'crm_v2_exact_mobile',calendarLinks:true,template:Boolean(template),templateName:template||null,providerMessageId:acceptedProviderMessageId,lifecycleEnrolled:true,idempotentDelivery:true,supplementalActionsSuppressed,confirmationActions}
      : {clientId:Number(authority.client_id),contactId:Number(authority.contact_id),identityVerificationId:Number(authority.identity_verification_id),calendarLinks:true,template:Boolean(template),templateName:template||null,providerMessageId:acceptedProviderMessageId,lifecycleEnrolled:true,idempotentDelivery:true,supplementalActionsSuppressed,confirmationActions,nameAuthorityId:Number(nameResolution.authorityId)};
    await db.query(`INSERT INTO crm_audit_events (action,entity_type,entity_id,metadata) VALUES ('customer.booking_confirmation_sent','appointment',$1,$2::jsonb)`,[appointmentId,JSON.stringify(sentAuditMetadata)]);
    return {sent:true,deliveryStatus:'sent',templateName:template||null,providerMessageId:acceptedProviderMessageId,supplementalActionsSuppressed,confirmationActions};
  }catch(error){
    if(claimed&&!providerAccepted){
      try{
        if(providerAttempted&&!error.response)await markBookingConfirmationUncertain(appointmentId,db);
        else await releaseBookingConfirmationClaim(appointmentId,providerAttempted?'provider_rejected':'pre_send_failure',db);
      }catch(releaseError){logger.error({err:releaseError,appointmentId},'Booking confirmation claim release failed');}
    }
    logger.error({err:error,appointmentId,providerAccepted},'Customer booking confirmation failed');
    const uncertain=providerAccepted||(providerAttempted&&!error.response);
    return {sent:false,reason:uncertain?'delivery_state_uncertain':'send_failed',deliveryStatus:uncertain?'uncertain':'retry_pending',retryable:!uncertain};
  }
}

async function practitionerApprovalStatus(appointmentId,db=pool){
  const table=await db.query(`SELECT to_regclass('public.appointment_booking_approvals') AS table_name`);
  if(!table.rows[0]?.table_name)return null;
  const result=await db.query(`SELECT status FROM appointment_booking_approvals WHERE appointment_id=$1`,[appointmentId]);
  return result.rows[0]?.status||null;
}

async function sendCustomerBookingConfirmationForAppointment(appointmentId,options={}){
  const db=options.db||pool;
  const r=await db.query(`
    SELECT a.id,a.client_id,
           COALESCE(linked.starts_at,a.starts_at) AS starts_at,
           COALESCE(linked.ends_at,a.ends_at) AS ends_at,
           a.source,l.name AS location_name,
           COALESCE(linked.service_name,(SELECT string_agg(service_name_snapshot,' + ' ORDER BY position) FROM appointment_services WHERE appointment_id=a.id),a.title,'Shiloh appointment') AS service_name,
           COALESCE(linked.staff_name,(SELECT string_agg(staff_name_snapshot,' + ' ORDER BY position) FROM appointment_staff WHERE appointment_id=a.id),'Shiloh practitioner') AS staff_name
      FROM appointments a LEFT JOIN locations l ON l.id=a.location_id
      LEFT JOIN LATERAL (
        SELECT ag.starts_at,ag.ends_at,
               string_agg(aps.service_name_snapshot,' + ' ORDER BY gm.guest_position) AS service_name,
               string_agg(ast.staff_name_snapshot,' + ' ORDER BY gm.guest_position) AS staff_name
          FROM appointment_group_members seed
          JOIN appointment_groups ag ON ag.id=seed.group_id AND ag.group_type='multi_service_booking'
          JOIN appointment_group_members gm ON gm.group_id=ag.id
          JOIN appointment_services aps ON aps.appointment_id=gm.appointment_id AND aps.position=1
          JOIN appointment_staff ast ON ast.appointment_id=gm.appointment_id AND ast.position=1
         WHERE seed.appointment_id=a.id
         GROUP BY ag.id
      ) linked ON TRUE
     WHERE a.id=$1 AND a.status<>'cancelled'`,[appointmentId]);
  const a=r.rows[0];if(!a)return {sent:false,reason:'appointment_not_found'};
  if(options.controlledE2e===true){
    const authority=await loadBookingConfirmationAuthority(appointmentId,db);
    await (options.assertE2eTarget||assertControlledMessagingTestTarget)({
      clientId:authority?.client_id,
      crmV2ClientId:authority?.crm_v2_client_id,
      phone:authority?.client_phone,
      env:options.env||process.env,
    });
  }
  if(a.source==='shiloh_client_whatsapp'){
    const approval=await practitionerApprovalStatus(appointmentId,db);
    if(approval!=='approved')return {sent:false,reason:'practitioner_approval_required'};
  }
  const recovery=options.recovery===true;
  if(recovery){
    const prepared=await prepareBookingConfirmationRecovery(appointmentId,{db,operatorAdminId:options.operatorAdminId||null,now:options.now||new Date()});
    if(!prepared.prepared)return {sent:false,reason:prepared.reason,deliveryStatus:'not_recovered'};
  }else{
    const already=await db.query(`SELECT 1 FROM crm_audit_events WHERE action='customer.booking_confirmation_sent' AND entity_type='appointment' AND entity_id=$1 LIMIT 1`,[appointmentId]);
    if(already.rowCount)return {sent:false,reason:'already_sent'};
  }
  const queued=await queueCustomerBookingConfirmation(appointmentId,{db,recovery});
  if(queued.status==='sent')return {sent:false,reason:'already_sent',deliveryStatus:'sent'};
  if(db===pool&&options.depositGate!==false){
    const paymentService=options.paymentService||createBookingPaymentService({db});
    const deposit=await paymentService.ensureDepositRequest({appointmentId});
    if(deposit?.deposit?.applicable&&deposit.deposit.requirement?.state==='awaiting'){
      return {
        sent:false,
        reason:'deposit_required',
        deliveryStatus:'awaiting_deposit',
        deposit:{
          amount:Number(deposit.deposit.requirement.required_amount).toFixed(2),
          policyVersion:deposit.deposit.requirement.policy_version,
          requests:(deposit.requests||[]).map(request=>({
            requestKey:request.request_key,
            amount:Number(request.amount).toFixed(2),
            paymentPath:request.provider_payment_url?`/pay/${request.request_key}`:null,
          })),
        },
      };
    }
  }
  return sendCustomerBookingConfirmation({appointmentId:a.id,clientId:a.client_id,serviceName:a.service_name,staffName:a.staff_name,locationName:a.location_name,startsAt:a.starts_at,endsAt:a.ends_at,source:a.source||'shiloh'},{...options,db});
}

async function flushCustomerBookingConfirmations(){
  await ensureDeliveryTable();
  const due=await pool.query(`
    SELECT appointment_id,last_error,attempt_count
      FROM customer_message_deliveries
     WHERE message_kind='booking_confirmation'
       AND status IN ('pending','failed')
       AND next_attempt_at<=NOW()
       AND provider_delivered_at IS NULL
       AND provider_read_at IS NULL
       AND (provider_sent_at IS NULL
         OR (provider_failed_at IS NOT NULL AND provider_failed_at>provider_sent_at))
       AND (COALESCE(last_error,'')<>'provider_async_failed'
         OR attempt_count<${MAX_AUTOMATIC_ASYNC_PROVIDER_ATTEMPTS})
     ORDER BY next_attempt_at,appointment_id
     LIMIT 25`);
  const results=[];
  for(const row of due.rows){
    const automaticProviderRecovery=String(row.last_error||'')==='provider_async_failed';
    results.push({
      appointmentId:Number(row.appointment_id),
      result:await sendCustomerBookingConfirmationForAppointment(
        row.appointment_id,
        automaticProviderRecovery?{recovery:true}:{}
      ),
    });
  }
  return {attempted:results.length,results};
}

function startCustomerBookingConfirmationScheduler(){
  if(deliveryScheduler)return;
  setImmediate(()=>flushCustomerBookingConfirmations().catch((error)=>logger.error({err:error},'Initial booking confirmation retry scan failed')));
  deliveryScheduler=setInterval(()=>{
    flushCustomerBookingConfirmations().catch((error)=>logger.error({err:error},'Initial booking confirmation retry scan failed'));
  },BOOKING_CONFIRMATION_RETRY_MS);
  deliveryScheduler.unref?.();
  logger.info({retryMinutes:BOOKING_CONFIRMATION_RETRY_MS/60000},'Initial booking confirmation scheduler started');
}

module.exports={sendCustomerBookingConfirmation,sendCustomerBookingConfirmationForAppointment,queueCustomerBookingConfirmation,loadBookingConfirmationAuthority,initialDeliveryFailure,flushCustomerBookingConfirmations,startCustomerBookingConfirmationScheduler,googleCalendarUrl,claimBookingConfirmation,releaseBookingConfirmationClaim,markBookingConfirmationSent,markBookingConfirmationFailure,markBookingConfirmationUncertain,prepareBookingConfirmationRecovery,providerOutcome,recoveryState,ensureDeliveryTable,ensureToken,practitionerApprovalStatus,shouldSendLegacyConfirmationSupplements,bookingConfirmationTemplatePayload,providerMessageId,LIVE_BOOKING_CONFIRMATION_V1,LIVE_BOOKING_CONFIRMATION_V2,BOOKING_CONFIRMATION_RETRY_MS,BOOKING_CONFIRMATION_RECOVERY_STALE_MS,MAX_AUTOMATIC_ASYNC_PROVIDER_ATTEMPTS};
