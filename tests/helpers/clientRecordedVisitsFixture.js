'use strict';
const { PGlite } = require('@electric-sql/pglite');
const { createWorkspaceClientsService } = require('../../src/services/workspaceClients');
const { readClientRecordedVisits } = require('../../src/services/clientRecordedVisits');

async function clientRecordedVisitsFixture({ nativeUrl = null } = {}) {
  let sql;
  if (nativeUrl) {
    const url = new URL(nativeUrl);
    if (!['postgres:','postgresql:'].includes(url.protocol) || url.search || url.hash || !['localhost','127.0.0.1'].includes(url.hostname) || !['/recorded_visits','/package_proof'].includes(url.pathname)) throw Error('Only the explicit local fictional test database is allowed');
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: nativeUrl, max: 1 });
    const connection = await pool.connect();
    const schema = 'recorded_visits_' + require('node:crypto').randomBytes(8).toString('hex');
    await connection.query(`CREATE SCHEMA ${schema}`);
    await connection.query(`SET search_path TO ${schema}`);
    sql = { exec: text => connection.query(text), query: (text, values) => connection.query(text, values), close: async () => { try { await connection.query(`DROP SCHEMA ${schema} CASCADE`); } finally { connection.release(); await pool.end(); } } };
  } else sql = new PGlite();
  await sql.exec(`
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY,name text,normalized_mobile text,date_of_birth date,gender text,profile_status text,mobile_verified_at timestamptz,source text,status text,provenance jsonb,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW());
    CREATE TABLE crm_v2_client_relationships(client_id bigint,relationship_type text,owner_staff_id bigint,status text);
    CREATE TABLE appointments(id bigint PRIMARY KEY,client_id bigint,crm_v2_client_id bigint,starts_at timestamptz,ends_at timestamptz,status text,title text);
    CREATE INDEX fixture_client_visits ON appointments(crm_v2_client_id);
    CREATE TABLE appointment_group_members(group_id bigint,appointment_id bigint UNIQUE);
    CREATE TABLE appointment_services(appointment_id bigint,service_id bigint,position int,service_name_snapshot text);
    CREATE INDEX fixture_appointment_services ON appointment_services(appointment_id);
    CREATE TABLE service_visibility_policies(service_id bigint PRIMARY KEY,visibility_scope text,owner_staff_id bigint);
    CREATE TABLE staff(id bigint,status text);
    CREATE TABLE staff_admin_accounts(id bigint,staff_id bigint,display_name text,permissions jsonb,business_role text,active boolean);
    INSERT INTO staff VALUES(7,'active');
    INSERT INTO staff_admin_accounts VALUES(41,7,'Synthetic operator','{"client:lookup":true}','business_admin',TRUE);
    INSERT INTO crm_v2_clients(id,name,status,profile_status,provenance) VALUES(1,'Synthetic Alpha','active','registered','{}'),(2,'Synthetic Guest','active','minimal','{}'),(3,'Synthetic Private','active','registered','{}');
    INSERT INTO crm_v2_client_relationships VALUES(1,'clinic',NULL,'active'),(2,'clinic',NULL,'active'),(1,'tenant_staff',7,'active'),(3,'tenant_staff',7,'active');
    INSERT INTO service_visibility_policies VALUES(90,'tenant_private',7),(91,'tenant_private',8);
  `);
  const calls = [];
  const query = async (text, values = []) => {
    const call = { text, values }; calls.push(call);
    try { return await sql.query(text, values); } catch (error) { call.errorCode = error.code; throw error; }
  };
  let releases = 0;
  const db = { query, connect: async () => ({ query, release: () => { releases++; } }) };
  const scope = { kind: 'clinic', ownerStaffId: null };
  async function add({ id, client = 1, date = '2026-10-01', time = '09:00', status = 'completed', group = null, services = [{ id: 10, name: 'Back massage' }], legacy = null, end = null }) {
    const start = `${date}T${time}:00+02:00`;
    await query('INSERT INTO appointments VALUES($1,$2,$3,$4,$5,$6,$7)', [id, legacy, client, start, end || new Date(new Date(start).getTime() + 3600000).toISOString(), status, 'Synthetic appointment']);
    if (group) await query('INSERT INTO appointment_group_members VALUES($1,$2)', [group, id]);
    for (let i = 0; i < services.length; i++) await query('INSERT INTO appointment_services VALUES($1,$2,$3,$4)', [id, services[i].id, i + 1, services[i].name]);
  }
  const readService = {
    async listClients({ q = '', limit = 25, offset = 0 }) { return (await query("SELECT * FROM crm_v2_clients WHERE id IN (1,2) AND name ILIKE $1 ORDER BY name,id LIMIT $2 OFFSET $3", [`%${q}%`, limit, offset])).rows; },
    async getClient(id) { return (await query('SELECT * FROM crm_v2_clients WHERE id=$1 AND id IN (1,2)', [id])).rows[0]; },
    async getClientAppointments(id, { limit, offset }) { return (await query("SELECT a.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('name',service_name_snapshot)) FROM appointment_services WHERE appointment_id=a.id),'[]') services,'[]'::jsonb staff FROM appointments a WHERE crm_v2_client_id=$1 AND client_id IS NULL ORDER BY starts_at DESC,id DESC LIMIT $2 OFFSET $3", [id, limit, offset])).rows; },
  };
  const service = createWorkspaceClientsService({ db, readService,
    visitReader: options => readClientRecordedVisits({ ...options, asOf: '2026-11-08T08:00:00Z' }),
    communicationService: { listForClient: async () => [] },
    policyAcceptanceService: { listClientAcceptanceHistory: async () => [], readinessForAppointments: async () => new Map() },
    submissionService: { listClientHistory: async () => ({ items: [], page: 0, hasMore: false }) },
    rewardsService: { getWorkspaceClientModel: async () => ({}) }, voucherService: { getWorkspaceClientModel: async () => ({ received: [], purchased: [] }) },
    paymentService: { getSummary: async () => { const error = Error('Synthetic financial access restricted'); error.httpStatus = 403; throw error; } },
  });
  return { sql, db, calls, scope, add, service, releases: () => releases, close: () => sql.close() };
}
module.exports = { clientRecordedVisitsFixture };
