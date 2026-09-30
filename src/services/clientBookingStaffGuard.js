const { pool } = require('../db/pool');

function clean(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalize(value = '') {
  return clean(value).toLowerCase();
}

function clientFacingPractitionerLabel(name = '') {
  const value = clean(name);
  switch (value.toLowerCase()) {
    case 'christel': return 'Christel · Massage';
    case 'abigail': return 'Abigail · Massage';
    default: return value;
  }
}

function clientFacingPractitionerRole(name = '') {
  const value = clean(name).toLowerCase();
  if (value.startsWith('christel') || value.startsWith('abigail')) return 'Massage Practitioner';
  return 'Shiloh Practitioner';
}

async function findRequestedStaff(text) {
  const value = normalize(text);
  if (!value) return null;

  const result = await pool.query(`
    SELECT id, display_name, scheduling_type, client_bookable
      FROM staff
     WHERE status = 'active'
       AND resource_type = 'practitioner'
     ORDER BY LENGTH(display_name) DESC, display_name, id
  `);

  for (const staff of result.rows) {
    const name = normalize(staff.display_name);
    if (name && value.includes(name)) return staff;
  }

  return null;
}

async function listClientBookableStaff() {
  const result = await pool.query(`
    SELECT id, display_name
      FROM staff
     WHERE status = 'active'
       AND resource_type = 'practitioner'
       AND client_bookable = TRUE
     ORDER BY CASE LOWER(display_name)
       WHEN 'christel' THEN 1
       WHEN 'abigail' THEN 2
       ELSE 9 END,
       display_name,
       id
  `);
  return result.rows.map((row) => ({
    ...row,
    display_name: clientFacingPractitionerLabel(row.display_name),
    client_role: clientFacingPractitionerRole(row.display_name),
  }));
}

async function guardClientFreelancerBooking(text) {
  const value = normalize(text);
  if (!value) return { blocked: false };

  const bookingLanguage = /\b(book|booking|appointment|schedule|reserve|availability|available|with|therapist|practitioner)\b/i.test(value);
  if (!bookingLanguage) return { blocked: false };

  const requestedStaff = await findRequestedStaff(text);
  const genericFreelancerRequest = /\bfreelancer(s)?\b/i.test(value);

  if (requestedStaff && requestedStaff.client_bookable !== true) {
    const allowed = await listClientBookableStaff();
    const allowedNames = allowed.map((row) => row.display_name).join(', ');
    return {
      blocked: true,
      staff: requestedStaff,
      reply: requestedStaff.scheduling_type === 'freelance'
        ? `${requestedStaff.display_name} is an internal overflow freelancer and is not available for direct client bookings. Client bookings are routed only to ${allowedNames}.`
        : `${requestedStaff.display_name} is not available for direct client bookings. Client bookings are routed only to ${allowedNames}.`,
    };
  }

  if (genericFreelancerRequest) {
    const allowed = await listClientBookableStaff();
    return {
      blocked: true,
      staff: null,
      reply: `Freelance practitioners are internal overflow resources and are not available for direct client bookings. Client bookings are routed only to ${allowed.map((row) => row.display_name).join(', ')}.`,
    };
  }

  return { blocked: false, staff: requestedStaff || null };
}

module.exports = {
  clientFacingPractitionerLabel,
  clientFacingPractitionerRole,
  guardClientFreelancerBooking,
  findRequestedStaff,
  listClientBookableStaff,
};
