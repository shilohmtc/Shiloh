const { pool } = require('../db/pool');
const logger = require('../lib/logger');

let initialized = false;

async function ensurePractitionerProfileSchema() {
  if (initialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_customer_profiles (
      staff_id BIGINT PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
      public_title TEXT,
      short_bio TEXT,
      approved_specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_approved BOOLEAN NOT NULL DEFAULT FALSE,
      approval_source TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT staff_customer_profiles_specialties_array CHECK (jsonb_typeof(approved_specialties) = 'array'),
      CONSTRAINT staff_customer_profiles_approval_check CHECK (
        (is_approved = FALSE)
        OR (approval_source IS NOT NULL AND approved_at IS NOT NULL)
      )
    )
  `);

  await pool.query(`
    INSERT INTO staff_customer_profiles
      (staff_id, public_title, short_bio, approved_specialties, is_approved, approval_source, approved_at, updated_at)
    SELECT id,
           'Massage practitioner',
           NULL,
           '[]'::jsonb,
           TRUE,
           'business_direction_2026-08-12_practitioner_titles',
           TIMESTAMPTZ '2026-08-12 11:33:00+02',
           NOW()
      FROM staff
     WHERE LOWER(display_name) IN ('christel', 'abigail')
       AND status = 'active'
       AND resource_type = 'practitioner'
    ON CONFLICT (staff_id) DO UPDATE SET
      public_title = EXCLUDED.public_title,
      is_approved = TRUE,
      approval_source = EXCLUDED.approval_source,
      approved_at = EXCLUDED.approved_at,
      updated_at = NOW()
  `);

  initialized = true;
}

function normalizeSpecialties(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

async function getClientPractitionerRows() {
  await ensurePractitionerProfileSchema();
  const result = await pool.query(`
    SELECT st.id,
           st.display_name,
           scp.public_title,
           scp.short_bio,
           scp.approved_specialties,
           COALESCE(scp.is_approved, FALSE) AS profile_approved,
           COALESCE(
             jsonb_agg(
               jsonb_build_object('id', s.id, 'name', s.name)
               ORDER BY s.display_order NULLS LAST, s.name, s.id
             ) FILTER (WHERE s.id IS NOT NULL),
             '[]'::jsonb
           ) AS active_services
      FROM staff st
      LEFT JOIN staff_customer_profiles scp ON scp.staff_id = st.id
      LEFT JOIN staff_services ss ON ss.staff_id = st.id
      LEFT JOIN services s ON s.id = ss.service_id AND s.status = 'active'
     WHERE st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     GROUP BY st.id, st.display_name, scp.public_title, scp.short_bio,
              scp.approved_specialties, scp.is_approved
     ORDER BY CASE LOWER(st.display_name)
       WHEN 'christel' THEN 1
       WHEN 'abigail' THEN 2
       ELSE 9 END,
       st.display_name,
       st.id
  `);
  return result.rows;
}

function formatPractitioner(row) {
  const services = Array.isArray(row.active_services)
    ? row.active_services.map((service) => String(service?.name || '').trim()).filter(Boolean)
    : [];
  const specialties = row.profile_approved ? normalizeSpecialties(row.approved_specialties) : [];
  const fields = [
    `Practitioner: ${row.display_name}`,
    `Active CRM-mapped services: ${services.length ? services.join(', ') : 'None currently mapped'}`,
  ];

  if (row.profile_approved) {
    fields.splice(1, 0, `Approved public title: ${row.public_title || 'No approved title supplied'}`);
    if (row.short_bio) fields.splice(2, 0, `Approved short bio: ${row.short_bio}`);
    if (specialties.length) fields.splice(3, 0, `Approved specialties: ${specialties.join(', ')}`);
  } else {
    fields.splice(1, 0, 'Public profile status: not approved. Do not infer or embellish a title, bio, qualifications, specialties, credentials, or experience.');
  }

  return fields.join(' | ');
}

async function getPractitionerKnowledge() {
  try {
    const rows = await getClientPractitionerRows();
    const content = rows.map(formatPractitioner).join('\n');
    return {
      title: 'Current client-bookable Shiloh practitioner profiles and service mappings',
      source: 'Shiloh CRM practitioner mapping',
      content: content || 'No active client-bookable practitioner records are currently available.',
      similarity: 1,
    };
  } catch (error) {
    logger.warn({ err: error }, 'Could not load authoritative practitioner knowledge for AI context');
    return null;
  }
}

module.exports = {
  ensurePractitionerProfileSchema,
  formatPractitioner,
  getClientPractitionerRows,
  getPractitionerKnowledge,
  normalizeSpecialties,
};
