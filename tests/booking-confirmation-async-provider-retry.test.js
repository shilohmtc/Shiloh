const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createWhatsAppStatusEvidenceService } = require('../src/services/whatsappStatusEvidence');
const { MAX_AUTOMATIC_ASYNC_PROVIDER_ATTEMPTS } = require('../src/services/customerBookingConfirmation');
const { calendarOperationalMutationsClientScript } = require('../src/presentation/calendarOperationalMutationsUx');

test('current async booking-confirmation failure reopens canonical queue after provider acceptance', async () => {
  let call = null;
  const db = { async query(sql, params) {
    call = { sql: String(sql), params };
    return { rows: [{ appointment_id: 633, message_kind: 'booking_confirmation', status: 'failed', last_error: 'provider_async_failed' }], rowCount: 1 };
  } };
  const service = createWhatsAppStatusEvidenceService({ db, now: () => new Date('2026-09-04T12:00:00Z') });
  const result = await service.persistStatus({ metaMessageId: 'wamid.current', providerStatus: 'failed', providerTimestamp: '1788523200', providerError: { code: 131042 } });
  assert.equal(result.matched, 1);
  assert.equal(result.retryReopened, true);
  assert.equal(call.params[0], 'wamid.current');
  assert.equal(call.params[3], true);
  assert.match(call.sql, /WHERE provider_message_id=\$1/);
  assert.match(call.sql, /message_kind='booking_confirmation'/);
  assert.match(call.sql, /status='sent'/);
  assert.match(call.sql, /provider_delivered_at IS NULL/);
  assert.match(call.sql, /provider_read_at IS NULL/);
  assert.match(call.sql, /\$2::timestamptz > provider_sent_at/);
  assert.match(call.sql, /THEN NOW\(\)\+INTERVAL '5 minutes'/);
  assert.match(call.sql, /THEN 'provider_async_failed'/);
});

test('non-failed provider callbacks cannot request queue reopening', async () => {
  let params = null;
  const db = { async query(_sql, values) {
    params = values;
    return { rows: [{ appointment_id: 633, message_kind: 'booking_confirmation', status: 'sent', last_error: null }], rowCount: 1 };
  } };
  const service = createWhatsAppStatusEvidenceService({ db });
  const result = await service.persistStatus({ metaMessageId: 'wamid.current', providerStatus: 'delivered', providerTimestamp: '1788523201' });
  assert.equal(params[3], false);
  assert.equal(result.retryReopened, false);
});

test('automatic async-provider retry is capped and routed through canonical recovery semantics', () => {
  assert.equal(MAX_AUTOMATIC_ASYNC_PROVIDER_ATTEMPTS, 3);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'customerBookingConfirmation.js'), 'utf8');
  assert.match(source, /attempt_count<\$\{MAX_AUTOMATIC_ASYNC_PROVIDER_ATTEMPTS\}/);
  assert.match(source, /automaticProviderRecovery\?\{recovery:true\}:\{\}/);
  const scanner = source.slice(source.indexOf('async function flushCustomerBookingConfirmations'), source.indexOf('function startCustomerBookingConfirmationScheduler'));
  assert.match(scanner, /provider_delivered_at IS NULL/);
  assert.match(scanner, /provider_read_at IS NULL/);
  assert.match(scanner, /provider_failed_at>provider_sent_at/);
});

test('Manage Appointment checks canonical My Shiloh availability without retired delivery/recovery UI', () => {
  const script = calendarOperationalMutationsClientScript();
  assert.match(script, /data-panel-confirmation/);
  assert.match(script, /my-shiloh-availability/);
  assert.match(script, /App availability unavailable/);
  assert.doesNotMatch(script, /booking-confirmation|data-booking-confirmation-recover|Last evidence|provider_message_id|providerError|provider_error/);
});
