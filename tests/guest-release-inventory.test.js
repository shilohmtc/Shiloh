const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {collect}=require('../scripts/guest-release-read-only-inventory');

test('release inventory emits only schema metadata/aggregate counts inside a bounded read-only transaction',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE schema_migrations(filename TEXT,checksum TEXT);
 CREATE TABLE crm_v2_clients(id BIGINT,normalized_mobile TEXT NOT NULL);
 CREATE TABLE appointment_lifecycle(phone TEXT NOT NULL);
 CREATE TABLE appointment_groups(id BIGINT);CREATE TABLE staff_admin_accounts(id BIGINT);
 INSERT INTO schema_migrations VALUES('001_baseline.sql',repeat('a',64));
 INSERT INTO crm_v2_clients VALUES(1,'27810000001');INSERT INTO appointment_lifecycle VALUES('27810000001');`);
 const seen=[];let fail=false;
 const client={query:async(sql,...args)=>{seen.push(sql);assert.match(sql,/^(BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY|SET LOCAL (?:statement_timeout|lock_timeout)=|SELECT|ROLLBACK)/);if(fail&&sql.startsWith('SELECT c.relname'))throw Object.assign(Error('Synthetic query failure'),{code:'SYNTHETIC_INVENTORY_FAILURE'});return db.query(sql,...args);}};
 const files=[{filename:'001_baseline.sql',checksum:'a'.repeat(64)}];
 const result=await collect(client,files,'synthetic-release');
 assert.equal(result.server.read_only,'on');assert.equal(result.clients.rows,'1');assert.equal(result.clients.null_mobiles,'0');
 assert.equal(result.lifecycle.null_phones,'0');assert.equal(result.contacts.table_name,null);
 assert.deepEqual(result.pending,[]);assert.deepEqual(result.checksumMismatches,[]);assert.deepEqual(result.ledgerRowsAbsentFromRelease,[]);
 assert.doesNotMatch(JSON.stringify(result),/27810000001/);
 assert.ok(seen.includes("SET LOCAL statement_timeout='10s'"));assert.ok(seen.includes("SET LOCAL lock_timeout='2s'"));assert.equal(seen.at(-1),'ROLLBACK');
 assert.equal((await db.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value,'off');
 fail=true;await assert.rejects(collect(client,files,'synthetic-release'),{code:'SYNTHETIC_INVENTORY_FAILURE'});assert.equal(seen.at(-1),'ROLLBACK');
 assert.equal((await db.query('SELECT COUNT(*)::int n FROM crm_v2_clients')).rows[0].n,1);
});
