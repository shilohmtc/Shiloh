const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { PostgresCrmV2ClientRepository } = require('../src/repositories/crmV2ClientRepository');
const { createCrmV2ClientService } = require('../src/services/crmV2ClientService');
const { isOrganiserContactGuest } = require('../src/services/crmV2GuestProfile');
async function fixture(t, migrated) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE crm_v2_clients(id BIGINT PRIMARY KEY,name TEXT,normalized_mobile TEXT,date_of_birth DATE,gender TEXT,profile_status TEXT DEFAULT 'minimal',mobile_verified_at TIMESTAMPTZ,source TEXT DEFAULT 'staff',status TEXT DEFAULT 'active',provenance JSONB DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW(),first_name TEXT,surname TEXT);
    INSERT INTO crm_v2_clients(id,name,normalized_mobile) VALUES(1,'Synthetic direct','27810000001');`);
  if(migrated) await db.exec(`ALTER TABLE crm_v2_clients ADD COLUMN contact_mode TEXT DEFAULT 'direct'; INSERT INTO crm_v2_clients(id,name,normalized_mobile,contact_mode,status) VALUES(2,'Synthetic guest',NULL,'organiser','archived');`);
  const repository = new PostgresCrmV2ClientRepository(db);
  return {db,repository,service:createCrmV2ClientService({repository})};
}
test('repository and direct profile edits work before the proposed schema exists', async t => {
 const {repository,service}=await fixture(t,false);
 assert.equal((await repository.getClientById(1)).contact_mode,null);
 assert.equal((await service.updateClient({clientId:1,name:'Updated direct'})).status,'updated');
 await assert.rejects(service.updateClient({clientId:1,mobile:''}),{code:'CRM_V2_INVALID_MOBILE'});
});
test('canonical phoneless guest can be edited and reactivated without resolving a shared phone', async t => {
 const {repository,service}=await fixture(t,true);
 assert.equal((await service.updateClient({clientId:2,name:'Updated guest',mobile:'',status:'active'})).status,'updated');
 const guest=await repository.getClientById(2);
 assert.equal(guest.normalized_mobile,null);assert.equal(guest.id,2);assert.equal(guest.status,'active');assert.equal(isOrganiserContactGuest(guest),true);
});
test('adding a genuine mobile preserves identity, rejects collisions and never verifies the phone', async t => {
 const {repository,service}=await fixture(t,true);
 assert.equal((await service.updateClient({clientId:2,mobile:'0810000001'})).status,'conflict');
 assert.equal((await repository.getClientById(2)).normalized_mobile,null);
 assert.equal((await service.updateClient({clientId:2,mobile:'0810000002'})).status,'updated');
 const guest=await repository.getClientById(2);assert.equal(guest.id,2);assert.equal(guest.contact_mode,'direct');assert.equal(guest.normalized_mobile,'27810000002');assert.equal(guest.mobile_verified_at,null);
});
test('incomplete or falsely verified classifications do not acquire guest handling', () => {
 for(const row of [{normalized_mobile:null},{contact_mode:'organiser',normalized_mobile:'27810000001',profile_status:'minimal'},{contact_mode:'organiser',normalized_mobile:null,profile_status:'registered'},{contact_mode:'organiser',normalized_mobile:null,profile_status:'minimal',mobile_verified_at:'2026-01-01'}]) assert.equal(isOrganiserContactGuest(row),false);
});
test('an unclassified missing-phone profile cannot be reactivated as a guest', async t => {
 const {db,service,repository}=await fixture(t,true);
 await db.exec("UPDATE crm_v2_clients SET normalized_mobile=NULL,status='archived' WHERE id=1");
 await assert.rejects(service.updateClient({clientId:1,status:'active'}),{code:'CRM_V2_INVALID_MOBILE'});
 assert.equal((await repository.getClientById(1)).status,'archived');
});
test('Workspace profile normalization only permits absent mobile from the locked canonical classification', () => {
 const {normalizeRequestedProfile,sameClientProfile}=require('../src/services/workspaceClientMutations');
 const input={name:'Synthetic guest',mobile:'',contact_mode:'organiser'};
 assert.throws(()=>normalizeRequestedProfile(input),{code:'CRM_V2_INVALID_MOBILE'});
 const current={name:input.name,normalized_mobile:null,contact_mode:'organiser',profile_status:'minimal',date_of_birth:null,gender:null};
 assert.equal(sameClientProfile(current,normalizeRequestedProfile(input,current)),true);
 assert.throws(()=>normalizeRequestedProfile({...input,mobile:'invalid'},current),{code:'CRM_V2_INVALID_MOBILE'});
});
