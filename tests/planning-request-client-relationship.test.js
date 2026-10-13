'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pool } = require('../src/db/pool');
const readService = require('../src/services/crmReadService');
const { createClientPlanningRequestService } = require('../src/services/clientPlanningRequests');

const migration = name => fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');

test('clinic enquiries establish scoped client visibility without booking or exposing unrelated tenant clients', async t => {
  const nativeUrl = process.env.TEST_PLANNING_RELATIONSHIP_DATABASE_URL;
  let pg;
  if (nativeUrl) {
    const { Client } = require('pg');
    const client = new Client({ connectionString:nativeUrl });
    await client.connect();
    const schema = `planning_relationship_test_${process.pid}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    pg = { query:(...args) => client.query(...args),exec:sql => client.query(sql),
      async close() { await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); } };
  } else pg = new PGlite();
  const originalQuery = pool.query;
  pool.query = (...args) => pg.query(...args);
  t.after(async () => { pool.query = originalQuery; await pg.close(); });
  await pg.exec(`
    CREATE TABLE crm_v2_clients(id bigint PRIMARY KEY, name text, normalized_mobile text,
      date_of_birth date, gender text, profile_status text, mobile_verified_at timestamptz, status text);
    CREATE TABLE staff(id bigint PRIMARY KEY);
    CREATE TABLE staff_admin_accounts(id bigint PRIMARY KEY);
    CREATE TABLE services(id bigint PRIMARY KEY);
    CREATE TABLE appointments(id bigint PRIMARY KEY, crm_v2_client_id bigint, client_id bigint, starts_at timestamptz);
    CREATE TABLE appointment_services(appointment_id bigint,service_id bigint);
    CREATE TABLE service_visibility_policies(service_id bigint,visibility_scope text,owner_staff_id bigint);
    INSERT INTO staff VALUES(7),(8);
    INSERT INTO crm_v2_clients(id,name,normalized_mobile,status) VALUES
      (1,'Existing enquiry','27820000001','active'),(2,'Future enquiry','27820000002','active'),
      (3,'Tenant only','27820000003','active'),(4,'Archived relationship','27820000004','active'),
      (5,'Archived master','27820000005','archived'),(6,'Registration only','27820000006','active');
  `);
  // Install the canonical relationship table/indexes without its historical
  // deployment-specific practitioner grant or appointment backfill.
  await pg.exec(migration('127_scoped_client_relationships.sql').split('-- Existing tenant-owned appointment history')[0]);
  await pg.exec(migration('163_client_planning_requests.sql'));
  await pg.exec(`
    INSERT INTO crm_v2_client_relationships(client_id,relationship_type,owner_staff_id,status,source)
      VALUES(3,'tenant_staff',7,'active','tenant_fixture'),(4,'clinic',NULL,'archived','operator_archive');
    INSERT INTO client_planning_requests(submission_key,payload_digest,crm_v2_client_id,request_kind,service_detail,special_occasion)
      SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, repeat('a',64), n,'flexible','Couples Massage',false
      FROM unnest(ARRAY[1,4,5]) n;
  `);
  const clinic = { kind:'clinic' };
  const tenant = { kind:'tenant_staff',ownerStaffId:7 };
  const list = scope => readService.listClients({ status:'active',scope });
  assert.equal(await readService.getClient(1,{ scope:clinic }),null);
  assert.deepEqual((await list(clinic)).map(row => Number(row.id)),[]);
  await pg.exec(migration('192_planning_request_client_relationship.sql'));
  assert.deepEqual((await list(clinic)).map(row => Number(row.id)),[1]);
  assert.equal((await readService.getClient(1,{ scope:clinic })).normalized_mobile,'27820000001');
  assert.deepEqual((await list(tenant)).map(row => Number(row.id)),[3]);
  assert.equal(await readService.getClient(1,{ scope:tenant }),null);
  assert.equal(await readService.getClient(3,{ scope:clinic }),null);
  assert.equal(await readService.getClient(6,{ scope:clinic }),null);
  assert.equal((await readService.getClient(4,{ scope:clinic })).status,'archived');
  assert.equal((await readService.getClient(5,{ scope:clinic })).status,'archived');

  const db = { async query(...args) { const result=await pg.query(...args); return { ...result,rowCount:result.rows.length || result.affectedRows || 0 }; } };
  const service = createClientPlanningRequestService({ db,now:() => new Date('2030-01-01') });
  const input = { crmV2ClientId:2,submissionKey:'00000000-0000-4000-8000-000000000002',
    kind:'flexible',serviceDetail:'Couples Massage',specialOccasion:false };
  assert.equal((await service.submit(input)).created,true);
  assert.equal((await readService.getClient(2,{ scope:clinic })).normalized_mobile,'27820000002');
  assert.equal((await service.submit(input)).created,false);
  await pg.exec(migration('192_planning_request_client_relationship.sql'));
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM crm_v2_client_relationships WHERE client_id=2')).rows[0].count,1);
  assert.equal((await pg.query('SELECT source FROM crm_v2_client_relationships WHERE client_id=4')).rows[0].source,'operator_archive');

  await pg.exec('BEGIN');
  await pg.exec(`INSERT INTO client_planning_requests(submission_key,payload_digest,crm_v2_client_id,request_kind,service_detail,special_occasion)
    VALUES('00000000-0000-4000-8000-000000000006',repeat('b',64),6,'flexible','Synthetic treatment',false)`);
  assert.ok(await readService.getClient(6,{ scope:clinic }));
  await pg.exec('ROLLBACK');
  assert.equal(await readService.getClient(6,{ scope:clinic }),null);
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM appointments')).rows[0].count,0);
});
