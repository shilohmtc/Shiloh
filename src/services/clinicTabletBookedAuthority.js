'use strict';
const crypto=require('node:crypto');
const {requiredFormVersionsSql,projectRequiredForm}=require('./consultationFormReadiness');
const {hashAccessToken}=require('./clientConsultationForms');
const {TabletJourneyError}=require('./clinicTabletBookedJourney');
const revision=row=>crypto.createHash('sha256').update(JSON.stringify([String(row.id),String(row.crm_v2_client_id),row.starts_at,row.appointment_revision,row.client_revision,row.normalized_mobile])).digest('hex');
function clinicDay(at){const day=new Date(at.getTime()+7200000).toISOString().slice(0,10);const start=new Date(`${day}T00:00:00+02:00`);return [start,new Date(start.getTime()+86400000)];}
function createClinicTabletBookedAuthority({db,formService,checkin,now=()=>new Date()}={}){
  if(!db?.query||!formService?.issueAccessToken||!formService?.openForm||!formService?.submitForm||!checkin?.tabletDeviceFor)throw new Error('Canonical tablet authorities required');
  const sql=`SELECT ap.id,ap.crm_v2_client_id,ap.starts_at,ap.updated_at AS appointment_revision,
    c.updated_at AS client_revision,c.normalized_mobile,
    COALESCE((SELECT string_agg(aps.service_name_snapshot,' + ' ORDER BY aps.position) FROM appointment_services aps WHERE aps.appointment_id=ap.id),ap.title,'Shiloh appointment') AS treatment
    FROM appointments ap JOIN crm_v2_clients c ON c.id=ap.crm_v2_client_id AND c.status='active'
    WHERE ap.client_id IS NULL AND ap.status IN ('scheduled','confirmed') AND c.id=$1
    AND ap.starts_at>=$2 AND ap.starts_at<$3
    AND EXISTS(SELECT 1 FROM crm_v2_client_relationships rel WHERE rel.client_id=c.id AND rel.relationship_type='clinic' AND rel.status='active')`;
  async function forVerifiedPhone(mobile,tx){
    if(!tx?.query)throw new Error('Tablet lookup requires its grant transaction');
    const owners=(await tx.query("SELECT id FROM crm_v2_clients WHERE normalized_mobile=$1 AND status='active' ORDER BY id LIMIT 2",[mobile])).rows;
    const historical=(await tx.query("SELECT 1 FROM client_contacts WHERE normalized_value=$1 AND contact_type IN ('mobile','whatsapp') LIMIT 1",[mobile])).rows;
    if(owners.length!==1||historical.length)return {ambiguous:true};
    const [start,end]=clinicDay(now());
    const rows=(await tx.query(`${sql} ORDER BY ap.starts_at,ap.id LIMIT 21`,[owners[0].id,start,end])).rows;
    return {clientId:owners[0].id,visits:rows.map(row=>({id:row.id,revision:revision(row),label:`${new Date(row.starts_at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} · ${row.treatment}`}))};
  }
  const lockedAssignments=new WeakMap();
  async function recheck(scope,tx){
    // Share staff queueing's assignment advisory locks BEFORE client/appointment
    // row locks; sorted order prevents two tablets forming a lock cycle.
    const assigned=(await tx.query('SELECT id FROM consultation_form_assignments WHERE appointment_id=$1 AND crm_v2_client_id=$2 ORDER BY id LIMIT 65',[scope.appointmentId,scope.clientId])).rows;
    if(assigned.length>64)return false;
    for(const row of assigned)await tx.query('SELECT pg_advisory_xact_lock(-$1::bigint)',[row.id]);
    lockedAssignments.set(tx,new Set(assigned.map(row=>String(row.id))));
    const [start,end]=clinicDay(now());
    const row=(await tx.query(`${sql} AND ap.id=$4 FOR SHARE OF ap,c`,[scope.clientId,start,end,scope.appointmentId])).rows[0];
    return !!row&&revision(row)===scope.revision;
  }
  async function required(scope,tx){
    const rows=(await tx.query(`SELECT fa.id,required.template_version_id,
      CASE WHEN fa.crm_v2_client_id=ap.crm_v2_client_id AND fa.client_id IS NULL THEN fa.status ELSE 'needs_review' END AS status,
      t.template_key,t.title,t.status AS template_status,sub.id AS submission_id
      FROM appointments ap JOIN LATERAL (${requiredFormVersionsSql()}) required ON TRUE
      LEFT JOIN consultation_form_template_versions tv ON tv.id=required.template_version_id
      LEFT JOIN consultation_form_templates t ON t.id=tv.template_id
      LEFT JOIN consultation_form_assignments fa ON fa.appointment_id=ap.id AND fa.template_version_id=required.template_version_id
      LEFT JOIN consultation_form_submissions sub ON sub.assignment_id=fa.id AND sub.template_version_id=fa.template_version_id
      WHERE ap.id=$1 AND ap.crm_v2_client_id=$2 AND ap.client_id IS NULL
      ORDER BY required.template_version_id`,[scope.appointmentId,scope.clientId])).rows;
    return rows.map(row=>{const f=projectRequiredForm(row);return {...f,completed:!f.actionRequired,canComplete:f.canComplete&&row.template_status==='active'};});
  }
  async function assignment(scope,tx,token=null){
    const result=await tx.query(`SELECT id,access_token_hash FROM consultation_form_assignments
      WHERE id=$1 AND appointment_id=$2 AND crm_v2_client_id=$3 AND client_id IS NULL FOR UPDATE`,[scope.assignmentId,scope.appointmentId,scope.clientId]);
    const row=result.rows[0];if(!row||(token&&row.access_token_hash!==hashAccessToken(token)))throw new TabletJourneyError('This form changed. Please ask Reception to check it.',409);
  }
  async function open(scope,tx){
    if(!lockedAssignments.get(tx)?.has(String(scope.assignmentId)))throw new TabletJourneyError('Required forms changed. Please ask Reception to check.',409);
    const prepared=(await tx.query(`SELECT 1 FROM clinic_checkin_form_handoffs WHERE assignment_id=$1 AND status IN ('queued','claimed') AND expires_at>$2 LIMIT 1`,[scope.assignmentId,now()])).rows;
    const elsewhere=(await tx.query(`SELECT 1 FROM clinic_tablet_visit_grants WHERE assignment_id=$1 AND state='form' AND expires_at>$2 AND last_activity_at>$3 LIMIT 1`,[scope.assignmentId,now(),new Date(now().getTime()-5*60*1000)])).rows;
    if(prepared.length||elsewhere.length)throw new TabletJourneyError('This form is already prepared on a tablet. Please ask Reception to help.',409);
    await assignment(scope,tx);
    const issued=await formService.issueAccessToken({assignmentId:scope.assignmentId,transaction:tx});
    await tx.query('UPDATE consultation_form_assignments SET access_expires_at=$3 WHERE id=$1 AND access_token_hash=$2',[scope.assignmentId,hashAccessToken(issued.token),new Date(Math.min(new Date(issued.expiresAt).getTime(),scope.expiresAt))]);
    return {assignmentId:scope.assignmentId,appointmentId:scope.appointmentId,clientId:scope.clientId,token:issued.token};
  }
  async function close(form,tx){
    await tx.query(`UPDATE consultation_form_assignments SET access_expires_at=$5 WHERE id=$1 AND appointment_id=$2 AND crm_v2_client_id=$3 AND access_token_hash=$4`,
      [form.assignmentId,form.appointmentId,form.clientId,hashAccessToken(form.token),now()]);
  }
  return {authorizeDevice:raw=>checkin.tabletDeviceFor(raw),visits:{forVerifiedPhone,recheck},forms:{required,open,close,
    model:async(form,tx)=>{await assignment(form,tx,form.token);const result=await formService.openForm(form.token,{transaction:tx});if(String(result.assignmentId)!==String(form.assignmentId))throw new Error('Tablet form scope changed');return result;},
    submit:async(form,answers,tx)=>{await assignment(form,tx,form.token);return formService.submitForm(form.token,answers,{transaction:tx});}}};
}
module.exports={createClinicTabletBookedAuthority,clinicDay};
