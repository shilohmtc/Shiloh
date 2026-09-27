const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadService({ templateApproved = true, templateStatusFails = false, providerFails = false, auditFails = false } = {}) {
  const state = { status: 'pending', attemptCount: 0, lastError: null, providerCalls: 0, inAppCalls: 0, auditCalls: 0 };
  const appointment = {
    id: 759, client_id: null, crm_v2_client_id: 912, source_client_name: 'Client',
    crm_v2_client_name: 'Client', client_phone: '27820000000',
    service_name: 'Treatment', staff_name: 'Practitioner', total_price: 500,
    starts_at: '2026-10-01T08:00:00.000Z', ends_at: '2026-10-01T09:00:00.000Z',
  };
  const pool = { async query(sql, values) {
    if (sql.includes('CREATE TABLE') || sql.includes('ALTER TABLE')) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT audit_event_id,appointment_id,change_kind,status')) {
      return { rows: [{ audit_event_id: 701, appointment_id: 759, change_kind: 'time', status: state.status, attempt_count: state.attemptCount }] };
    }
    if (sql.includes('SELECT a.id,a.client_id')) return { rows: [appointment] };
    if (sql.includes('UPDATE customer_change_notifications notification')) return { rowCount: 0, rows: [] };
    if (sql.includes("SET status='sending'")) {
      if (!['pending', 'failed'].includes(state.status)) return { rowCount: 0, rows: [] };
      state.status = 'sending'; state.attemptCount++; return { rowCount: 1, rows: [{ audit_event_id: 701 }] };
    }
    if (sql.includes("SET status='sent'")) { state.status = 'sent'; state.lastError = null; return { rowCount: 1 }; }
    if (sql.includes("SET status='failed'")) { state.status = 'failed'; state.attemptCount++; state.lastError = values[1]; return { rowCount: 1 }; }
    if (sql.includes("last_error='provider_outcome_uncertain'")) { state.lastError = 'provider_outcome_uncertain'; return { rowCount: 1 }; }
    if (sql.includes("SET status='pending'")) { state.status = 'pending'; state.lastError = values[1]; return { rowCount: 1 }; }
    if (sql.includes('INSERT INTO crm_audit_events')) {
      state.auditCalls++;
      if (auditFails) throw new Error('audit write failed');
      return { rowCount: 1 };
    }
    if (sql.includes('SELECT audit_event_id') && sql.includes('LIMIT 25')) {
      const eligible = ['pending', 'failed'].includes(state.status) && state.attemptCount < values[0];
      return { rowCount: eligible ? 1 : 0, rows: eligible ? [{ audit_event_id: 701 }] : [] };
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  } };
  const originalLoad = Module._load;
  const servicePath = require.resolve('../src/services/customerChangeNotification');
  delete require.cache[servicePath];
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === servicePath) {
      if (request === '../db/pool') return { pool };
      if (request === './whatsapp') return { sendWhatsAppTemplate: async () => {
        state.providerCalls++;
        if (providerFails) throw new Error('response lost after possible acceptance');
        return { messages: [{ id: 'provider-1' }] };
      } };
      if (request === './clientFacingNameAuthority') return { resolveClientFacingName: async () => null };
      if (request === './clientLifecycleTemplateProvisioning') return {
        DEFINITIONS: {}, submitClientLifecycleTemplate: async () => ({}),
        getClientLifecycleTemplateStatus: async () => {
          if (templateStatusFails) throw new Error('template status unavailable');
          return { ok: true, templates: templateApproved
            ? [{ key: 'booking_update', provider: { status: 'APPROVED', name: 'booking_update' } }] : [] };
        },
      };
      if (request === './sh05ChannelIndependence') return { queueBookingChangeMyShilohNotification: async () => {
        state.inAppCalls++; return { queued: true };
      } };
      if (request === '../lib/logger') return { info() {}, warn() {}, error() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let service;
  try { service = require(servicePath); } finally { Module._load = originalLoad; delete require.cache[servicePath]; }
  return { service, state };
}

test('in-app booking change queues despite unapproved WhatsApp template', async () => {
  const { service, state } = loadService({ templateApproved: false });
  const outcome = await service.attemptCustomerChangeNotification(701);
  assert.equal(outcome.reason, 'template_not_approved');
  assert.equal(state.inAppCalls, 1);
  assert.equal(state.providerCalls, 0);
});

test('uncertain provider outcome stays claimed and cannot send again', async () => {
  const { service, state } = loadService({ providerFails: true });
  const outcome = await service.attemptCustomerChangeNotification(701);
  assert.equal(outcome.reason, 'provider_outcome_uncertain');
  assert.equal(state.status, 'sending');
  assert.equal(state.lastError, 'provider_outcome_uncertain');
  assert.equal(state.inAppCalls, 1);
  assert.equal((await service.flushCustomerChangeNotifications()).attempted, 0);
  assert.equal((await service.attemptCustomerChangeNotification(701)).reason, 'provider_outcome_uncertain');
  assert.equal(state.providerCalls, 1);
});

test('pre-send template status failures stop after three attempts', async () => {
  const { service, state } = loadService({ templateStatusFails: true });
  assert.equal((await service.attemptCustomerChangeNotification(701)).reason, 'provider_status_error');
  assert.equal((await service.flushCustomerChangeNotifications()).attempted, 1);
  assert.equal((await service.flushCustomerChangeNotifications()).attempted, 1);
  assert.equal(state.attemptCount, 3);
  assert.equal((await service.flushCustomerChangeNotifications()).attempted, 0);
  assert.equal(state.providerCalls, 0);
});

test('audit failure after provider acceptance does not reopen delivery', async () => {
  const { service, state } = loadService({ auditFails: true });
  assert.equal((await service.attemptCustomerChangeNotification(701)).sent, true);
  assert.equal(state.status, 'sent');
  assert.equal(state.auditCalls, 1);
  assert.equal((await service.flushCustomerChangeNotifications()).attempted, 0);
  assert.equal(state.providerCalls, 1);
});
