const test = require('node:test');
const assert = require('node:assert/strict');

const {
  claimDueReminder,
  deliverClaimedReminder,
} = require('../src/services/appointmentLifecycle');

test('reminder claim uses the canonical booking time and repairs a stale lifecycle snapshot', async () => {
  const claimed = {
    id: 17,
    appointment_id: 501,
    phone: '27830000000',
    client_name_snapshot: 'Marinda',
    service_text: 'Manicure',
    appointment_at: '2026-09-17T08:30:00.000Z',
    appointment_ends_at: '2026-09-17T09:30:00.000Z',
  };
  let claimSql = '';
  const db = {
    async query(sql) {
      claimSql = String(sql);
      return { rows: [claimed] };
    },
  };

  const appointment = await claimDueReminder(db);
  assert.equal(appointment, claimed);
  assert.match(claimSql, /LEFT JOIN appointments ap ON ap\.id=al\.appointment_id/);
  assert.match(claimSql, /COALESCE\(ap\.starts_at,al\.appointment_at\)/);
  assert.match(claimSql, /ap\.status IN \('scheduled','confirmed'\)/);
  assert.match(claimSql, /appointment_at=due\.effective_start/);
  assert.match(claimSql, /appointment_ends_at=due\.effective_end/);

  let providerArgs;
  await deliverClaimedReminder(appointment, 'reminder_template', 'actions_template', {
    send: async (...args) => { providerArgs = args; return { messages: [{ id: 'wamid.test' }] }; },
  });
  assert.equal(providerArgs[2][0], 'Marinda');
  assert.equal(providerArgs[2][1], 'Manicure');
  assert.match(providerArgs[2][3], /10:30/);
});
