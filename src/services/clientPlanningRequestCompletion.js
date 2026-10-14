'use strict';

const crypto = require('node:crypto');
const { isDerivedGlobalCoordinator } = require('./workspaceBookingRequestRouting');

// Only clinic visits with a recorded attendance outcome can resolve an enquiry.
function attendedPredicate(alias = 'a') {
  return `${alias}.client_id IS NULL AND ${alias}.ends_at<=NOW()
    AND ${alias}.status IN ('completed','no_charge')
    AND NOT EXISTS (SELECT 1 FROM appointment_booking_approvals approval
      WHERE approval.appointment_id=${alias}.id AND approval.status<>'approved')
    AND (NOT EXISTS (SELECT 1 FROM appointment_services aps WHERE aps.appointment_id=${alias}.id)
      OR EXISTS (SELECT 1 FROM appointment_services aps LEFT JOIN service_visibility_policies visibility
        ON visibility.service_id=aps.service_id AND visibility.visibility_scope='tenant_private'
        WHERE aps.appointment_id=${alias}.id AND visibility.service_id IS NULL))`;
}

function createPlanningRequestCompletion({ db, ErrorClass }) {
  const fail = (code,message,status=409) => { throw new ErrorClass(code,message,status); };
  const id = value => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : null;
  function requirePrincipal(principal) {
    if (!isDerivedGlobalCoordinator(principal)) fail('PLANNING_FORBIDDEN','Reception access is required.',403);
  }
  async function attendedAppointments({ principal, requestId }) {
    requirePrincipal(principal);
    const request = await db.query('SELECT id,updated_at FROM client_planning_requests WHERE id=$1 AND status IN (\'requested\',\'planning\')',[id(requestId)]);
    if (!request.rows[0]) fail('PLANNING_ALREADY_RESOLVED','This enquiry has changed. Refresh Dashboard.');
    const result = await db.query(`SELECT a.id,a.starts_at AS "startsAt",a.ends_at AS "endsAt",
      (SELECT string_agg(aps.service_name_snapshot,' + ' ORDER BY aps.id) FROM appointment_services aps WHERE aps.appointment_id=a.id) AS "serviceName",
      (SELECT string_agg(ast.staff_name_snapshot,' + ' ORDER BY ast.staff_id) FROM appointment_staff ast WHERE ast.appointment_id=a.id) AS "staffNames"
      FROM client_planning_requests r JOIN appointments a ON a.crm_v2_client_id=r.crm_v2_client_id
      WHERE r.id=$1 AND r.status IN ('requested','planning') AND ${attendedPredicate()}
      ORDER BY a.starts_at DESC,a.id DESC LIMIT 25`,[id(requestId)]);
    return { appointments:result.rows, revision:new Date(request.rows[0].updated_at).toISOString() };
  }
  async function resolve({ principal, requestId, action, appointmentId, expectedRevision, operationId, confirmed }) {
    requirePrincipal(principal);
    const adminId=id(principal.id || principal.calendarAuthority?.operatorAdminId), target=id(requestId);
    const linked=action==='attended' ? id(appointmentId) : null;
    const revision=new Date(expectedRevision).getTime();
    if (!adminId || !target || !['attended','cancelled'].includes(action) || confirmed!==true
      || !Number.isFinite(revision) || (action==='attended'&&!linked) || (action==='cancelled'&&appointmentId!=null)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(operationId||''))) {
      fail('PLANNING_RESOLUTION_INVALID','Review and confirm the current enquiry.',422);
    }
    const key=operationId.toLowerCase();
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify({ adminId,target,action,linked,revision })).digest('hex');
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      const authority=await client.query('SELECT * FROM staff_admin_accounts WHERE id=$1 FOR SHARE',[adminId]);
      const current=authority.rows[0];
      const staff=current?.staff_id ? await client.query('SELECT status FROM staff WHERE id=$1 FOR SHARE',[current.staff_id]) : null;
      if (!current?.active || (staff && staff.rows[0]?.status!=='active') || !isDerivedGlobalCoordinator(current)) {
        fail('PLANNING_FORBIDDEN','Reception access has changed. Sign in again.',403);
      }
      const found=await client.query('SELECT * FROM client_planning_requests WHERE id=$1 FOR UPDATE',[target]);
      const row=found.rows[0];
      if (row?.resolution_request_id===key && row.resolution_fingerprint===fingerprint) {
        await client.query('COMMIT'); return { id:target,status:row.status,replayed:true };
      }
      if (!row || !['requested','planning'].includes(row.status) || new Date(row.updated_at).getTime()!==revision) {
        fail('PLANNING_STALE_REVISION','This enquiry has changed. Refresh Dashboard before trying again.');
      }
      if (linked) {
        const visit=await client.query(`SELECT a.id FROM appointments a WHERE a.id=$1 AND a.crm_v2_client_id=$2
          AND ${attendedPredicate()} FOR UPDATE OF a`,[linked,row.crm_v2_client_id]);
        if (!visit.rowCount) fail('PLANNING_VISIT_CHANGED','Choose this client’s completed clinic visit. Record the past appointment and its attendance outcome first, then refresh visits.');
      }
      await client.query(`UPDATE client_planning_requests SET status=$2,linked_appointment_id=$3,decided_by_admin_id=$4,
        decided_at=NOW(),updated_at=NOW(),resolution_request_id=$5,resolution_fingerprint=$6 WHERE id=$1`,[target,action,linked,adminId,key,fingerprint]);
      await client.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
        VALUES($1,$2,'client_planning_request',$3,$4::jsonb)`,[adminId,`planning_request.${action}`,target,
        JSON.stringify({ operationId:key,appointmentId:linked,reason:action==='cancelled'?'client_cancelled':'visit_already_attended' })]);
      await client.query('COMMIT');
      return { id:target,status:action,replayed:false };
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>{});
      if (error.code==='23505') fail('PLANNING_OPERATION_CONFLICT','This confirmation has already been used. Refresh Dashboard.');
      throw error;
    } finally { client.release(); }
  }
  return { attendedAppointments,resolve };
}

module.exports={ createPlanningRequestCompletion,attendedPredicate };
