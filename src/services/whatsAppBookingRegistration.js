'use strict';

const { createHash, createHmac } = require('node:crypto');
const { PostgresCrmV2ClientRepository } = require('../repositories/crmV2ClientRepository');
const {
  createCrmV2ClientService,
  normalizeDateOfBirth,
  normalizeGender,
  normalizeName,
} = require('./crmV2ClientService');
const { verifiedWhatsAppBookingOwner } = require('./whatsAppBookingContinuation');
const { verifiedWhatsAppMessages } = require('./whatsAppBookingActions');

const TTL_SECONDS = 15 * 60;
const FIELDS = ['first_name', 'surname', 'date_of_birth', 'gender'];
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID = /^wamid\.[A-Za-z0-9+/_=-]{1,240}$/;
const digest = (value) => createHash('sha256').update(value).digest('hex');

function parseRegistration(response) {
  if (typeof response !== 'string' || Buffer.byteLength(response) > 8192) return null;
  try {
    const value = JSON.parse(response);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== FIELDS.length + 1 ||
      typeof value.flow_token !== 'string' ||
      !TOKEN.test(value.flow_token) ||
      FIELDS.some((field) => typeof value[field] !== 'string')
    )
      return null;
    const firstName = normalizeName(value.first_name);
    const surname = normalizeName(value.surname);
    if (!firstName || !surname || !normalizeName(firstName + ' ' + surname)) return null;
    return {
      flowToken: value.flow_token,
      firstName,
      surname,
      dateOfBirth: normalizeDateOfBirth(value.date_of_birth, { required: true }),
      gender: normalizeGender(value.gender, { required: true }),
    };
  } catch {
    return null;
  }
}

async function classify(db, mobile) {
  const { rows } = await db.query(
    'SELECT id FROM crm_v2_clients WHERE normalized_mobile=$1 ORDER BY id LIMIT 2',
    [mobile],
  );
  if (rows.length === 1 && (await verifiedWhatsAppBookingOwner(db, mobile, rows[0].id))) {
    return { next: 'menu', clientId: String(rows[0].id) };
  }
  if (rows.length) return { next: 'reception' };
  const historical = await db.query(
    "SELECT 1 FROM client_contacts WHERE normalized_value=$1 AND lower(contact_type) IN ('phone','telephone','mobile','whatsapp') LIMIT 1",
    [mobile],
  );
  return { next: historical.rows.length ? 'reception' : 'register' };
}

