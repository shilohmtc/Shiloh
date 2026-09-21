const { pool } = require('../db/pool');
const { formatPrice, formatDuration } = require('./serviceCatalogue');
const { listClientBookableStaff } = require('./clientBookingStaffGuard');
const { processBookingMessage, getIntent, clearIntent } = require('./bookingIntent');
const { bookingDiscoveryInteractive, decorateClientBookingResult } = require('./clientBookingInteractive');
const { compactListTitle, fullLabelDescription } = require('../presentation/whatsappListRowPresentation');
const { publicServiceNameFor } = require('./publicPresentation');
const {
  MY_SHILOH_WELCOME_VOUCHER_URL,
  clientHomeInteractive,
  welcomeVoucherReply,
} = require('../presentation/whatsappClientMenu');

const SERVICE_PAGE_SIZE = 9;
const CATEGORY_PAGE_SIZE = 9;
const SQT_CLIENT_CATEGORY_ID = 'sqt_biomicroneedling';
const SQT_CLIENT_CATEGORY_NAME = 'SQT BioMicroneedling';

function clean(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isGreeting(text = '') {
  return /^(hi|hello|hey|howzit|hiya|good morning|good afternoon|good evening)[!. ]*$/i.test(clean(text));
}

function isHomeCommand(text = '') {
  const value = clean(text).toLowerCase();
  return isGreeting(text) || ['menu', 'home', 'back', 'client menu', 'main menu'].includes(value);
}

function welcomeVoucherRequestedService(text = '') {
  const match = clean(text).match(/\bi(?:'d| would) like to book\s+(.+?)(?:(?:[.!?]\s+I also want to)|(?:\s+and))\s+use my R100 My Shiloh welcome voucher\b/i);
  return match?.[1] ? clean(match[1]).replace(/[.!?]+$/, '') : null;
}

function comparableServiceName(value = '') {
  return clean(value).normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function selectClientBookableServiceByName(rows = [], requestedName = '') {
  const requested = comparableServiceName(requestedName);
  if (!requested) return null;
  const matches = rows.filter((row) => [row.name, publicServiceNameFor(row.name)].some((name) => comparableServiceName(name) === requested));
  return matches.length === 1 ? matches[0] : null;
}

async function findClientBookableServiceByName(requestedName) {
  return selectClientBookableServiceByName(await listClientBookableServices(), requestedName);
}

async function selectedServicePractitioners(sender, requestedName) {
  const service = await findClientBookableServiceByName(requestedName);
  if (!service) {
    return { handled: true, reply: 'That treatment is no longer available for direct client booking. Choose another treatment from Shiloh’s current list.' };
  }
  const staged = await processBookingMessage(sender, `Book ${service.name}`);
  const eligible = await listEligiblePractitionersForService(service.id);
  if (!eligible.length) {
    return { handled: true, reply: 'No client-bookable practitioner is currently mapped to that treatment. Nothing has been booked.' };
  }
  return {
    handled: true,
    intent: staged.intent,
    interactive: eligiblePractitionersInteractive({ ...service, name: publicServiceNameFor(service.name) }, eligible),
  };
}

function isSqtBioMicroneedlingCategory(name = '') {
  return /^\d+\.\s*SQT BioMicroneedling$/i.test(clean(name));
}

function categoryPriority(name = '') {
  const value = clean(name).toLowerCase();
  if (value === 'massage') return 0;
  if (value === 'pedicures & foot care') return 1;
  return 2;
}

function groupClientCategories(rows = []) {
  const grouped = [];
  let sqtCount = 0;

  for (const row of rows) {
    if (isSqtBioMicroneedlingCategory(row.name)) {
      sqtCount += Number(row.service_count) || 0;
      continue;
    }
    grouped.push(row);
  }

  if (sqtCount > 0) {
    grouped.push({
      id: SQT_CLIENT_CATEGORY_ID,
      name: SQT_CLIENT_CATEGORY_NAME,
      display_order: null,
      service_count: sqtCount,
    });
  }

  return grouped.sort((a, b) => {
    const priorityDiff = categoryPriority(a.name) - categoryPriority(b.name);
    if (priorityDiff) return priorityDiff;
    const nameDiff = clean(a.name).toLowerCase().localeCompare(clean(b.name).toLowerCase());
    if (nameDiff) return nameDiff;
    return String(a.id).localeCompare(String(b.id));
  });
}

async function listClientBookableCategories() {
  const result = await pool.query(`
    SELECT COALESCE(sc.id, 0) AS id,
           COALESCE(sc.name, 'Services') AS name,
           sc.display_order,
           COUNT(DISTINCT s.id)::int AS service_count
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     GROUP BY COALESCE(sc.id, 0), COALESCE(sc.name, 'Services'), sc.display_order
     ORDER BY CASE LOWER(COALESCE(sc.name, 'Services'))
                WHEN 'massage' THEN 0
                WHEN 'pedicures & foot care' THEN 1
                ELSE 2
              END,
              LOWER(COALESCE(sc.name, 'Services')),
              COALESCE(sc.id, 0)
  `);
  return groupClientCategories(result.rows);
}

async function listClientBookableServices() {
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name, s.duration_minutes, s.processing_time_minutes,
           s.extra_time_minutes, s.price, s.display_price,
           COALESCE(sc.id, 0) AS category_id,
           COALESCE(sc.name, 'Services') AS category_name,
           sc.display_order AS category_order, s.display_order
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     ORDER BY category_order NULLS LAST, s.display_order NULLS LAST, s.name, s.id
  `);
  return result.rows;
}

async function listServicesForCategory(categoryId) {
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name, s.duration_minutes, s.processing_time_minutes,
           s.extra_time_minutes, s.price, s.display_price,
           COALESCE(sc.id, 0) AS category_id,
           COALESCE(sc.name, 'Services') AS category_name,
           sc.display_order AS category_order, s.display_order
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE COALESCE(sc.id, 0) = $1
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     ORDER BY s.display_order NULLS LAST, s.name, s.id
  `, [Number(categoryId)]);
  return result.rows;
}

async function listSqtBioMicroneedlingServices() {
  const result = await pool.query(`
    SELECT DISTINCT s.id,
           REGEXP_REPLACE(s.name, '^[[:space:]]*[0-9]+[.][[:space:]]*', '') AS name,
           s.duration_minutes, s.processing_time_minutes,
           s.extra_time_minutes, s.price, s.display_price,
           COALESCE(sc.id, 0) AS category_id,
           COALESCE(sc.name, 'Services') AS category_name,
           sc.display_order AS category_order, s.display_order
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE LOWER(REGEXP_REPLACE(COALESCE(sc.name, ''), '^[[:space:]]*[0-9]+[.][[:space:]]*', '')) = 'sqt biomicroneedling'
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     ORDER BY name, s.id
  `);
  return result.rows;
}

async function listServicesForPractitioner(practitionerId) {
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name, s.duration_minutes, s.processing_time_minutes,
           s.extra_time_minutes, s.price, s.display_price,
           COALESCE(sc.name, 'Services') AS category_name,
           sc.display_order AS category_order, s.display_order
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
      LEFT JOIN service_categories sc ON sc.id = s.category_id
     WHERE st.id = $1
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     ORDER BY category_order NULLS LAST, s.display_order NULLS LAST, s.name, s.id
  `, [Number(practitionerId)]);
  return result.rows;
}

async function listEligiblePractitionersForService(serviceId) {
  const result = await pool.query(`
    SELECT DISTINCT st.id, st.display_name,
           CASE LOWER(st.display_name)
             WHEN 'christel' THEN 1
             WHEN 'abigail' THEN 2
             WHEN 'marietjie' THEN 3
             ELSE 9
           END AS practitioner_order
      FROM staff st
      JOIN staff_services ss ON ss.staff_id = st.id
      JOIN services s ON s.id = ss.service_id
     WHERE s.id = $1
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     ORDER BY practitioner_order, st.display_name, st.id
  `, [Number(serviceId)]);
  return result.rows;
}

function serviceDescription(row) {
  const parts = [formatDuration(row), formatPrice(row)].filter(Boolean);
  return fullLabelDescription(row?.name, parts.join(' • '));
}

function serviceTitle(name = '') {
  return compactListTitle(name, 'Service');
}

function categoryClientTitle(name = '') {
  const value = clean(name);
  return value.toLowerCase() === 'massage' ? 'Massage Treatments' : value;
}

function categoryPageInteractive(rows = [], page = 1) {
  const totalPages = Math.max(1, Math.ceil(rows.length / CATEGORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * CATEGORY_PAGE_SIZE;
  const pageRows = rows.slice(start, start + CATEGORY_PAGE_SIZE).map((row) => ({
    id: `client_category_${row.id}`,
    title: serviceTitle(categoryClientTitle(row.name)),
    description: `${Number(row.service_count) || 0} treatment${Number(row.service_count) === 1 ? '' : 's'}`,
  }));

  if (safePage < totalPages) {
    pageRows.push({
      id: `client_categories_page_${safePage + 1}`,
      title: 'More categories →',
      description: `Page ${safePage + 1} of ${totalPages}`,
    });
  } else if (safePage > 1) {
    pageRows.push({
      id: 'client_categories_page_1',
      title: '← First page',
      description: `Page 1 of ${totalPages}`,
    });
  }

  return {
    type: 'list',
    body: `*Browse Shiloh services*\nChoose a category first. Showing page ${safePage} of ${totalPages}.`,
    buttonText: 'Categories',
    rows: pageRows,
    sectionTitle: 'Service categories',
  };
}

function servicePageInteractive(rows = [], page = 1, options = {}) {
  const totalPages = Math.max(1, Math.ceil(rows.length / SERVICE_PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * SERVICE_PAGE_SIZE;
  const pageRows = rows.slice(start, start + SERVICE_PAGE_SIZE).map((row) => ({
    id: `client_service_${row.id}`,
    title: serviceTitle(row.name),
    description: serviceDescription(row),
  }));

  const categoryId = options.categoryId == null ? null : Number(options.categoryId);
  const categoryToken = clean(options.categoryToken);
  const categoryPageId = (targetPage) => {
    if (categoryToken) return `client_category_${categoryToken}_page_${targetPage}`;
    if (categoryId != null) return `client_category_${categoryId}_page_${targetPage}`;
    return `client_services_page_${targetPage}`;
  };
  if (safePage < totalPages) {
    pageRows.push({
      id: categoryPageId(safePage + 1),
      title: 'More services →',
      description: `Page ${safePage + 1} of ${totalPages}`,
    });
  } else if (safePage > 1) {
    pageRows.push({
      id: categoryPageId(1),
      title: '← First page',
      description: `Page 1 of ${totalPages}`,
    });
  }

  const heading = options.categoryName ? `*${options.categoryName}*` : '*Browse Shiloh services*';
  return {
    type: 'list',
    body: `${heading}\nChoose a treatment to start a booking. Showing page ${safePage} of ${totalPages}.`,
    buttonText: 'View services',
    rows: pageRows,
    sectionTitle: options.categoryName ? serviceTitle(options.categoryName) : 'Client-bookable services',
  };
}

function practitionerServicePageInteractive(rows = [], practitioner, page = 1) {
  const totalPages = Math.max(1, Math.ceil(rows.length / SERVICE_PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * SERVICE_PAGE_SIZE;
  const pageRows = rows.slice(start, start + SERVICE_PAGE_SIZE).map((row) => ({
    id: `client_service_${row.id}`,
    title: serviceTitle(row.name),
    description: serviceDescription(row),
  }));

  if (safePage < totalPages) {
    pageRows.push({
      id: `client_practitioner_services_${practitioner.id}_page_${safePage + 1}`,
      title: 'More services →',
      description: `Page ${safePage + 1} of ${totalPages}`,
    });
  } else if (safePage > 1) {
    pageRows.push({
      id: `client_practitioner_services_${practitioner.id}_page_1`,
      title: '← First page',
      description: `Page 1 of ${totalPages}`,
    });
  }

  return {
    type: 'list',
    body: `*Services with ${practitioner.display_name}*\nChoose an active service mapped to this practitioner. Showing page ${safePage} of ${totalPages}.`,
    buttonText: 'View services',
    rows: pageRows,
    sectionTitle: `${serviceTitle(practitioner.display_name)} services`,
  };
}

function eligiblePractitionersInteractive(service, staff = []) {
  const rows = [
    {
      id: 'client_practitioner_any',
      title: 'Any available',
      description: 'Use any eligible practitioner for this service',
    },
    ...staff.slice(0, 9).map((row) => ({
      id: `client_practitioner_${row.id}`,
      title: serviceTitle(row.display_name),
      description: `Eligible for ${serviceTitle(service.name)}`.slice(0, 72),
    })),
  ].slice(0, 10);

  return {
    type: 'list',
    body: `*${service.name}*\nChoose an eligible practitioner, or choose Any available.`,
    buttonText: 'Practitioners',
    rows,
    sectionTitle: 'Eligible practitioners',
  };
}

async function practitionersInteractive() {
  const staff = await listClientBookableStaff();
  const rows = staff.slice(0, 9).map((row) => ({
    id: `client_practitioner_${row.id}`,
    title: serviceTitle(row.display_name),
    description: row.client_role || 'Shiloh Practitioner',
  }));
  rows.push({ id: 'client_book_now', title: 'Book now', description: 'Start with a service or preference' });
  return {
    type: 'list',
    body: '*Our practitioners*\nChoose a practitioner to see the active services currently mapped to them.',
    buttonText: 'Practitioners',
    rows,
    sectionTitle: 'Shiloh practitioners',
  };
}

async function findClientBookableService(id) {
  const result = await pool.query(`
    SELECT DISTINCT s.id, s.name
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
     WHERE s.id = $1
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     LIMIT 1
  `, [Number(id)]);
  return result.rows[0] || null;
}

async function findClientBookablePractitioner(id) {
  const result = await pool.query(`
    SELECT id, display_name
      FROM staff
     WHERE id = $1
       AND status = 'active'
       AND resource_type = 'practitioner'
       AND client_bookable = TRUE
     LIMIT 1
  `, [Number(id)]);
  return result.rows[0] || null;
}

async function practitionerEligibleForService(practitionerId, serviceName) {
  const result = await pool.query(`
    SELECT st.id, st.display_name
      FROM staff st
      JOIN staff_services ss ON ss.staff_id = st.id
      JOIN services s ON s.id = ss.service_id
     WHERE st.id = $1
       AND LOWER(s.name) = LOWER($2)
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     LIMIT 1
  `, [Number(practitionerId), clean(serviceName)]);
  return result.rows[0] || null;
}

async function serviceEligibleForPractitioner(serviceId, practitionerName) {
  const result = await pool.query(`
    SELECT s.id, s.name
      FROM services s
      JOIN staff_services ss ON ss.service_id = s.id
      JOIN staff st ON st.id = ss.staff_id
     WHERE s.id = $1
       AND LOWER(st.display_name) = LOWER($2)
       AND s.status = 'active'
       AND st.status = 'active'
       AND st.resource_type = 'practitioner'
       AND st.client_bookable = TRUE
     LIMIT 1
  `, [Number(serviceId), clean(practitionerName)]);
  return result.rows[0] || null;
}

async function processClientDiscoveryMessage(sender, text) {
  const raw = clean(text);
  const value = raw.toLowerCase();

  if (isHomeCommand(raw)) {
    await clearIntent(sender);
    return { handled: true, interactive: clientHomeInteractive() };
  }

  if (['client_welcome_voucher', 'get r100 voucher', 'install my shiloh', 'my shiloh'].includes(value)) {
    return { handled: true, reply: welcomeVoucherReply() };
  }

  const voucherTreatment = welcomeVoucherRequestedService(raw);
  if (voucherTreatment) return selectedServicePractitioners(sender, voucherTreatment);

  if (value === 'client_selected_service_practitioners') {
    const existing = await getIntent(sender);
    if (!existing?.service_text) return { handled: true, interactive: bookingDiscoveryInteractive() };
    return selectedServicePractitioners(sender, existing.service_text);
  }

  if (['client_browse_services', 'browse services', 'services', 'list treatments', 'list services', 'treatments'].includes(value)) {
    const categories = await listClientBookableCategories();
    if (!categories.length) {
      return { handled: true, reply: 'I can’t safely load Shiloh’s client-bookable service categories right now. Please try again shortly.' };
    }
    return { handled: true, interactive: categoryPageInteractive(categories, 1) };
  }

  const categoryPageMatch = value.match(/^client_categories_page_(\d+)$/);
  if (categoryPageMatch) {
    const categories = await listClientBookableCategories();
    if (!categories.length) return { handled: true, reply: 'No client-bookable service categories are available to display right now.' };
    return { handled: true, interactive: categoryPageInteractive(categories, Number(categoryPageMatch[1])) };
  }

  const sqtCategoryPageMatch = value.match(/^client_category_sqt_biomicroneedling_page_(\d+)$/);
  if (sqtCategoryPageMatch) {
    const services = await listSqtBioMicroneedlingServices();
    if (!services.length) {
      return { handled: true, reply: 'SQT BioMicroneedling no longer has active client-bookable treatments. Send *Services* to refresh.' };
    }
    return {
      handled: true,
      interactive: servicePageInteractive(services, Number(sqtCategoryPageMatch[1]), {
        categoryToken: SQT_CLIENT_CATEGORY_ID,
        categoryName: SQT_CLIENT_CATEGORY_NAME,
      }),
    };
  }

  if (value === `client_category_${SQT_CLIENT_CATEGORY_ID}`) {
    const services = await listSqtBioMicroneedlingServices();
    if (!services.length) {
      return { handled: true, reply: 'SQT BioMicroneedling no longer has active client-bookable treatments. Send *Services* to refresh.' };
    }
    return {
      handled: true,
      interactive: servicePageInteractive(services, 1, {
        categoryToken: SQT_CLIENT_CATEGORY_ID,
        categoryName: SQT_CLIENT_CATEGORY_NAME,
      }),
    };
  }

  const categoryServicePageMatch = value.match(/^client_category_(\d+)_page_(\d+)$/);
  if (categoryServicePageMatch) {
    const categoryId = Number(categoryServicePageMatch[1]);
    const services = await listServicesForCategory(categoryId);
    if (!services.length) return { handled: true, reply: 'That category no longer has active client-bookable services. Send *Services* to refresh.' };
    return {
      handled: true,
      interactive: servicePageInteractive(services, Number(categoryServicePageMatch[2]), {
        categoryId,
        categoryName: services[0].category_name,
      }),
    };
  }

  const categoryMatch = value.match(/^client_category_(\d+)$/);
  if (categoryMatch) {
    const categoryId = Number(categoryMatch[1]);
    const services = await listServicesForCategory(categoryId);
    if (!services.length) return { handled: true, reply: 'That category no longer has active client-bookable services. Send *Services* to refresh.' };
    return {
      handled: true,
      interactive: servicePageInteractive(services, 1, {
        categoryId,
        categoryName: services[0].category_name,
      }),
    };
  }

  const pageMatch = value.match(/^client_services_page_(\d+)$/);
  if (pageMatch) {
    const services = await listClientBookableServices();
    if (!services.length) return { handled: true, reply: 'No client-bookable services are available to display right now.' };
    return { handled: true, interactive: servicePageInteractive(services, Number(pageMatch[1])) };
  }

  const practitionerPageMatch = value.match(/^client_practitioner_services_(\d+)_page_(\d+)$/);
  if (practitionerPageMatch) {
    const practitioner = await findClientBookablePractitioner(practitionerPageMatch[1]);
    if (!practitioner) {
      return { handled: true, reply: 'That practitioner is no longer available for direct client booking. Send *Our practitioners* to refresh the current list.' };
    }
    const services = await listServicesForPractitioner(practitioner.id);
    if (!services.length) {
      return { handled: true, reply: `${practitioner.display_name} has no active client-bookable services mapped right now.` };
    }
    return { handled: true, interactive: practitionerServicePageInteractive(services, practitioner, Number(practitionerPageMatch[2])) };
  }

  if (['client_practitioners', 'our practitioners', 'practitioners', 'list your staff', 'list staff', 'staff'].includes(value)) {
    return { handled: true, interactive: await practitionersInteractive() };
  }

  if (['client_book_now', 'book now'].includes(value)) {
    return decorateClientBookingResult(await processBookingMessage(sender, 'booking'));
  }

  const serviceMatch = value.match(/^client_service_(\d+)$/);
  if (serviceMatch) {
    let service = await findClientBookableService(serviceMatch[1]);
    if (!service) {
      return { handled: true, reply: 'That service is no longer available for direct client booking. Send *Services* to refresh the current list.' };
    }

    const existing = await getIntent(sender);
    const chosenPractitioner = clean(existing?.therapist_text);
    if (chosenPractitioner && chosenPractitioner !== 'Any available therapist') {
      service = await serviceEligibleForPractitioner(service.id, chosenPractitioner);
      if (!service) {
        return {
          handled: true,
          reply: `That service is not currently mapped to ${chosenPractitioner}. Send *Our practitioners* to refresh the current practitioner/service options.`,
        };
      }
    }

    const staged = await processBookingMessage(sender, `Book ${service.name}`);
    if (chosenPractitioner) return decorateClientBookingResult(staged);

    const eligible = await listEligiblePractitionersForService(service.id);
    if (!eligible.length) {
      return { handled: true, reply: 'No client-bookable practitioner is currently mapped to that service. Nothing has been booked.' };
    }
    return { handled: true, intent: staged.intent, interactive: eligiblePractitionersInteractive(service, eligible) };
  }

  if (value === 'client_practitioner_any') {
    const existing = await getIntent(sender);
    if (!existing?.service_text) {
      const staged = await processBookingMessage(sender, 'booking with any therapist');
      const categories = await listClientBookableCategories();
      if (!categories.length) return decorateClientBookingResult(staged);
      return { handled: true, intent: staged.intent, interactive: categoryPageInteractive(categories, 1) };
    }
    return decorateClientBookingResult(await processBookingMessage(sender, 'booking with any therapist'));
  }

  const practitionerMatch = value.match(/^client_practitioner_(\d+)$/);
  if (practitionerMatch) {
    let practitioner = await findClientBookablePractitioner(practitionerMatch[1]);
    if (!practitioner) {
      return { handled: true, reply: 'That practitioner is no longer available for direct client booking. Send *Our practitioners* to refresh the current list.' };
    }

    const existing = await getIntent(sender);
    if (existing?.service_text) {
      practitioner = await practitionerEligibleForService(practitioner.id, existing.service_text);
      if (!practitioner) {
        return {
          handled: true,
          reply: 'That practitioner is not currently eligible for the selected service. Send *Services* to refresh the current service/practitioner options.',
        };
      }
      return decorateClientBookingResult(await processBookingMessage(sender, `booking with ${practitioner.display_name}`));
    }

    const staged = await processBookingMessage(sender, `booking with ${practitioner.display_name}`);
    const services = await listServicesForPractitioner(practitioner.id);
    if (!services.length) {
      return { handled: true, reply: `${practitioner.display_name} has no active client-bookable services mapped right now. Nothing has been booked.` };
    }
    return { handled: true, intent: staged.intent, interactive: practitionerServicePageInteractive(services, practitioner, 1) };
  }

  return { handled: false };
}

module.exports = {
  CATEGORY_PAGE_SIZE,
  MY_SHILOH_WELCOME_VOUCHER_URL,
  SERVICE_PAGE_SIZE,
  SQT_CLIENT_CATEGORY_ID,
  SQT_CLIENT_CATEGORY_NAME,
  categoryPageInteractive,
  clientHomeInteractive,
  eligiblePractitionersInteractive,
  groupClientCategories,
  isHomeCommand,
  isSqtBioMicroneedlingCategory,
  listClientBookableCategories,
  listClientBookableServices,
  listEligiblePractitionersForService,
  listServicesForCategory,
  listServicesForPractitioner,
  listSqtBioMicroneedlingServices,
  practitionerServicePageInteractive,
  practitionersInteractive,
  processClientDiscoveryMessage,
  selectClientBookableServiceByName,
  servicePageInteractive,
  welcomeVoucherRequestedService,
  welcomeVoucherReply,
};
