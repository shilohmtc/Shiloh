'use strict';
const crypto = require('node:crypto');
const { sha256, issueStaffBrowserSession } = require('./staffBrowserSession');
const { personalizedDeviceLabel } = require('./staffPasskeyAuth');

// No global pool/default connection. Only an explicitly constructed staging or
// subsequently authorized application composition can create this adapter.
function createWorkspaceWhatsAppStore({ db, randomBytes = crypto.randomBytes } = {}) {
  if (!db?.connect) throw new Error('Explicit Workspace authentication database required');
  async function transaction(fn) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // One narrow channel lock gives cross-process serialization, including
      // send completion/resends. Canonical rows are additionally locked below.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('workspace-whatsapp-auth',0))");
      async function get(kind, hash) {
        const r = await client.query('SELECT payload FROM workspace_whatsapp_records WHERE record_hash=$1 AND kind=$2 FOR UPDATE', [hash, kind]);
        return r.rows[0]?.payload || null;
      }
      async function save(kind, hash, row, insert = false) {
        if (insert) await client.query(`INSERT INTO workspace_whatsapp_records(record_hash,kind,admin_id,purpose,expires_at,payload)
          VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [hash, kind, row.adminId, row.purpose, row.expiresAt, JSON.stringify(row)]);
        else await client.query('UPDATE workspace_whatsapp_records SET payload=$3::jsonb,expires_at=$4 WHERE record_hash=$1 AND kind=$2', [hash, kind, JSON.stringify(row), row.expiresAt]);
      }
      const adminSelect = `SELECT a.*, a.active AS admin_active, s.status AS staff_status
        FROM staff_admin_accounts a LEFT JOIN staff s ON s.id=a.staff_id`;
      const tx = {
        async insertDispatch(row) {
          await client.query(`INSERT INTO workspace_whatsapp_dispatch(request_hash,expires_at,payload)
            VALUES($1,$2,$3::jsonb)`, [row.requestHash, row.expiresAt, JSON.stringify(row)]);
        },
        async claimDispatch(current,scope=null) {
          if(scope && (typeof scope.id!=='string' || !/^[A-Za-z0-9_-]{16,80}$/.test(scope.id) || typeof scope.allowLegacy!=='boolean'))throw Error('Invalid dispatch scope');
          await client.query(`DELETE FROM workspace_whatsapp_dispatch WHERE request_hash IN
            (SELECT request_hash FROM workspace_whatsapp_dispatch WHERE expires_at<=$1 ORDER BY expires_at LIMIT 100)`, [current]);
          const result = await client.query(`SELECT request_hash,payload FROM workspace_whatsapp_dispatch
            WHERE payload->>'state'='queued' AND expires_at>$1
              AND ($2::text IS NULL OR payload->>'accessScope'=$2 OR ($3::boolean AND payload->>'accessScope' IS NULL))
              AND (payload->>'notBefore' IS NULL OR (payload->>'notBefore')::timestamptz <= $1)
            ORDER BY queued_at,request_hash LIMIT 1 FOR UPDATE`, [current,scope?.id||null,scope?.allowLegacy===true]);
          const row = result.rows[0];
          if (!row) return null;
          // Never reclaim a claimed attempt. Keep encrypted input only until
          // completion, so a proven pre-send failure can permit explicit SMS.
          await client.query(`UPDATE workspace_whatsapp_dispatch SET payload=payload || '{"state":"claimed"}'::jsonb
            WHERE request_hash=$1`, [row.request_hash]);
          return row.payload;
        },
        async dispatch(hash) {
          return (await client.query('SELECT payload FROM workspace_whatsapp_dispatch WHERE request_hash=$1 FOR UPDATE',[hash])).rows[0]?.payload || null;
        },
        async saveDispatch(row) {
          await client.query('UPDATE workspace_whatsapp_dispatch SET payload=$2::jsonb,expires_at=$3 WHERE request_hash=$1',[row.requestHash,JSON.stringify(row),row.expiresAt]);
        },
        async rateUntil(key, current) {
          const row = (await client.query('SELECT expires_at FROM workspace_whatsapp_rate_buckets WHERE bucket_key=$1 AND expires_at>$2 FOR UPDATE',[key,current])).rows[0];
          return row ? new Date(row.expires_at) : null;
        },
        async hasUncertainDelivery(id, current) {
          return (await client.query(`SELECT 1 FROM workspace_whatsapp_records WHERE kind='challenge' AND admin_id=$1
            AND expires_at>$2 AND payload->>'state' IN ('dispatching','uncertain') LIMIT 1`,[id,current])).rows.length > 0;
        },
        async takeRate(buckets, current) {
          if (buckets.some(b => !Number.isSafeInteger(b.amount ?? 1) || (b.amount ?? 1) <= 0 || (b.amount ?? 1) > b.limit)) return false;
          const r = await client.query('SELECT * FROM workspace_whatsapp_rate_buckets WHERE bucket_key=ANY($1::text[]) FOR UPDATE', [buckets.map(b => b.key)]);
          const states = new Map(r.rows.map(row => [row.bucket_key, row]));
          if (buckets.some(b => { const s = states.get(b.key); return s && new Date(s.expires_at) > current && s.attempts + (b.amount ?? 1) > b.limit; })) return false;
          for (const b of buckets) {
            const s = states.get(b.key), fresh = s && new Date(s.expires_at) > current;
            await client.query(`INSERT INTO workspace_whatsapp_rate_buckets(bucket_key,attempts,expires_at) VALUES($1,$2,$3)
              ON CONFLICT(bucket_key) DO UPDATE SET attempts=$2,expires_at=$3`,
            [b.key, fresh ? s.attempts + (b.amount ?? 1) : (b.amount ?? 1), fresh ? s.expires_at : new Date(current.getTime() + b.windowMs)]);
          }
          await client.query(`DELETE FROM workspace_whatsapp_rate_buckets WHERE bucket_key IN
            (SELECT bucket_key FROM workspace_whatsapp_rate_buckets WHERE expires_at<$1 ORDER BY expires_at LIMIT 100)`, [current]);
          await client.query(`DELETE FROM workspace_whatsapp_records WHERE record_hash IN
            (SELECT record_hash FROM workspace_whatsapp_records WHERE expires_at<$1 ORDER BY expires_at LIMIT 100)`, [new Date(current.getTime() - 86400000)]);
          return true;
        },
        async adminsByMobile(mobile) { return (await client.query(`${adminSelect} WHERE a.normalized_whatsapp=$1 ORDER BY a.id LIMIT 2 FOR UPDATE OF a`, [mobile])).rows; },
        async admin(id) { return (await client.query(`${adminSelect} WHERE a.id=$1 FOR UPDATE OF a`, [id])).rows[0] || null; },
        async session(id) {
          const r = await client.query('SELECT * FROM staff_browser_sessions WHERE id=$1 FOR UPDATE', [id]);
          const s = r.rows[0];
          return s ? { ok: true, adminId: Number(s.admin_id), authMethod: s.auth_method,
            authenticatedAt: s.reauthenticated_at || s.issued_at, expiresAt: s.expires_at,
            revokedAt: s.revoked_at, recoveryRequired: s.recovery_required } : null;
        },
        async revokeChallenges(id, purpose) {
          await client.query(`UPDATE workspace_whatsapp_records SET payload=jsonb_set(payload,'{state}','"revoked"')
            WHERE kind='challenge' AND admin_id=$1 AND purpose=$2 AND payload->>'state' IN ('ready','pending','dispatching')`, [id, purpose]);
        },
        insertChallenge: row => save('challenge', row.requestHash, row, true),
        challenge: hash => get('challenge', hash),
        saveChallenge: row => save('challenge', row.requestHash, row),
        insertIntent: row => save('intent', row.hash, row, true),
        intent: hash => get('intent', hash),
        saveIntent: row => save('intent', row.hash, row),
        async ownEnrollmentWindow({adminId,sessionId,browserHash,identityRevision,accessScope,current}) {
          const r=await client.query(`SELECT expires_at FROM workspace_whatsapp_records WHERE kind='grant' AND admin_id=$1
            AND purpose='enroll' AND expires_at>$2 AND payload->>'selfSessionId'=$3
            AND payload->>'browserHash'=$4 AND payload->>'identityRevision'=$5
            AND COALESCE(payload->>'accessScope','')=$6 AND payload->>'reusable'='true'
            AND payload->>'state' IN ('issued','started') ORDER BY expires_at DESC LIMIT 1`,
          [adminId,current,String(sessionId),browserHash,identityRevision,accessScope||'']);
          return r.rows[0]?new Date(r.rows[0].expires_at):null;
        },
        grant: hash => get('grant', hash),
        saveGrant: row => save('grant', row.hash, row),
        async audit(event) {
          await client.query(`INSERT INTO staff_auth_security_events(event_type,operator_admin_id,subject_admin_id,auth_method,metadata)
            VALUES($1,$2,$3,'control',$4::jsonb)`, [event.event, event.operatorId || null, event.adminId,
            JSON.stringify({ purpose: event.purpose, at: event.at })]);
        },
        async issueSession({ admin, authMethod, current, identityRevision }) {
          const result = await issueStaffBrowserSession({ client, admin, authMethod, current, randomBytes });
          if (['workspace_whatsapp','workspace_sms'].includes(authMethod)) await client.query('UPDATE staff_browser_sessions SET detail_identity_revision=$2 WHERE id=$1', [result.sessionId, identityRevision]);
          return result;
        },
        async issuePasskeyGrant(options) {
          const grant = randomBytes(32).toString('base64url');
          await save('grant', sha256(grant), { ...options, hash: sha256(grant), state: 'issued' }, true);
          return { ok: true, grant, purpose: options.purpose };
        },
        async credentials(id) { return (await client.query('SELECT credential_id FROM staff_auth_passkey_credentials WHERE admin_id=$1 AND revoked_at IS NULL', [id])).rows; },
        async completePasskey({ admin, verified, purpose, current, deviceLabel }) {
          const duplicate = await client.query('SELECT id FROM staff_auth_passkey_credentials WHERE credential_id=$1', [verified.credentialId]);
          if (duplicate.rows.length) return { ok: false };
          const inserted = await client.query(`INSERT INTO staff_auth_passkey_credentials
            (admin_id,credential_id,public_key_spki,algorithm,sign_count,transports,backed_up,device_label)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
          [admin.id, verified.credentialId, verified.publicKeySpki, verified.algorithm, verified.signCount,
            JSON.stringify(verified.transports), verified.backedUp, personalizedDeviceLabel(admin.display_name, deviceLabel)]);
          if (purpose === 'recover') {
            await client.query(`UPDATE staff_auth_passkey_credentials SET revoked_at=$3,revoked_by_admin_id=$1
              WHERE admin_id=$1 AND id<>$2 AND revoked_at IS NULL`, [admin.id, inserted.rows[0].id, current]);
            await client.query(`UPDATE staff_browser_sessions SET revoked_at=$2,revoke_reason='device_replaced'
              WHERE admin_id=$1 AND revoked_at IS NULL`, [admin.id, current]);
            await client.query(`UPDATE workspace_whatsapp_records SET payload=jsonb_set(payload,'{state}','"revoked"')
              WHERE admin_id=$1 AND payload->>'state' NOT IN ('consumed','revoked')`, [admin.id]);
            await client.query('UPDATE staff_auth_webauthn_challenges SET consumed_at=$2 WHERE admin_id=$1 AND consumed_at IS NULL', [admin.id, current]);
            await client.query('UPDATE staff_auth_passkey_bootstraps SET revoked_at=$2 WHERE admin_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL', [admin.id, current]);
          }
          return { ...await tx.issueSession({ admin, authMethod: 'passkey', current }), credentialHint: verified.credentialId };
        },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
  }
  return { transaction };
}
module.exports = { createWorkspaceWhatsAppStore };