function createWhatsAppBookingRegistration({ db, key, flowId, chat, clock = Date.now }) {
  if (!db?.connect || !Buffer.isBuffer(key) || key.length !== 32 || !/^[0-9]{1,30}$/.test(flowId)) {
    throw new TypeError('WhatsApp registration requires a database and a draft Flow');
  }
  const mac = (purpose, value, encoding) =>
    createHmac('sha256', key)
      .update(purpose + ':' + value)
      .digest(encoding);
  const now = () => Math.floor(clock() / 1000);
  const invitationToken = (reply) =>
    mac('flow', reply.recipient + ':' + reply.deduplicationKey, 'base64url');

  async function start(reply, { deliverBookingMenu, deliverReceptionPrompt, deliverRegistration }) {
    const expires = reply.sentAt + TTL_SECONDS;
    if (!Number.isInteger(reply.sentAt) || expires <= now() || reply.sentAt > now()) return;
    const flowToken = invitationToken(reply);
    const tokenDigest = digest(flowToken);
    const {
      rows: [existing],
    } = await db.query(
      'SELECT completion_digest FROM whatsapp_booking_registration_grants WHERE token_digest=$1',
      [tokenDigest],
    );
    if (existing?.completion_digest) return;
    const state = existing ? { next: 'register' } : await classify(db, reply.recipient);
    if (state.next === 'menu') {
      await chat.startVerified(
        {
          recipient: reply.recipient,
          inboundId: reply.inboundId,
          expires,
          crmV2ClientId: state.clientId,
        },
        deliverBookingMenu,
      );
    } else if (state.next === 'reception') {
      await deliverReceptionPrompt(reply);
    } else {
      await db.query(
        'DELETE FROM whatsapp_booking_registration_grants WHERE token_digest IN (SELECT token_digest FROM whatsapp_booking_registration_grants WHERE expires_at <= $1 LIMIT 100)',
        [new Date(clock())],
      );
      await db.query(
        'INSERT INTO whatsapp_booking_registration_grants(token_digest,recipient_digest,expires_at) VALUES($1,$2,$3) ON CONFLICT(token_digest) DO NOTHING',
        [tokenDigest, mac('sender', reply.recipient, 'hex'), new Date(expires * 1000)],
      );
      await deliverRegistration({
        recipient: reply.recipient,
        deduplicationKey: reply.deduplicationKey,
        flowToken,
        expiresAt: new Date(expires * 1000).toISOString(),
      });
    }
  }

  function flowMessage({ flowToken, recipient, deduplicationKey }) {
    if (
      typeof flowToken !== 'string' ||
      !TOKEN.test(flowToken) ||
      flowToken !== invitationToken({ recipient, deduplicationKey })
    )
      return null;
    return {
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: 'Create your Shiloh profile to request an appointment.' },
        action: {
          name: 'flow',
          parameters: {
            mode: 'draft',
            flow_message_version: '3',
            flow_id: flowId,
            flow_token: flowToken,
            flow_cta: 'Create profile',
            flow_action: 'navigate',
            flow_action_payload: { screen: 'REGISTER' },
          },
        },
      },
    };
  }

  async function commit({ message, profile }) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const tokenDigest = digest(profile.flowToken);
      const completion = mac('completion', message.id, 'hex');
      const {
        rows: [grant],
      } = await c.query(
        'SELECT expires_at,completion_digest,completed_client_id FROM whatsapp_booking_registration_grants WHERE token_digest=$1 AND recipient_digest=$2 AND expires_at>$3 FOR UPDATE',
        [tokenDigest, mac('sender', message.from, 'hex'), new Date(clock())],
      );
      let id = null;
      if (grant?.completion_digest === completion) {
        id = String(grant.completed_client_id);
      } else if (grant && !grant.completion_digest) {
        const repository = new PostgresCrmV2ClientRepository(c);
        await repository.lockNormalizedMobile(message.from);
        // The canonical historical-contact writer does not take the mobile advisory lock.
        await c.query("SET LOCAL lock_timeout = '1500ms'");
        await c.query('LOCK TABLE client_contacts IN SHARE MODE');
        if ((await classify(c, message.from)).next === 'register') {
          const save = await createCrmV2ClientService({ repository }).registerWhatsAppClient({
            senderMobile: message.from,
            name: profile.firstName + ' ' + profile.surname,
            dateOfBirth: profile.dateOfBirth,
            gender: profile.gender,
            occurredAt: new Date(clock()),
          });
          if (save.status !== 'created') throw new Error('WhatsApp registration conflicted');
          id = String(save.client.id);
          await c.query('UPDATE crm_v2_clients SET first_name=$2,surname=$3 WHERE id=$1', [
            id,
            profile.firstName,
            profile.surname,
          ]);
          await c.query(
            'UPDATE whatsapp_booking_registration_grants SET completion_digest=$2,completed_client_id=$3 WHERE token_digest=$1',
            [tokenDigest, completion, id],
          );
        }
      }
      await c.query('COMMIT');
      return id && { id, expires: Math.floor(new Date(grant.expires_at).getTime() / 1000) };
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  }

  async function receive(raw, signature, configuration, deliverBookingMenu) {
    const seen = new Set();
    for (const message of verifiedWhatsAppMessages(raw, signature, configuration)) {
      const sentAt = Number(message.timestamp);
      if (
        message.type !== 'interactive' ||
        message.interactive?.type !== 'nfm_reply' ||
        typeof message.id !== 'string' ||
        !MESSAGE_ID.test(message.id) ||
        seen.has(message.id) ||
        typeof message.timestamp !== 'string' ||
        !/^\d{10}$/.test(message.timestamp) ||
        sentAt > now() ||
        sentAt + TTL_SECONDS <= now()
      )
        continue;
      const profile = parseRegistration(message.interactive.nfm_reply?.response_json);
      if (!profile) continue;
      seen.add(message.id);
      const completed = await commit({ message, profile });
      if (completed)
        await chat.startVerified(
          {
            recipient: message.from,
            inboundId: message.id,
            expires: completed.expires,
            crmV2ClientId: completed.id,
          },
          deliverBookingMenu,
        );
    }
  }

  return { start, receive, flowMessage };
}

module.exports = { createWhatsAppBookingRegistration };
