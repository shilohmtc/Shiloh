const { pool } = require('../db/pool');
const { processBookingMessage } = require('./bookingIntent');
const { decorateClientBookingResult } = require('./clientBookingInteractive');
const { presentTreatmentRow, treatmentPageNavigationRow } = require('../presentation/clientTreatmentListPresentation');

const FAMILY_PAGE_SIZE = 9;
const FAMILY_RULES = Object.freeze({
  beauty: { title: 'Beauty & Aesthetics', practitioner: null },
  massage: { title: 'Massage', practitioner: null },
  lymphatic: { title: 'Lymphatic Drainage', practitioner: 'Abigail' },
  pedicure: { title: 'Elim MediHeel Pedicures', practitioner: 'Christel' },
});

function clean(value = '') { return String(value || '').trim().replace(/\s+/g, ' '); }
function short(value = '') { const text = clean(value); return text.length <= 24 ? text : `${text.slice(0, 21)}…`; }

function familyCommandForNaturalText(text = '') {
  const value = clean(text).toLowerCase().replace(/[.!?]+$/g, '');
  if (/^lymphatic(?:\s+drainage)?(?:\s+(?:treatments?|services?))?$/.test(value)) return 'client_family_lymphatic';
  if (/^(?:beauty\s*(?:&|and)\s*aesthetics|beauty)(?:\s+(?:treatments?|services?))?$/.test(value)) return 'client_family_beauty';
  if (/^massage(?:\s+(?:treatments?|services?))?$/.test(value)) return 'client_family_massage';
  if (/^(?:elim\s+)?mediheel(?:\s+pedicures?)?(?:\s+(?:treatments?|services?))?$/.test(value)) return 'client_family_pedicure';
  if (/^elim\s+mediheel\s+pedicures?(?:\s+(?:treatments?|services?))?$/.test(value)) return 'client_family_pedicure';
  return null;
}

function familyFilterSql(family) {
  if (family === 'beauty') {
    return `st.business_role = 'tenant_practitioner'
      AND LOWER(COALESCE(sc.name, '')) <> 'massage'
      AND LOWER(s.name) NOT LIKE '%lymphatic%'
      AND LOWER(s.name) NOT LIKE '%pedicur%'
      AND LOWER(s.name) NOT LIKE '%mediheel%'
      AND LOWER(s.name) NOT LIKE '%elim%'`;
  }
  if (family === 'massage') {
    return `LOWER(COALESCE(sc.name, '')) = 'massage'
      AND LOWER(s.name) NOT LIKE '%lymphatic%'
      AND LOWER(st.display_name) IN ('christel', 'abigail')`;
  }
  if (family === 'lymphatic') {
    return `LOWER(s.name) LIKE '%lymphatic%'
      AND LOWER(st.display_name) = 'abigail'`;
  }
  if (family === 'pedicure') {
    return `LOWER(st.display_name) = 'christel'
      AND (
        LOWER(s.name) LIKE '%medi-heel%'
        OR LOWER(s.name) LIKE '%mediheel%'
        OR LOWER(s.name) LIKE '%elim%'
      )`;
  }
  return null;
}

async function listFamilyServices(family) {
  const filter = familyFilterSql(family);
  if (!filter) return [];
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name, s.duration_minutes, s.processing_time_minutes,
           s.extra_time_minutes, s.price, s.display_price, s.display_order
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
       AND ${filter}
     ORDER BY s.display_order NULLS LAST, s.name, s.id
  `);
  return result.rows;
}

async function findFamilyService(family, serviceId) {
  const filter = familyFilterSql(family);
  if (!filter) return null;
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.id = $1
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
       AND ${filter}
     LIMIT 1
  `, [Number(serviceId)]);
  return result.rows[0] || null;
}

async function listFamilyEligiblePractitioners(family, serviceId) {
  const names = family === 'massage' ? ['christel', 'abigail'] : family === 'pedicure' ? ['christel'] : family === 'lymphatic' ? ['abigail'] : [];
  if (!names.length && family !== 'beauty') return [];
  const result = await pool.query(`
    SELECT st.id, st.display_name
      FROM staff st
      JOIN staff_services ss ON ss.staff_id = st.id
      JOIN services s ON s.id = ss.service_id
     WHERE s.id = $1
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
       AND ${family === 'beauty' ? "st.business_role = 'tenant_practitioner'" : 'LOWER(st.display_name) = ANY($2::text[])'}
     GROUP BY st.id, st.display_name
     ORDER BY CASE LOWER(st.display_name) WHEN 'christel' THEN 1 WHEN 'abigail' THEN 2 ELSE 9 END,
              st.display_name, st.id
  `, [Number(serviceId), names]);
  return result.rows;
}

