const { pool } = require('../db/pool');

const TZ = 'Africa/Johannesburg';

function fmtTime(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function fmtDate(value) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

async function appointmentTemplateContext(phone, appointmentId) {
  if (!appointmentId) return null;
  const normalized = String(phone || '').replace(/[^0-9]/g, '');
  const result = await pool.query(`
    SELECT a.id, a.starts_at,
           COALESCE(v2.name,c.display_name, a.source_client_name, 'there') AS client_name,
           COALESCE((SELECT string_agg(service_name_snapshot, ' + ' ORDER BY position)
                     FROM appointment_services WHERE appointment_id=a.id), a.title, 'Shiloh appointment') AS service_name,
           COALESCE((SELECT string_agg(staff_name_snapshot, ' + ' ORDER BY position)
                     FROM appointment_staff WHERE appointment_id=a.id), 'Shiloh practitioner') AS staff_name
      FROM appointments a
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN client_contacts cc ON cc.client_id=c.id
      LEFT JOIN crm_v2_clients v2 ON v2.id=a.crm_v2_client_id AND v2.status='active'
     WHERE a.id=$2
       AND ((a.client_id IS NOT NULL AND a.crm_v2_client_id IS NULL AND cc.normalized_value=$1)
            OR (a.client_id IS NULL AND a.crm_v2_client_id IS NOT NULL AND v2.normalized_mobile=$1))
     ORDER BY cc.is_primary DESC NULLS LAST, cc.id
     LIMIT 1`, [normalized, Number(appointmentId)]);
  return result.rows[0] || null;
}

async function decorateAppointmentChangeTemplate(phone, priorIntent, result) {
  // Retired transport: do not consult templates or their booking context.
  return result;
}


module.exports = {
  appointmentTemplateContext,
  decorateAppointmentChangeTemplate,
  fmtDate,
  fmtTime,
};
