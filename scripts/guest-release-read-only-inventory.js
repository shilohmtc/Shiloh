// Run only from the existing deployed Shiloh repository in an authorized Render Shell.
// Uses the existing app pool/TLS configuration. No startup or migration executor.
const fs=require('node:fs'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
async function collect(c,files,release){
 await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await c.query("SET LOCAL statement_timeout='10s'");
  await c.query("SET LOCAL lock_timeout='2s'");
  const server=(await c.query("SELECT current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only,to_regclass('public.schema_migrations')::text AS migration_table")).rows[0];
  if(server.read_only!=='on'||!server.migration_table)throw Object.assign(Error('Read-only migration authority unavailable'),{code:'INVENTORY_AUTHORITY_UNAVAILABLE'});
  const ledger=(await c.query('SELECT filename,checksum FROM public.schema_migrations ORDER BY filename')).rows;
  if(ledger.some(r=>!/^\d+_[A-Za-z0-9._-]+\.sql$/.test(r.filename)||! /^[a-f0-9]{64}$/.test(r.checksum)))throw Object.assign(Error('Invalid migration metadata'),{code:'INVENTORY_METADATA_INVALID'});
  const fileMap=new Map(files.map(r=>[r.filename,r.checksum])),ledgerMap=new Map(ledger.map(r=>[r.filename,r.checksum]));
  const sizes=(await c.query("SELECT c.relname,c.reltuples::bigint::text AS estimated_rows,pg_total_relation_size(c.oid)::text AS total_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') AND c.relname IN('crm_v2_clients','appointment_lifecycle','appointment_groups','staff_admin_accounts') ORDER BY c.relname")).rows;
  const clients=(await c.query("SELECT COUNT(*)::text AS rows,COUNT(*) FILTER(WHERE normalized_mobile IS NULL)::text AS null_mobiles,COUNT(*) FILTER(WHERE to_jsonb(c)->>'contact_mode'='organiser')::text AS organiser_roles FROM public.crm_v2_clients c")).rows[0];
  const lifecycle=(await c.query("SELECT COUNT(*)::text AS rows,COUNT(*) FILTER(WHERE phone IS NULL)::text AS null_phones,COUNT(*) FILTER(WHERE to_jsonb(a)->>'delivery_recipient_role'='organiser')::text AS organiser_roles FROM public.appointment_lifecycle a")).rows[0];
  const columns=(await c.query("SELECT c.relname,a.attname,a.attnotnull,format_type(a.atttypid,a.atttypmod) AS data_type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT a.attisdropped AND a.attnum>0 AND ((c.relname='crm_v2_clients' AND a.attname IN('normalized_mobile','contact_mode')) OR (c.relname='appointment_lifecycle' AND a.attname IN('phone','delivery_recipient_role','organiser_group_id'))) ORDER BY c.relname,a.attname")).rows;
  const constraints=(await c.query("SELECT c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('crm_v2_clients','appointment_lifecycle','appointment_group_booking_contacts') ORDER BY c.relname,k.conname")).rows;
  const indexes=(await c.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN('crm_v2_clients','appointment_lifecycle') ORDER BY tablename,indexname")).rows;
  const contacts=(await c.query("SELECT to_regclass('public.appointment_group_booking_contacts')::text AS table_name")).rows[0];
  const locks=(await c.query("SELECT relation::regclass::text AS relation,mode,granted,COUNT(*)::text AS locks FROM pg_locks WHERE pid<>pg_backend_pid() AND relation IN(to_regclass('public.crm_v2_clients'),to_regclass('public.appointment_lifecycle'),to_regclass('public.appointment_groups'),to_regclass('public.staff_admin_accounts')) GROUP BY relation,mode,granted ORDER BY relation,mode,granted")).rows;
  return {release,server,migrationFiles:files.length,ledgerRows:ledger.length,fileInventorySHA256:hash(JSON.stringify(files)),ledgerInventorySHA256:hash(JSON.stringify(ledger)),pending:files.filter(r=>!ledgerMap.has(r.filename)).map(r=>r.filename),checksumMismatches:files.filter(r=>ledgerMap.has(r.filename)&&ledgerMap.get(r.filename)!==r.checksum).map(r=>r.filename),ledgerRowsAbsentFromRelease:ledger.filter(r=>!fileMap.has(r.filename)).map(r=>r.filename),sizes,clients,lifecycle,columns,constraints,indexes,contacts,locks};
 }finally{await c.query('ROLLBACK');}
}
async function main(){let c;const {pool,closePool}=require(process.cwd()+'/src/db/pool');try{
 const files=fs.readdirSync('migrations').filter(n=>/^\d+_.+\.sql$/.test(n)).sort().map(filename=>({filename,checksum:hash(fs.readFileSync('migrations/'+filename,'utf8'))}));
 c=await pool.connect();const release=/^[a-f0-9]{40}$/.test(process.env.RENDER_GIT_COMMIT||'')?process.env.RENDER_GIT_COMMIT:'unavailable';
 console.log(JSON.stringify(await collect(c,files,release),null,2));
}catch(e){console.log(JSON.stringify({check:'FAILED',code:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'CHECK_FAILED'}));process.exitCode=1;}finally{if(c)c.release();await closePool();}}
if(require.main===module)main();
module.exports={collect};