function familyServicesInteractive(family, rows = [], page = 1) {
  const config = FAMILY_RULES[family];
  const totalPages = Math.max(1, Math.ceil(rows.length / FAMILY_PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * FAMILY_PAGE_SIZE;
  const pageRows = rows.slice(start, start + FAMILY_PAGE_SIZE).map((row) =>
    presentTreatmentRow(row, `client_family_${family}_service_${row.id}`)
  );
  if (safePage < totalPages) {
    pageRows.push(treatmentPageNavigationRow(`client_family_${family}_page_${safePage + 1}`, safePage + 1, totalPages));
  } else if (safePage > 1) {
    pageRows.push({ id: `client_family_${family}_page_1`, title: '← First page', description: `Return to page 1 of ${totalPages}` });
  }
  const owner = config.practitioner ? ` • ${config.practitioner}` : family === 'massage' ? ' • Christel or Abigail' : '';
  return {
    type: 'list',
    body: `*${config.title}${owner}*\nChoose an active treatment. Shiloh will only offer practitioners currently eligible in CRM.`,
    buttonText: 'Treatments',
    rows: pageRows,
    sectionTitle: config.title,
  };
}

function massagePractitionersInteractive(service, staff) {
  const rows = [
    { id: 'client_practitioner_any', title: 'Any available', description: 'Christel or Abigail, based on availability' },
    ...staff.map((row) => ({ id: `client_practitioner_${row.id}`, title: short(row.display_name), description: `Eligible for ${short(service.name)}`.slice(0, 72) })),
  ].slice(0, 10);
  return {
    type: 'list',
    body: `*${service.name}*\nChoose Christel, Abigail, or Any available where both are currently eligible.`,
    buttonText: 'Practitioner',
    rows,
    sectionTitle: 'Massage practitioner',
  };
}

async function processClientServiceFamilyMessage(sender, text) {
  const value = familyCommandForNaturalText(text) || clean(text).toLowerCase();
  const familyMatch = value.match(/^client_family_(beauty|massage|lymphatic|pedicure)$/);
  if (familyMatch) {
    const family = familyMatch[1];
    const services = await listFamilyServices(family);
    if (!services.length) return { handled: true, reply: `I can’t safely find any active ${FAMILY_RULES[family].title} treatments in Shiloh CRM right now. Please choose another service family or contact the clinic.` };
    return { handled: true, interactive: familyServicesInteractive(family, services, 1) };
  }

  const pageMatch = value.match(/^client_family_(beauty|massage|lymphatic|pedicure)_page_(\d+)$/);
  if (pageMatch) {
    const family = pageMatch[1];
    const services = await listFamilyServices(family);
    if (!services.length) return { handled: true, reply: `No active ${FAMILY_RULES[family].title} treatments are available right now.` };
    return { handled: true, interactive: familyServicesInteractive(family, services, Number(pageMatch[2])) };
  }

  const serviceMatch = value.match(/^client_family_(beauty|massage|lymphatic|pedicure)_service_(\d+)$/);
  if (!serviceMatch) return { handled: false };
  const family = serviceMatch[1];
  const service = await findFamilyService(family, serviceMatch[2]);
  if (!service) return { handled: true, reply: 'That treatment is no longer available in this service family. Please reopen the booking menu to refresh the current CRM options.' };

  const staff = await listFamilyEligiblePractitioners(family, service.id);
  if (!staff.length) return { handled: true, reply: 'No eligible client-bookable practitioner is currently mapped to that treatment. Nothing has been booked.' };

  const staged = await processBookingMessage(sender, `Book ${service.name}`);
  if (family === 'massage' && staff.length > 1) {
    return { handled: true, intent: staged.intent, interactive: massagePractitionersInteractive(service, staff) };
  }

  const chosen = staff[0];
  return decorateClientBookingResult(await processBookingMessage(sender, `booking with ${chosen.display_name}`));
}

module.exports = {
  FAMILY_PAGE_SIZE,
  FAMILY_RULES,
  familyCommandForNaturalText,
  familyFilterSql,
  familyServicesInteractive,
  listFamilyEligiblePractitioners,
  listFamilyServices,
  massagePractitionersInteractive,
  processClientServiceFamilyMessage,
};
