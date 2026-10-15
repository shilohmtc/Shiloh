'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { Pool } = require('pg');
const { pool } = require('../db/pool');
const { evaluateClientReadAuthority } = require('./workspaceClients');
const { evaluateClientManageAuthority } = require('./workspaceClientMutations');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['ordinary', 'multiple', 'couples']);
const ROLES = new Set(['owner', 'business_admin', 'booking_operator']);
let recorderPool;
function isolatedRecorder() {
  // Reuse existing credentials/TLS settings, with a bounded independent connection.
  // Exhausting or rolling back a booking transaction cannot consume this recorder's lease.
  if (recorderPool) return recorderPool;
  recorderPool = new Pool({ ...pool.options, max: 1, connectionTimeoutMillis: 250,
    query_timeout: 500, statement_timeout: 450, idleTimeoutMillis: 1000, allowExitOnIdle: true });
  recorderPool.on('error', () => {}); // An idle recorder failure cannot crash the booking process.
  return recorderPool;
}
function positiveId(value) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function technicalCode(error) {
  const code = String(error?.code || '');
  return /^(?:[0-5][0-9A-Z]|P0|F0|HV|XX)[0-9A-Z]{3}$/.test(code)
    || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENOTFOUND'].includes(code)
    ? code : 'BOOKING_CONFIRMATION_FAILED';
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function attemptContext({ clientId, kind, attemptKey, payload }) {
  if (!positiveId(clientId) || !KINDS.has(kind)) throw new Error('Invalid internal booking context');
  // The token is correlation only, never identity or authorisation. Older callers
  // without a token get independent references rather than guessed grouping.
  const key = UUID.test(String(attemptKey || '')) ? String(attemptKey).toLowerCase() : randomUUID();
  const fingerprint = createHash('sha256').update(key).update('\n').update(JSON.stringify(canonical(payload || {}))).digest('hex');
  return { clientId: positiveId(clientId), kind, attemptKey: key, fingerprint };
}
class BookingIncidentError extends Error {
  constructor(code, message, httpStatus) { super(message); this.code = code; this.httpStatus = httpStatus; }
}
const forbidden = () => new BookingIncidentError('BOOKING_PROBLEMS_FORBIDDEN', 'Your current client access does not allow this action.', 403);
const missing = () => new BookingIncidentError('BOOKING_PROBLEM_NOT_FOUND', 'This booking problem is unavailable or its support link has expired.', 404);

function createBookingSubmissionIncidentService({ db = pool, recordDb = null, now = () => new Date(), uuid = randomUUID } = {}) {
  const recording = () => recordDb || isolatedRecorder();
  async function failure(context, error) {
    const reference = uuid();
    try {
      const at = now().toISOString();
      const r = await recording().query(`/* bookingIncidents:failure */
        INSERT INTO booking_submission_incidents(reference,crm_v2_client_id,booking_kind,attempt_key,input_fingerprint,
          first_failed_at,last_failed_at,technical_code,expires_at)
        SELECT $1::uuid,c.id,$3::text,$4::uuid,$5::text,$6::timestamptz,$6::timestamptz,$7::text,$6::timestamptz+INTERVAL '14 days'
          FROM crm_v2_clients c WHERE c.id=$2::bigint AND c.status='active'
        ON CONFLICT(crm_v2_client_id,booking_kind,attempt_key,input_fingerprint) DO UPDATE SET
          last_failed_at=GREATEST(booking_submission_incidents.last_failed_at,EXCLUDED.last_failed_at),
          failure_count=booking_submission_incidents.failure_count+1,technical_code=EXCLUDED.technical_code,
          status='needs_help',recovered_at=NULL,resolved_at=NULL,revision=booking_submission_incidents.revision+1
        WHERE booking_submission_incidents.expires_at>EXCLUDED.first_failed_at
        RETURNING reference,expires_at`, [reference, context.clientId, context.kind, context.attemptKey, context.fingerprint, at, technicalCode(error)]);
      // No reference reuse or revival after the original fixed retention window.
      if (!r.rows[0] || new Date(r.rows[0].expires_at) <= now()) return { reference, linkSaved: false };
      return { reference: r.rows[0].reference, linkSaved: true };
    } catch (_) { return { reference, linkSaved: false }; }
  }
  async function success(context, result) {
    // Only a successfully returned canonical request result can clear this exact
    // attempt. No appointment search, fuzzy matching, replay or booking write.
    if (result?.status !== 'pending_resolution' || !(positiveId(result.appointmentId)
      || (Array.isArray(result.appointmentIds) && result.appointmentIds.length && result.appointmentIds.every(positiveId)))) return false;
    try {
      const r = await recording().query(`/* bookingIncidents:success */
        UPDATE booking_submission_incidents SET status='retry_succeeded',recovered_at=$5::timestamptz,
          resolved_at=NULL,revision=revision+1
        WHERE crm_v2_client_id=$1::bigint AND booking_kind=$2::text AND attempt_key=$3::uuid
          AND input_fingerprint=$4::text AND expires_at>$5::timestamptz AND status<>'retry_succeeded'
        RETURNING reference`, [context.clientId, context.kind, context.attemptKey, context.fingerprint, now().toISOString()]);
      return r.rows.length > 0;
    } catch (_) { return false; }
  }
  async function expire() {
    // Expired links are denied by every read/write even if this hourly purge is delayed.
    return recording().query('/* bookingIncidents:expire */ DELETE FROM booking_submission_incidents WHERE expires_at<=$1::timestamptz', [now().toISOString()]);
  }
  async function access(adminId, q = db, lock = false) {
    const r = await q.query(`/* bookingIncidents:principal */ SELECT a.id,a.staff_id,a.display_name,a.permissions,a.business_role,
      a.active AS admin_active,s.status AS staff_status FROM staff_admin_accounts a LEFT JOIN staff s ON s.id=a.staff_id
      WHERE a.id=$1::bigint${lock ? ' FOR SHARE OF a' : ''}`, [positiveId(adminId)]);
    if (lock && r.rows[0]?.staff_id) {
      const s = await q.query('SELECT status FROM staff WHERE id=$1 FOR SHARE', [r.rows[0].staff_id]);
      r.rows[0].staff_status = s.rows[0]?.status;
    }
    const read = evaluateClientReadAuthority(r.rows);
    if (!read || !ROLES.has(read.businessRole) || read.clientScope.kind !== 'clinic') throw forbidden();
    return { ...read, canResolve: Boolean(evaluateClientManageAuthority(r.rows)) };
  }
  async function audit(q, authority, action, reference = null, metadata = {}) {
    // No client id, attempt key/fingerprint or booking id: purging an incident
    // must really remove the reference-to-client link, including from audit.
    await q.query(`INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,metadata)
      VALUES($1,$2,'booking_submission_incident',$3::jsonb)`,
    [authority.operatorAdminId, action, JSON.stringify({ ...(reference ? { reference } : {}), ...metadata })]);
  }
  const visible = `JOIN crm_v2_clients c ON c.id=i.crm_v2_client_id
    WHERE i.expires_at>$1::timestamptz AND EXISTS(SELECT 1 FROM crm_v2_client_relationships cr
      WHERE cr.client_id=c.id AND cr.relationship_type='clinic' AND cr.owner_staff_id IS NULL AND cr.status='active')`;
  function dto(row, authority) {
    return { reference: row.reference, clientName: row.client_name, firstFailedAt: row.first_failed_at,
      lastFailedAt: row.last_failed_at, failureCount: Number(row.failure_count), status: row.status,
      recoveredAt: row.recovered_at, resolvedAt: row.resolved_at, revision: String(row.revision),
      expiresAt: row.expires_at, canResolve: authority.canResolve && row.status === 'needs_help',
      openClientHref: `/calendar/workspace/booking-problems/${row.reference}/client` };
  }
  async function list({ adminId, status = 'all', offset = 0 } = {}) {
    const a = await access(adminId);
    const filter = ['all','needs_help','retry_succeeded','resolved'].includes(status) ? status : 'all';
    const start = /^\d{1,6}$/.test(String(offset)) ? Number(offset) : 0;
    const at = now().toISOString();
    const r = await db.query(`/* bookingIncidents:list */ SELECT i.*,c.name AS client_name FROM booking_submission_incidents i ${visible}
      AND ($2::text='all' OR i.status=$2::text)
      ORDER BY (i.status='needs_help') DESC,i.last_failed_at DESC,i.id DESC LIMIT 26 OFFSET $3::int`, [at,filter,start]);
    const counts = await db.query(`SELECT COUNT(*) FILTER(WHERE i.status='needs_help')::int AS pending
      FROM booking_submission_incidents i ${visible}`, [at]);
    await audit(db, a, 'booking_problem.list_viewed');
    return { items: r.rows.slice(0,25).map(x => dto(x,a)), hasMore: r.rows.length > 25,
      offset:start, filter, pendingCount:counts.rows[0].pending };
  }
  async function listForDashboard(input) {
    try { return await list(input); }
    catch (e) { return e.httpStatus === 403 ? null : { unavailable: true, items: [], pendingCount: 0 }; }
  }
  async function target(q, reference, lock = false) {
    if (!UUID.test(String(reference || ''))) throw missing();
    const sql = `/* bookingIncidents:target */ SELECT i.*,c.name AS client_name FROM booking_submission_incidents i ${visible}
      AND i.reference=$2::uuid`;
    let r = await q.query(sql, [now().toISOString(),reference]);
    if (!r.rows[0]) throw missing();
    if (lock) {
      // Match canonical CRM lock order: relationship, client, then incident.
      // Taking the incident first could deadlock a client deletion's FK update.
      const relationship = await q.query(`SELECT client_id FROM crm_v2_client_relationships
        WHERE client_id=$1 AND relationship_type='clinic' AND owner_staff_id IS NULL AND status='active' FOR SHARE`, [r.rows[0].crm_v2_client_id]);
      if (!relationship.rows.length) throw missing();
      const client = await q.query('SELECT id FROM crm_v2_clients WHERE id=$1 FOR SHARE', [r.rows[0].crm_v2_client_id]);
      if (!client.rows.length) throw missing();
      r = await q.query(sql+' FOR UPDATE OF i', [now().toISOString(),reference]);
      if (!r.rows[0]) throw missing();
    }
    return r.rows[0];
  }
  async function openClient({ adminId, reference }) {
    const a = await access(adminId); const row = await target(db,reference);
    await audit(db,a,'booking_problem.client_opened',row.reference);
    return { href: `/calendar/clients/${Number(row.crm_v2_client_id)}` };
  }
  async function resolve({ adminId, reference, revision }) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL lock_timeout='2s'");
      await c.query("SET LOCAL statement_timeout='3s'");
      const a = await access(adminId,c,true);
      if (!a.canResolve) throw forbidden();
      const row = await target(c,reference,true);
      if (row.status !== 'needs_help' || !/^[1-9][0-9]*$/.test(String(revision || '')) || String(row.revision)!==String(revision)) {
        throw new BookingIncidentError('BOOKING_PROBLEM_CHANGED','This booking problem changed. Reload before resolving it.',409);
      }
      const updated = await c.query("UPDATE booking_submission_incidents SET status='resolved',resolved_at=$2::timestamptz,revision=revision+1 WHERE id=$1 AND expires_at>$2::timestamptz RETURNING reference",[row.id,now().toISOString()]);
      if (!updated.rows.length) throw missing();
      await audit(c,a,'booking_problem.resolved',row.reference,{ from:'needs_help',to:'resolved' });
      await c.query('COMMIT'); return { resolved:true };
    } catch (e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
    finally { c.release(); }
  }
  return { failure, success, expire, access, list, listForDashboard, openClient, resolve };
}
const service = createBookingSubmissionIncidentService();
module.exports = { UUID, technicalCode, attemptContext, BookingIncidentError, createBookingSubmissionIncidentService, service };
