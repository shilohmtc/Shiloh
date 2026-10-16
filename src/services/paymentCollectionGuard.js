'use strict';

// Positive provenance for new local deposit preparation and client attempts.
// Historic created/empty-URL requests are deliberately NOT treated as unissued.
const provenUnissuedDeposit = row => /^(dpc2|dpm2)_[A-Za-z0-9_-]+$/.test(String(row.request_key || ''))
  && row.unissued_provenance === true && row.created_by_admin_id === null
  && row.purpose === 'deposit' && Number(row.deposit_requirement_id)>0 && Number(row.deposit_member_appointment_id)>0
  && row.state === 'created' && !row.provider_payment_url && !row.provider_request_id;
const deferredDeposit = row => /^dpc2_/.test(String(row.request_key||'')) && provenUnissuedDeposit(row);
function depositPreparationProvenance(alias='pr') {
  if(!/^[a-z]+$/.test(alias))throw new Error('Invalid internal payment alias');
  return `EXISTS(SELECT 1 FROM crm_audit_events proof
    JOIN booking_deposit_requirements r ON r.id=${alias}.deposit_requirement_id AND r.payment_account_id=${alias}.payment_account_id
    JOIN booking_deposit_requirement_members member ON member.requirement_id=r.id AND member.appointment_id=${alias}.deposit_member_appointment_id
    WHERE proof.action='payment.deposit_prepared_without_provider' AND proof.entity_type='payment_request' AND proof.entity_id=${alias}.id
      AND proof.metadata->>'requestKey'=${alias}.request_key AND proof.metadata->>'amount'=${alias}.amount::text
      AND proof.metadata->>'requirementId'=${alias}.deposit_requirement_id::text
      AND proof.metadata->>'memberAppointmentId'=${alias}.deposit_member_appointment_id::text
      AND proof.metadata->>'payerCrmV2ClientId'=${alias}.payer_crm_v2_client_id::text)`;
}
const clientAttempt = row => /^cpc_[A-Za-z0-9_-]+$/.test(String(row.request_key || '')) && row.created_by_admin_id === null;
const unresolved = row => !deferredDeposit(row) && !['paid', 'refunded', 'partially_refunded'].includes(row.state);

async function lockBookingPaymentScope(queryable, appointmentId, ErrorType=Error) {
  const seed=(await queryable.query('SELECT group_id FROM appointment_group_members WHERE appointment_id=$1',[appointmentId])).rows[0];
  if(seed){
    await queryable.query('SELECT id FROM appointment_groups WHERE id=$1 FOR UPDATE',[seed.group_id]);
    await queryable.query('SELECT appointment_id FROM appointment_group_members WHERE group_id=$1 ORDER BY appointment_id FOR UPDATE',[seed.group_id]);
  }
  await queryable.query(`SELECT a.id FROM appointments a WHERE a.id=$1 OR ($2::bigint IS NOT NULL AND EXISTS(
    SELECT 1 FROM appointment_group_members gm WHERE gm.appointment_id=a.id AND gm.group_id=$2)) ORDER BY a.id FOR UPDATE OF a`,[appointmentId,seed?.group_id||null]);
  const current=(await queryable.query('SELECT group_id FROM appointment_group_members WHERE appointment_id=$1',[appointmentId])).rows[0];
  if(String(current?.group_id||'')!==String(seed?.group_id||'')){
    throw guardError(ErrorType,'PAYMENT_SCOPE_CHANGED','The linked booking changed. Refresh before another financial decision.');
  }
}

function guardError(ErrorType,code,message){
  const error=ErrorType===Error?new Error(message):new ErrorType(code,message,409);
  error.code=code;error.httpStatus=409;return error;
}
async function assertNoClientCollection(queryable, accountId, ErrorType=Error) {
  const rows = (await queryable.query('SELECT * FROM payment_requests WHERE payment_account_id=$1 ORDER BY id', [accountId])).rows;
  if (rows.some(row => clientAttempt(row) && unresolved(row))) {
    throw guardError(ErrorType,'PAYMENT_CLIENT_ATTEMPT_UNRESOLVED','A client payment attempt needs review before another payment or credit can be prepared.');
  }
}

module.exports = { deferredDeposit, clientAttempt, unresolved, assertNoClientCollection, lockBookingPaymentScope, depositPreparationProvenance, provenUnissuedDeposit };
