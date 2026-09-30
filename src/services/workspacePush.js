'use strict';

const dns = require('node:dns').promises;
const { pool } = require('../db/pool');
const logger = require('../lib/logger');
const { resolveCalendarAuthority } = require('./calendarAuthorization');
const { isDerivedGlobalCoordinator } = require('./workspaceBookingRequestRouting');
const { validEndpoint, parseVapid, vapidAuthorization, safePushRequest, boundedPushTimeoutMs } = require('./myShilohPush');

function createWorkspacePushService({ db=pool, env=process.env, send=safePushRequest, resolveHost=(...args)=>dns.lookup(...args) }={}) {
  async function permitted(adminId) {
    const id=Number(adminId);
    if (!Number.isSafeInteger(id)||id<=0) return false;
    return isDerivedGlobalCoordinator(await resolveCalendarAuthority(db,id));
  }
  function config() {
    try { const key=parseVapid(env); return { configured:Boolean(key),publicKey:key?.publicKey||null }; }
    catch (_error) { return { configured:false,publicKey:null }; }
  }
  async function subscribe({adminId,endpoint,p256dh,auth}) {
    if (!await permitted(adminId)) return { enabled:false };
    const target=validEndpoint(endpoint);
    if (!target||!config().configured||!/^[-_A-Za-z0-9]{20,256}$/.test(String(p256dh||''))||!/^[-_A-Za-z0-9]{8,128}$/.test(String(auth||''))) throw new Error('Invalid Workspace notification subscription');
    await db.query(`INSERT INTO workspace_push_subscriptions(admin_id,endpoint,p256dh,auth,enabled,last_notification_id,updated_at)
      VALUES($1,$2,$3,$4,TRUE,COALESCE((SELECT MAX(id) FROM workspace_push_notifications WHERE admin_id=$1),0),NOW())
      ON CONFLICT(endpoint) DO UPDATE SET admin_id=$1,p256dh=$3,auth=$4,enabled=TRUE,
      last_notification_id=COALESCE((SELECT MAX(id) FROM workspace_push_notifications WHERE admin_id=$1),0),updated_at=NOW()`,[Number(adminId),target,p256dh,auth]);
    return { enabled:true };
  }
  async function unsubscribe({adminId,endpoint}) {
    const target=validEndpoint(endpoint);
    if (target) await db.query(`UPDATE workspace_push_subscriptions SET enabled=FALSE,updated_at=NOW() WHERE admin_id=$1 AND endpoint=$2`,[Number(adminId),target]);
    return { enabled:false };
  }
  async function pending({adminId,endpoint}) {
    if (!await permitted(adminId)) return { count:0 };
    const target=validEndpoint(endpoint);
    if (!target) return { count:0 };
    const rows=await db.query(`SELECT id,last_notification_id FROM workspace_push_subscriptions WHERE admin_id=$1 AND endpoint=$2 AND enabled=TRUE LIMIT 1`,[Number(adminId),target]);
    if (!rows.rowCount) return { count:0 };
    const sub=rows.rows[0];
    const events=await db.query(`SELECT id FROM workspace_push_notifications WHERE admin_id=$1 AND id>$2 AND created_at>NOW()-INTERVAL '7 days' ORDER BY id LIMIT 5`,[Number(adminId),Number(sub.last_notification_id)]);
    if (events.rowCount) await db.query(`UPDATE workspace_push_subscriptions SET last_notification_id=GREATEST(last_notification_id,$2) WHERE id=$1`,[sub.id,events.rows.at(-1).id]);
    return { count:events.rowCount };
  }
  async function queue(eventKey, { adminIds = null } = {}) {
    const result = { queued: 0, accepted: 0, failed: 0 };
    const allowed = adminIds === null ? null : new Set(adminIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
    if (!/^(planning|handoff|booking_request):[1-9]\d*$/.test(String(eventKey||''))) return result;
    const vapid=parseVapid(env);
    if (!vapid) return result;
    const subscriptions=await db.query(`SELECT id,admin_id,endpoint FROM workspace_push_subscriptions WHERE enabled=TRUE ORDER BY id LIMIT 100`);
    const recipients=new Map();
    for (const sub of subscriptions.rows) {
      const adminId=Number(sub.admin_id);
      if (allowed && !allowed.has(adminId)) continue;
      if (!recipients.has(adminId)) {
        if (!await permitted(adminId)) { recipients.set(adminId,false); continue; }
        const inserted=await db.query(`INSERT INTO workspace_push_notifications(admin_id,event_key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id`,[adminId,eventKey]);
        recipients.set(adminId,inserted.rowCount>0);
        if (inserted.rowCount > 0) result.queued += 1;
      }
      if (!recipients.get(adminId)) continue;
      try {
        const response=await send(sub.endpoint,{headers:{ Authorization:vapidAuthorization(sub.endpoint,vapid), TTL:'300', Urgency:'normal' },resolveHost,timeoutMs:boundedPushTimeoutMs(env)});
        const gone=response.status===404||response.status===410;
        if (response.ok) result.accepted += 1; else result.failed += 1;
        await db.query(`UPDATE workspace_push_subscriptions SET last_push_status=$2,enabled=CASE WHEN $3 THEN FALSE ELSE enabled END,updated_at=NOW() WHERE id=$1`,[sub.id,response.ok?'accepted':`rejected_${response.status}`,gone]);
      } catch (error) { result.failed += 1; logger.warn({ err:error, subscriptionId:sub.id },'Workspace push wake failed'); }
    }
    return result;
  }
  return { permitted,config,subscribe,unsubscribe,pending,queue };
}

const defaultService=createWorkspacePushService();
async function queueWorkspaceAlert(key) {
  try { await defaultService.queue(key); } catch (error) { logger.warn({err:error},'Workspace push alert unavailable'); }
}
module.exports={ createWorkspacePushService,queueWorkspaceAlert };
