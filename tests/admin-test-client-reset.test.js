const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const servicePath = 'src/services/adminTestClientReset.js';

const serviceSource = fs.readFileSync(servicePath, 'utf8');

const {
  CONFIRM_ID,
  CANCEL_ID,
  CLEAN_CHOICE_ID,
  IDENTITY_CHOICE_ID,
  canResetJuvan,
  targetFromText,
  resetChoiceInteractive,
  confirmationInteractive,
  cleanupPreviewInteractive,
  resolveBoundJuvan,
  resetControlledJuvan,
} = require(`../${servicePath}`);

function compact(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function scriptedDb(handler) {
  const calls = [];
  let released = false;
  const db = {
    async query(sql, params = []) {
      const text = compact(sql);
      calls.push({ text, params });
      return handler(text, params, calls);
    },
    release() { released = true; },
  };
  return { db, calls, wasReleased: () => released };
}

const demo = {
  demo_key: 'juvan_botha',
  normalized_phone: '27760891564',
  current_client_id: 845,
  expected_display_name: 'Juvan Botha',
  active: true,
};
const juvan = { id: 845, display_name: 'Juvan Botha', status: 'active' };
const targetContact = {
  id: 9101,
  contact_type: 'whatsapp',
  normalized_value: '27760891564',
  is_primary: true,
};

function previewDb({ conflict = false, unbound = false, extraPhone = false } = {}) {
  return scriptedDb((sql) => {
    if (sql.includes('FROM controlled_demo_identities')) {
      return { rowCount: 1, rows: [{ ...demo, current_client_id: unbound ? null : 845 }] };
    }
    if (sql.includes('FROM clients') && sql.includes('WHERE id=$1')) {
      return { rowCount: 1, rows: [juvan] };
    }
    if (sql.includes('FROM client_contacts') && sql.includes('WHERE client_id=$1')) {
      const rows = extraPhone
        ? [targetContact, { ...targetContact, id: 9102, contact_type: 'mobile', normalized_value: '27820000000', is_primary: false }]
        : [targetContact];
      return { rowCount: rows.length, rows };
    }
    if (sql.includes('SELECT DISTINCT cc.client_id') && sql.includes("c.status='active'")) {
      return conflict
        ? { rowCount: 1, rows: [{ client_id: 777, display_name: 'Other Active Client' }] }
        : { rowCount: 0, rows: [] };
    }
    throw new Error(`Unexpected preview SQL: ${sql}`);
  });
}

function transactionDb({ conflict = false, residualCount = 0, policyDrift = false, outstanding = [] } = {}) {
  return scriptedDb((sql) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes('FROM controlled_demo_identities') && sql.includes('FOR UPDATE')) {
      return { rowCount: 1, rows: [demo] };
    }
    if (sql.includes('FROM clients') && sql.includes('WHERE id=$1') && sql.includes('FOR UPDATE')) {
      return { rowCount: 1, rows: [juvan] };
    }
    if (sql.includes('FROM client_contacts') && sql.includes('WHERE client_id=$1') && sql.includes('FOR UPDATE')) {
      return { rowCount: 1, rows: [targetContact] };
    }
    if (sql.includes('SELECT DISTINCT cc.client_id') && sql.includes("c.status='active'")) {
      return conflict
        ? { rowCount: 1, rows: [{ client_id: 777, display_name: 'Other Active Client' }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM client_booking_approval_policies') && sql.includes('FOR UPDATE')) {
      return {
        rowCount: 1,
        rows: [{ policy_key: 'juvan_botha_jp_booking_approval', client_id: policyDrift ? 999 : 845, approver_admin_id: 4, active: true }],
      };
    }
    if (sql.includes('FROM appointments') && sql.includes("LOWER(status) NOT IN ('cancelled','completed','no_show')")) {
      return { rowCount: outstanding.length, rows: outstanding };
    }
    if (sql.startsWith('DELETE FROM booking_intents')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('DELETE FROM client_onboarding_sessions')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('DELETE FROM booking_policy_acceptances')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('SELECT to_regclass')) return { rowCount: 1, rows: [{ table_name: sql }] };
    if (sql.startsWith('DELETE FROM conversation_sessions')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('DELETE FROM user_profiles')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('DELETE FROM client_whatsapp_welcome_deliveries')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('DELETE FROM client_contacts')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('SELECT COUNT(*)::int AS count FROM client_contacts')) {
      return { rowCount: 1, rows: [{ count: residualCount }] };
    }
    if (sql.startsWith('UPDATE clients SET status=')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('UPDATE controlled_demo_identities SET current_client_id=NULL')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('UPDATE client_booking_approval_policies SET client_id=NULL')) return { rowCount: 1, rows: [] };
    if (sql.startsWith('INSERT INTO crm_audit_events')) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected transaction SQL: ${sql}`);
  });
}

test('Juvan is the only supported reusable reset identity and old targets are retired', () => {
  assert.equal(targetFromText('Reset Juvan').mode, 'preview');
  assert.equal(targetFromText('Reset test client Juvan').mode, 'preview');
  assert.equal(targetFromText(CONFIRM_ID).mode, 'confirm');
  assert.equal(targetFromText(CANCEL_ID).mode, 'cancel');
  assert.equal(targetFromText(CLEAN_CHOICE_ID).mode, 'clean_preview');
  assert.equal(targetFromText(IDENTITY_CHOICE_ID).mode, 'identity_preview');
  assert.deepEqual(targetFromText('admin_controlled_demo_reset_preview_clean:845:0123456789abcdefabcd:2'), { mode: 'clean_preview_page', clientId: 845, digest: '0123456789abcdefabcd', page: 2 });
  assert.deepEqual(targetFromText('admin_controlled_demo_reset_confirm_clean:845:0123456789abcdefabcd'), { mode: 'clean_confirm', clientId: 845, digest: '0123456789abcdefabcd' });
  assert.equal(targetFromText('admin_test_client_reset_confirm:juvan').mode, 'confirm');
  assert.equal(targetFromText('Reset test client Chenique'), null);
  assert.equal(targetFromText('Reset test client Dummy Test'), null);
  assert.equal(targetFromText('Reset test client CRM Dummy Test'), null);
  assert.equal(targetFromText('admin_test_client_reset_confirm:dummy_test'), null);
  assert.doesNotMatch(serviceSource, /TEST_CLIENT_ALIASES|TEST_CLIENTS/);
});

test('Reset Juvan first offers exactly cleanup, identity-only, or cancel outcomes', () => {
  const interactive = resetChoiceInteractive(juvan, [targetContact]);
  assert.equal(interactive.type, 'button');
  assert.deepEqual(interactive.buttons.map((button) => button.id), [CLEAN_CHOICE_ID, IDENTITY_CHOICE_ID, CANCEL_ID]);
  assert.match(interactive.body, /Clean bookings and reset/);
  assert.match(interactive.body, /Reset identity only/);
  assert.match(interactive.body, /Cancel — change nothing/);
});

test('cleanup preview includes exact operational booking fields and requires JP confirmation only on the final page', () => {
  const resolved = { client: juvan, contacts: [targetContact] };
  const appointments = [{
    id: 901,
    status: 'confirmed',
    startsAt: '2026-08-25T08:00:00.000Z',
    endsAt: '2026-08-25T09:00:00.000Z',
    serviceName: 'Sports Massage',
    staff: [{ staffId: 1, staffName: 'Christel' }, { staffId: 2, staffName: 'Abigail' }],
    sharedCalendar: { calendarId: 'shared', eventId: 'known-event', syncStatus: 'synced' },
    retryOnly: false,
  }];
  const rendered = cleanupPreviewInteractive(resolved, appointments, 0);
  assert.equal(rendered.status, 'ready');
  assert.match(rendered.interactive.body, /CRM profile: Juvan Botha/);
  assert.match(rendered.interactive.body, /CRM ID: #845/);
  assert.match(rendered.interactive.body, /Appointment #901/);
  assert.match(rendered.interactive.body, /Status: confirmed/);
  assert.match(rendered.interactive.body, /Service: Sports Massage/);
  assert.match(rendered.interactive.body, /Practitioner: Christel \+ Abigail/);
  assert.match(rendered.interactive.body, /Calendar: Shared known-event \(synced\)/);
  assert.match(rendered.interactive.body, /Jean-Pierre: confirm only/);
  assert.match(rendered.interactive.buttons[0].id, /^admin_controlled_demo_reset_confirm_clean:845:/);
  assert.ok(rendered.interactive.body.length <= 1024);
});

test('only exact Jean-Pierre business-admin authority can reset Juvan', () => {
  assert.equal(canResetJuvan({ display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services' }), true);
  assert.equal(canResetJuvan({ display_name: 'Christel', business_role: 'owner', calendar_scope: 'all_business', service_scope: 'all_services' }), false);
  assert.equal(canResetJuvan({ display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'own_services' }), false);
});

test('preview resolves the durable current client pointer and shows the actual Juvan CRM identity', async () => {
  const { db } = previewDb();
  const preview = await resolveBoundJuvan(db);
  assert.equal(preview.status, 'ready');
  assert.equal(preview.client.id, 845);
  assert.equal(preview.client.display_name, 'Juvan Botha');
  assert.deepEqual(preview.phones, ['27760891564']);

  const interactive = confirmationInteractive(preview.client, preview.contacts);
  assert.match(interactive.body, /CRM profile: Juvan Botha/);
  assert.match(interactive.body, /CRM ID: #845/);
  assert.match(interactive.body, /WhatsApp: \+27760891564 — primary/);
  assert.match(interactive.body, /controlled demo identity will remain unbound/i);
  assert.doesNotMatch(serviceSource, /WHERE lower\(trim\(display_name\)\)/i);
});

test('preview fails closed for unbound, shared-active, or additional-phone identity drift', async () => {
  assert.equal((await resolveBoundJuvan(previewDb({ unbound: true }).db)).status, 'unbound');
  assert.equal((await resolveBoundJuvan(previewDb({ conflict: true }).db)).status, 'identity_conflict');
  assert.equal((await resolveBoundJuvan(previewDb({ extraPhone: true }).db)).status, 'identity_drift');
});

test('transaction rechecks the shared-active identity and rolls back before mutation on a race', async () => {
  const { db, calls, wasReleased } = transactionDb({ conflict: true });
  const result = await resetControlledJuvan(
    { id: 4, display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services' },
    { connect: async () => db }
  );
  assert.equal(result.status, 'identity_conflict');
  assert.ok(calls.some(({ text }) => text === 'ROLLBACK'));
  assert.equal(calls.some(({ text }) => text.startsWith('DELETE FROM client_contacts')), false);
  assert.equal(calls.some(({ text }) => text.startsWith('UPDATE controlled_demo_identities')), false);
  assert.equal(wasReleased(), true);
});

test('transaction refuses a stale Juvan approval-policy pointer', async () => {
  const { db, calls } = transactionDb({ policyDrift: true });
  const result = await resetControlledJuvan(
    { id: 4, display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services' },
    { connect: async () => db }
  );
  assert.equal(result.status, 'policy_drift');
  assert.ok(calls.some(({ text }) => text === 'ROLLBACK'));
  assert.equal(calls.some(({ text }) => text.startsWith('DELETE FROM client_contacts')), false);
});

test('residual WhatsApp/mobile binding rolls back before archive, pointer unbind, or audit', async () => {
  const { db, calls, wasReleased } = transactionDb({ residualCount: 1 });
  await assert.rejects(
    resetControlledJuvan(
      { id: 4, display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services' },
      { connect: async () => db }
    ),
    /identity release postcondition failed/
  );
  assert.ok(calls.some(({ text }) => text === 'ROLLBACK'));
  assert.equal(calls.some(({ text }) => text.startsWith('UPDATE clients SET status=')), false);
  assert.equal(calls.some(({ text }) => text.startsWith('UPDATE controlled_demo_identities')), false);
  assert.equal(calls.some(({ text }) => text.startsWith('INSERT INTO crm_audit_events')), false);
  assert.equal(wasReleased(), true);
});

test('successful reset clears bounded phone state, archives old client, unbinds pointers, and preserves history', async () => {
  const { db, calls, wasReleased } = transactionDb();
  const result = await resetControlledJuvan(
    { id: 4, display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services' },
    { connect: async () => db }
  );
  assert.equal(result.status, 'reset');
  assert.equal(result.client.id, 845);
  for (const prefix of [
    'DELETE FROM booking_intents',
    'DELETE FROM client_onboarding_sessions',
    'DELETE FROM booking_policy_acceptances',
    'DELETE FROM conversation_sessions',
    'DELETE FROM user_profiles',
    'DELETE FROM client_whatsapp_welcome_deliveries',
    'DELETE FROM client_contacts',
    'UPDATE clients SET status=',
    'UPDATE controlled_demo_identities SET current_client_id=NULL',
    'UPDATE client_booking_approval_policies SET client_id=NULL',
    'INSERT INTO crm_audit_events',
  ]) assert.ok(calls.some(({ text }) => text.startsWith(prefix)), `missing ${prefix}`);
  assert.ok(calls.some(({ text }) => text === 'COMMIT'));
  assert.equal(calls.some(({ text }) => /^DELETE FROM clients\b/.test(text)), false);
  assert.equal(calls.some(({ text }) => /^DELETE FROM appointments\b/.test(text)), false);
  assert.equal(calls.some(({ text }) => /^DELETE FROM crm_audit_events\b/.test(text)), false);

  const auditCall = calls.find(({ text }) => text.startsWith('INSERT INTO crm_audit_events'));
  const metadata = JSON.parse(auditCall.params[2]);
  assert.equal(metadata.demoKey, 'juvan_botha');
  assert.equal(metadata.preservedAppointmentHistory, true);
  assert.equal(metadata.controlledIdentityUnbound, true);
  assert.equal(metadata.clearedWelcomeDeliveries, 1);
  assert.equal(wasReleased(), true);
});

test('cleanup path adds a fail-closed outstanding-booking recheck without changing identity-only behavior', async () => {
  const admin = { id: 4, display_name: 'Jean-Pierre', business_role: 'business_admin', calendar_scope: 'all_business', service_scope: 'all_services' };
  const guarded = transactionDb({ outstanding: [{ id: 999, status: 'confirmed' }] });
  const blocked = await resetControlledJuvan(admin, { connect: async () => guarded.db }, { requireNoOperationalAppointments: true });
  assert.equal(blocked.status, 'booking_cleanup_race');
  assert.deepEqual(blocked.outstandingAppointmentIds, [999]);
  assert.equal(guarded.calls.some(({ text }) => text.startsWith('DELETE FROM client_contacts')), false);
  assert.equal(guarded.calls.some(({ text }) => text.startsWith('UPDATE controlled_demo_identities')), false);

  const identityOnly = transactionDb({ outstanding: [{ id: 999, status: 'confirmed' }] });
  const reset = await resetControlledJuvan(admin, { connect: async () => identityOnly.db });
  assert.equal(reset.status, 'reset');
  assert.equal(identityOnly.calls.some(({ text }) => text.includes('FROM appointments')), false);
});
