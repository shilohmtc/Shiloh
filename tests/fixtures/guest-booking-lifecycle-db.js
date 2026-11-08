const fs = require('node:fs');
const { setup } = require('./guest-booking-notice-db');
async function lifecycleDb(t) {
  const db = await setup(t);
  await db.exec(`ALTER TABLE appointments ADD COLUMN ends_at TIMESTAMPTZ;
    UPDATE appointments SET ends_at=starts_at+INTERVAL '1 hour';
    CREATE TABLE appointment_lifecycle (
      id BIGSERIAL PRIMARY KEY,appointment_id BIGINT,client_id BIGINT,crm_v2_client_id BIGINT,
      client_name_snapshot TEXT,phone TEXT,service_text TEXT NOT NULL,
      appointment_at TIMESTAMPTZ NOT NULL,appointment_ends_at TIMESTAMPTZ,
      status TEXT DEFAULT 'confirmed',source TEXT,delivery_recipient_role TEXT,
      organiser_group_id BIGINT,reminder_sent_at TIMESTAMPTZ);
    CREATE UNIQUE INDEX lifecycle_appointment ON appointment_lifecycle(appointment_id) WHERE appointment_id IS NOT NULL;`);
  await db.exec(fs.readFileSync(require.resolve('../../migrations/149_my_shiloh_push_notifications.sql'), 'utf8'));
  return db;
}

module.exports = { lifecycleDb };
