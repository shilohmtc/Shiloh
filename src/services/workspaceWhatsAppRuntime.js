'use strict';
const {setTimeout:delay} = require('node:timers/promises');
const {createWorkspaceMetaProvider,createWorkspaceSmsProvider} = require('./workspaceWhatsAppProviders');
const {createWorkspaceWhatsAppAuth,validWorkspaceBudgets} = require('./workspaceWhatsAppAuth');
const {createWorkspaceWhatsAppStore} = require('./workspaceWhatsAppStore');
const {createWorkspaceWhatsAppRouter} = require('../routes/workspaceWhatsAppAuth');
const {createAuthInvitations} = require('./authInvitations');

function createWorkspaceWhatsAppWorker({service,enabled = false,pollMs = 1000,batchSize = 10} = {}) {
  let busy = false;
  const configured = () => enabled === true && service?.enabled?.() === true && Number.isInteger(pollMs) && pollMs >= 100 && pollMs <= 60000 && Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 100;
  async function runOnce({signal} = {}) {
    if (!configured()) return {ok:false,code:'WORKER_DISABLED',processed:0};
    if (busy) return {ok:false,code:'WORKER_BUSY',processed:0};
    busy = true; let processed = 0;
    try {
      while (processed < batchSize && !signal?.aborted) {
        const result = await service.dispatchOne();
        if (!result?.ok) return {ok:false,code:'WORKER_UNAVAILABLE',processed};
        if (!result.processed) break;
        processed++;
      }
      return {ok:true,processed};
    } catch (_) { return {ok:false,code:'WORKER_UNAVAILABLE',processed}; }
    finally { busy = false; }
  }
  async function run({signal} = {}) {
    // An explicit abort signal is required; constructing/importing never starts
    // timers or delivery. Operators can stop between bounded provider attempts.
    if (!signal || !configured()) return {ok:false,code:'WORKER_DISABLED'};
    while (!signal.aborted) {
      const result = await runOnce({signal});
      if (!result.ok) return result;
      try { await delay(pollMs,undefined,{signal}); } catch (_) { break; }
    }
    return {ok:true,stopped:true};
  }
  return {runOnce,run};
}

// Isolated composition only. app.js and all existing entrypoints do not import
// this module. No process.env, global fetch, default database or automatic worker.
function createWorkspaceWhatsAppRuntime({enabled = false,config = {},db,sessions,hmacKey,
  metaCredentials = {},smsCredentials = {},fetchImpl,env = {},workerOptions = {}} = {}) {
  const meta = createWorkspaceMetaProvider({enabled,reviewed:config.template,wabaId:config.wabaId,
    phoneNumberId:config.phoneNumberId,apiVersion:config.apiVersion,accessToken:metaCredentials.accessToken,fetchImpl});
  const sms = createWorkspaceSmsProvider({enabled:enabled && config.smsFallbackEnabled === true,accountEmail:smsCredentials.accountEmail,apiToken:smsCredentials.apiToken,fetchImpl});
  let ready = false;
  const configured = enabled === true && validWorkspaceBudgets(config.budgets) && typeof db?.connect === 'function' && typeof db?.query === 'function' &&
    typeof sessions?.validateSessionToken === 'function' && typeof sessions?.validateCsrfToken === 'function' &&
    Buffer.isBuffer(hmacKey) && hmacKey.length >= 32 && meta.configured() &&
    (config.smsFallbackEnabled !== true || sms.configured());
  const store = configured ? createWorkspaceWhatsAppStore({db}) : null;
  const service = createWorkspaceWhatsAppAuth({enabled:!!configured,store,hmacKey,env,
    delivery:{...meta,configured:()=>ready && meta.configured()},smsDelivery:sms,budgets:config.budgets});
  async function prepare() {
    ready = false;
    if (!configured) return {ok:false,code:'RUNTIME_UNCONFIGURED'};
    try {
      const tables = (await db.query(`SELECT to_regclass('workspace_whatsapp_dispatch') AS dispatch,
        to_regclass('workspace_whatsapp_records') AS records,to_regclass('workspace_whatsapp_rate_buckets') AS rates,
        to_regclass('staff_auth_passkey_credentials') AS credentials,
        to_regclass('code_auth_invitation_visits') AS invitations`)).rows[0];
      const constraint = (await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid='staff_browser_sessions'::regclass AND conname='staff_browser_session_auth_method_check'`)).rows[0]?.definition || '';
      ready = !!tables?.dispatch && !!tables.records && !!tables.rates && !!tables.credentials && !!tables.invitations &&
        constraint.includes("'workspace_whatsapp'") && constraint.includes("'workspace_sms'");
      return ready ? {ok:true} : {ok:false,code:'RUNTIME_SCHEMA_UNREADY'};
    } catch (_) { return {ok:false,code:'RUNTIME_SCHEMA_UNREADY'}; }
  }
  return {prepare,service,router:createWorkspaceWhatsAppRouter({service,sessions,env,enabled,
    invitations:configured ? createAuthInvitations({db,audience:'staff'}) : null}),
    worker:createWorkspaceWhatsAppWorker({service,enabled,...workerOptions})};
}
module.exports = {createWorkspaceWhatsAppRuntime,createWorkspaceWhatsAppWorker};
