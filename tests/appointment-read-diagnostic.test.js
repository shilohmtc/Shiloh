'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAppointmentId, getAppointmentReadDiagnostic } = require('../src/services/appointmentReadDiagnostic');

test('appointment read diagnostic rejects invalid IDs', () => {
  assert.throws(() => normalizeAppointmentId('not-an-id'), { code: 'INVALID_APPOINTMENT_ID' });
  assert.throws(() => normalizeAppointmentId(0), { code: 'INVALID_APPOINTMENT_ID' });
});

test('appointment read diagnostic returns sanitized lifecycle evidence and performs only reads', async () => {
  const calls = [];
  const rows = [
    [{ id: 758, status: 'scheduled', source: 'shiloh_client_whatsapp', starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-09-25T11:00:00Z', total_price: '500.00' }],
    [{ status: 'approved', requested_at: '2026-09-23T18:00:00Z', decided_at: '2026-09-23T18:05:00Z' }],
    [{ canonical_amount_due: '500.00', deposit_required_amount: '250.00', deposit_state: 'satisfied', paid_amount: '250.00', refunded_amount: '0', payment_request_count: 1, ledger_entry_count: 1 }],
    [{ status: 'sent', claimed_at: '2026-09-23T20:00:00Z', sent_at: '2026-09-23T20:01:00Z', updated_at: '2026-09-23T20:01:00Z', last_attempt_at: '2026-09-23T20:01:00Z', provider_message_recorded: true, provider_sent: true, provider_delivered: true, provider_read: false, provider_failed: false, has_last_error: false }],
  ];
  const result = await getAppointmentReadDiagnostic(758, async (sql, params) => {
    calls.push({ sql, params });
    return { rows: rows[calls.length - 1], rowCount: rows[calls.length - 1].length };
  });
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ sql }) => /^SELECT\b/i.test(sql.trim())));
  assert.deepEqual(result.payment, { canonicalAmountDue: 500, depositRequiredAmount: 250, depositState: 'satisfied', paidAmount: 250, refundedAmount: 0, paymentRequestCount: 1, ledgerEntryCount: 1 });
  assert.equal(result.confirmation.providerDelivered, true);
  assert.equal('clientName' in result, false);
  assert.equal('providerMessageId' in result.confirmation, false);
});

test('appointment read diagnostic reports missing appointments without leaking data', async () => {
  const result = await getAppointmentReadDiagnostic(999, async () => ({ rows: [], rowCount: 0 }));
  assert.deepEqual(result, { appointmentId: 999, found: false });
});
