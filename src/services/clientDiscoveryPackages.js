const { pool } = require('../db/pool');
const baseDiscovery = require('./clientDiscoveryMenu');
const { processBookingMessage, clearIntent } = require('./bookingIntent');
const { decorateClientBookingResult } = require('./clientBookingInteractive');
const { normalizePhone } = require('./clientIdentityOnboarding');
const {
  resolveWhatsAppBookingIdentity,
  CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY,
} = require('./whatsappBookingIdentity');
const { IDENTITY_MODELS } = require('./whatsappCrmV2IdentityCompat');
const { compactListTitle, fullLabelDescription } = require('../presentation/whatsappListRowPresentation');

const MASSAGE_PACKAGE_PAGE_SIZE = 9;
const SPORTS_PACKAGE_SLUG = 'sports-massage-monthly';

function clean(value = '') { return String(value || '').trim().replace(/\s+/g, ' '); }
function money(value) { const n = Number(value); return Number.isFinite(n) ? `R${n.toFixed(2).replace(/\.00$/, '')}` : 'Price on request'; }
function dateZA(value) { return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)); }
function short(value = '', max = 24) { const v = clean(value); return v.length <= max ? v : `${v.slice(0, Math.max(1, max - 1)).trim()}…`; }

async function massageCategoryId() {
  const r = await pool.query(`SELECT id FROM service_categories WHERE LOWER(name)='massage' AND status='active' LIMIT 1`);
  return r.rows[0]?.id ? Number(r.rows[0].id) : null;
}

async function packageSessionServiceIds() {
  const r = await pool.query(`SELECT session_service_id FROM service_packages WHERE status='active'`);
  return new Set(r.rows.map((row) => Number(row.session_service_id)));
}

async function activePackages() {
  const r = await pool.query(`
    SELECT sp.id, sp.slug, sp.name, sp.family_name, sp.package_price, sp.sessions_included,
           sp.validity_days, sp.validity_months, sp.cancellation_notice_hours, sp.customer_description,
           sp.session_service_id, s.name AS session_service_name, s.duration_minutes
      FROM service_packages sp
      JOIN services s ON s.id=sp.session_service_id
     WHERE sp.status='active' AND s.status='active'
     ORDER BY sp.id
  `);
  return r.rows;
}

async function packageBySlug(slug) {
  return (await activePackages()).find((row) => row.slug === slug) || null;
}

async function activeEntitlementForPhone(phone, packageId) {
  const identity = await resolveWhatsAppBookingIdentity(phone);
  if (identity.clientIdentity?.identityModel === IDENTITY_MODELS.CRM_V2) {
    return { identity, entitlement: null, unsupportedIdentityModel: IDENTITY_MODELS.CRM_V2 };
  }
  if (identity.status !== 'unique' || !identity.client?.id) return { identity, entitlement: null };
  const r = await pool.query(`
    SELECT e.id, e.client_id, e.package_id, e.purchase_price, e.purchased_at, e.starts_at, e.expires_at,
           e.sessions_total, e.status, e.payment_status,
           COUNT(r.id) FILTER (WHERE r.status IN ('reserved','redeemed'))::int AS sessions_used,
           COUNT(r.id) FILTER (WHERE r.status='reserved')::int AS sessions_reserved,
           COUNT(r.id) FILTER (WHERE r.status='redeemed')::int AS sessions_redeemed
      FROM client_package_entitlements e
      LEFT JOIN package_session_redemptions r ON r.entitlement_id=e.id
     WHERE e.client_id=$1 AND e.package_id=$2
       AND e.status='active' AND e.payment_status='paid'
       AND (e.starts_at IS NULL OR (NOW()>=e.starts_at AND NOW()<e.expires_at))
     GROUP BY e.id
     ORDER BY e.expires_at, e.id
     LIMIT 1
  `, [identity.client.id, packageId]);
  const entitlement = r.rows[0] || null;
  if (entitlement) {
    entitlement.sessions_remaining = Math.max(0, Number(entitlement.sessions_total) - Number(entitlement.sessions_used || 0));
  }
  return { identity, entitlement };
}

function packageDirectoryInteractive(packages = []) {
  return {
    type: 'list',
    body: '*Massage Packages*\nPrepaid packages are visible here before purchase, but package sessions can only be booked from an active paid package.',
    buttonText: 'View packages',
    rows: packages.slice(0, 9).map((p) => ({
      id: `client_package_${p.slug}`,
      title: compactListTitle(p.name.replace(/^Sports Massage\s*[—-]\s*/i, ''), 'Package'),
      description: fullLabelDescription(p.name, `${money(p.package_price)} • ${p.sessions_included} sessions • ${p.validity_months ? p.validity_months + ' month(s)' : p.validity_days + ' days'}`),
    })),
    sectionTitle: 'Massage Packages',
  };
}

function packageDetailInteractive(pkg, entitlement = null) {
  const lines = [
    `*${pkg.name}*`,
    '',
    `💳 ${money(pkg.package_price)} paid in advance`,
    `🎟️ ${pkg.sessions_included} × ${pkg.duration_minutes}-minute Sports Massage sessions`,
    `📅 Valid for ${pkg.validity_months ? pkg.validity_months + ' month(s)' : pkg.validity_days + ' days'} from your first treatment`,
    `🕒 ${pkg.cancellation_notice_hours}-hour cancellation notice`,
    `Effective value: ${money(Number(pkg.package_price) / Number(pkg.sessions_included))} per session`,
  ];
  if (pkg.customer_description) lines.push('', pkg.customer_description);
  if (entitlement) {
    lines.push('', `*Your package:* ${entitlement.sessions_remaining} of ${entitlement.sessions_total} sessions available`, entitlement.expires_at ? `Expires ${dateZA(entitlement.expires_at)}` : 'Validity begins with your first treatment');
  } else {
    lines.push('', 'This package is not booked as an individual treatment. Choose *Enquire / buy* and the clinic will record your full upfront payment. Validity begins with your first treatment.');
  }
  const buttons = entitlement && entitlement.sessions_remaining > 0
    ? [
        { id: `client_package_book_${pkg.slug}`, title: 'Book package session' },
        { id: `client_package_status_${pkg.slug}`, title: 'My package' },
      ]
    : [
        { id: `client_package_enquire_${pkg.slug}`, title: 'Enquire / buy' },
        { id: `client_package_status_${pkg.slug}`, title: 'My package' },
      ];
  return { type: 'button', body: lines.join('\n'), buttons };
}

async function massageTreatmentsInteractive(page = 1) {
  const categoryId = await massageCategoryId();
  if (!categoryId) return null;
  const [services, hiddenIds, packages] = await Promise.all([
    baseDiscovery.listServicesForCategory(categoryId),
    packageSessionServiceIds(),
    activePackages(),
  ]);
  const standard = services.filter((row) => !hiddenIds.has(Number(row.id)));
  const items = [
    ...(packages.length ? [{ kind: 'packages' }] : []),
    ...standard.map((service) => ({ kind: 'service', service })),
  ];
  const totalPages = Math.max(1, Math.ceil(items.length / MASSAGE_PACKAGE_PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * MASSAGE_PACKAGE_PAGE_SIZE;
  const rows = items.slice(start, start + MASSAGE_PACKAGE_PAGE_SIZE).map((item) => {
    if (item.kind === 'packages') return { id: 'client_massage_packages', title: 'Massage Packages', description: 'Prepaid packages & package sessions' };
    const s = item.service;
    const duration = Number(s.duration_minutes || 0) + Number(s.processing_time_minutes || 0) + Number(s.extra_time_minutes || 0);
    const price = s.display_price || (s.price == null ? 'Price on request' : money(s.price));
    return { id: `client_service_${s.id}`, title: compactListTitle(s.name, 'Treatment'), description: fullLabelDescription(s.name, `${duration || '?'} min • ${price}`) };
  });
  if (safePage < totalPages) rows.push({ id: `client_massage_treatments_page_${safePage + 1}`, title: 'More services →', description: `Page ${safePage + 1} of ${totalPages}` });
  else if (safePage > 1) rows.push({ id: 'client_massage_treatments_page_1', title: '← First page', description: `Page 1 of ${totalPages}` });
  return {
    type: 'list',
    body: `*Massage Treatments*\nChoose a treatment, or open Massage Packages. Showing page ${safePage} of ${totalPages}.`,
    buttonText: 'View services',
    rows,
    sectionTitle: 'Massage Treatments',
  };
}

async function recordEnquiry(phone, pkg) {
  const identity = await resolveWhatsAppBookingIdentity(phone);
  if (identity.clientIdentity?.identityModel === IDENTITY_MODELS.CRM_V2) {
    return { identity, recorded: false, unsupportedIdentityModel: IDENTITY_MODELS.CRM_V2 };
  }
  await pool.query(`
    INSERT INTO package_enquiries (client_id, package_id, normalized_whatsapp, status)
    VALUES ($1,$2,$3,'open')
  `, [identity.status === 'unique' ? identity.client.id : null, pkg.id, normalizePhone(phone)]);
  return { identity, recorded: true };
}

async function businessAdmin(sender) {
  const r = await pool.query(`
    SELECT id, display_name, business_role, permissions
      FROM staff_admin_accounts
     WHERE normalized_whatsapp=$1 AND active=TRUE
     LIMIT 1
  `, [normalizePhone(sender)]);
  const admin = r.rows[0] || null;
  if (!admin || !['owner','business_admin'].includes(admin.business_role)) return null;
  return admin;
}

async function activateSportsPackage(sender, target) {
  const admin = await businessAdmin(sender);
  if (!admin) return { handled: false };
  const pkg = await packageBySlug(SPORTS_PACKAGE_SLUG);
  if (!pkg) return { handled: true, reply: 'The Sports Massage monthly package is not active in the catalogue.' };
  const normalizedTarget = normalizePhone(target);
  if (!normalizedTarget) return { handled: true, reply: 'Send the client mobile number, for example: *Activate Sports Massage package for 0821234567*.' };
  const clientResult = await pool.query(`
    SELECT DISTINCT c.id, c.display_name
      FROM clients c
      JOIN client_contacts cc ON cc.client_id=c.id
     WHERE cc.normalized_value=$1 AND cc.contact_type IN ('whatsapp','mobile') AND c.status='active'
  `, [normalizedTarget]);
  if (clientResult.rowCount !== 1) return { handled: true, reply: 'I could not resolve that mobile number to exactly one active Shiloh client. Nothing was activated.' };
  const client = clientResult.rows[0];
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const existing = await db.query(`
      SELECT id, expires_at FROM client_package_entitlements
       WHERE client_id=$1 AND package_id=$2 AND status='active' AND payment_status='paid' AND (starts_at IS NULL OR NOW()<expires_at)
       FOR UPDATE
    `, [client.id, pkg.id]);
    if (existing.rowCount) {
      await db.query('ROLLBACK');
      return { handled: true, reply: `${client.display_name || 'This client'} already has an active Sports Massage package ${existing.rows[0].expires_at ? 'valid until ' + dateZA(existing.rows[0].expires_at) : 'ready for the first treatment'}. Nothing was duplicated.` };
    }
    const entitlement = await db.query(`
      INSERT INTO client_package_entitlements
        (client_id, package_id, payment_status, purchase_price, validity_days, starts_at, expires_at, sessions_total, status, activated_by_admin_id,validity_months,purchase_name,purchase_description)
      VALUES ($1,$2,'paid',$3,$4,NULL,NULL,$5,'active',$6,$7,$8,$9)
      RETURNING id, expires_at
    `, [client.id, pkg.id, pkg.package_price, pkg.validity_days, pkg.sessions_included, admin.id,pkg.validity_months,pkg.name,pkg.customer_description]);
    await db.query(`
      UPDATE package_enquiries SET status='converted', updated_at=NOW()
       WHERE package_id=$1 AND (client_id=$2 OR normalized_whatsapp=$3) AND status='open'
    `, [pkg.id, client.id, normalizedTarget]);
    await db.query(`
      INSERT INTO crm_audit_events (actor_admin_id, action, entity_type, entity_id, metadata)
      VALUES ($1,'package.entitlement_activated','client_package_entitlement',$2,$3::jsonb)
    `, [admin.id, entitlement.rows[0].id, JSON.stringify({ clientId: client.id, packageId: pkg.id, price: Number(pkg.package_price), sessions: Number(pkg.sessions_included), validityDays: Number(pkg.validity_days) })]);
    await db.query('COMMIT');
    return { handled: true, reply: `✅ ${pkg.name} activated for ${client.display_name || normalizedTarget}.\n\n${pkg.sessions_included} package sessions are available. Validity begins with the first treatment. Payment recorded: ${money(pkg.package_price)}.` };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { db.release(); }
}

async function processPackageCommand(sender, text) {
  const raw = clean(text);
  const activate = raw.match(/^(?:activate|grant)\s+sports massage(?:\s+monthly)?\s+package\s+(?:for|to)\s+(.+)$/i);
  if (activate) return activateSportsPackage(sender, activate[1]);

  if (/^client_massage_treatments_page_(\d+)$/i.test(raw)) {
    const page = Number(raw.match(/(\d+)$/)[1]);
    return { handled: true, interactive: await massageTreatmentsInteractive(page) };
  }
  if (raw === 'client_massage_packages' || /^massage packages$/i.test(raw)) {
    const packages = await activePackages();
    return { handled: true, interactive: packageDirectoryInteractive(packages) };
  }
  const packageMatch = raw.match(/^client_package_(sports-massage-monthly)$/i);
  if (packageMatch) {
    const pkg = await packageBySlug(packageMatch[1]);
    if (!pkg) return { handled: true, reply: 'That package is not currently active.' };
    const { entitlement, unsupportedIdentityModel } = await activeEntitlementForPhone(sender, pkg.id);
    if (unsupportedIdentityModel) return { handled: true, status: 'crm_v2_package_legacy_boundary', reply: CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY };
    return { handled: true, interactive: packageDetailInteractive(pkg, entitlement) };
  }
  const enquiryMatch = raw.match(/^client_package_enquire_(sports-massage-monthly)$/i);
  if (enquiryMatch) {
    const pkg = await packageBySlug(enquiryMatch[1]);
    if (!pkg) return { handled: true, reply: 'That package is not currently active.' };
    const enquiry = await recordEnquiry(sender, pkg);
    if (!enquiry.recorded) return { handled: true, status: 'crm_v2_enquiry_legacy_boundary', reply: CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY };
    return { handled: true, reply: `Thanks — I’ve recorded your interest in the *${pkg.name}*.\n\nThe package is ${money(pkg.package_price)} paid in advance for ${pkg.sessions_included} × ${pkg.duration_minutes}-minute sessions and is valid for ${pkg.validity_days} days from activation. The Shiloh team can confirm payment and activate it for you.\n\nClinic: 066 239 9138` };
  }
  const statusMatch = raw.match(/^client_package_status_(sports-massage-monthly)$/i);
  if (statusMatch) {
    const pkg = await packageBySlug(statusMatch[1]);
    if (!pkg) return { handled: true, reply: 'That package is not currently active.' };
    const { identity, entitlement, unsupportedIdentityModel } = await activeEntitlementForPhone(sender, pkg.id);
    if (unsupportedIdentityModel) return { handled: true, status: 'crm_v2_package_legacy_boundary', reply: CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY };
    if (identity.status !== 'unique') return { handled: true, reply: 'I need your Shiloh client profile to resolve uniquely before I can show package credits.' };
    if (!entitlement) return { handled: true, interactive: packageDetailInteractive(pkg, null) };
    return { handled: true, interactive: packageDetailInteractive(pkg, entitlement) };
  }
  const bookMatch = raw.match(/^client_package_book_(sports-massage-monthly)$/i);
  if (bookMatch) {
    const pkg = await packageBySlug(bookMatch[1]);
    if (!pkg) return { handled: true, reply: 'That package is not currently active.' };
    const { entitlement, unsupportedIdentityModel } = await activeEntitlementForPhone(sender, pkg.id);
    if (unsupportedIdentityModel) return { handled: true, status: 'crm_v2_package_legacy_boundary', reply: CRM_V2_LEGACY_ONLY_BOUNDARY_REPLY };
    if (!entitlement || entitlement.sessions_remaining < 1) {
      await clearIntent(normalizePhone(sender));
      return { handled: true, reply: 'There is no active paid Sports Massage package credit available on this client profile. Nothing has been booked.' };
    }
    const staged = await processBookingMessage(sender, `Book ${pkg.session_service_name}`);
    const decorated = decorateClientBookingResult(staged);
    if (decorated?.interactive?.body) {
      decorated.interactive.body = `*Package booking* — ${entitlement.sessions_remaining} of ${entitlement.sessions_total} credits available; ${entitlement.expires_at ? 'expires ' + dateZA(entitlement.expires_at) : 'validity starts with your first treatment'}.\n\n${decorated.interactive.body}`;
    } else if (decorated?.reply) {
      decorated.reply = `Package credit verified. ${entitlement.sessions_remaining} of ${entitlement.sessions_total} available; ${entitlement.expires_at ? 'expires ' + dateZA(entitlement.expires_at) : 'validity starts with your first treatment'}.\n\n${decorated.reply}`;
    }
    return decorated;
  }
  return { handled: false };
}

async function processClientDiscoveryMessage(sender, text) {
  const packageCommand = await processPackageCommand(sender, text);
  if (packageCommand.handled) return packageCommand;

  const categoryMatch = clean(text).match(/^client_category_(\d+)$/i);
  if (categoryMatch) {
    const massageId = await massageCategoryId();
    if (massageId && Number(categoryMatch[1]) === massageId) {
      return { handled: true, interactive: await massageTreatmentsInteractive(1) };
    }
  }

  const result = await baseDiscovery.processClientDiscoveryMessage(sender, text);
  if (!result?.handled) return result;

  // Natural-language routes into the Massage category also receive the package-aware page.
  if (result.interactive?.type === 'list' && /^\*Massage Treatments\*/i.test(clean(result.interactive.body))) {
    return { ...result, interactive: await massageTreatmentsInteractive(1) };
  }

  // Fail closed: the package-only calendar service must never leak into ordinary
  // service/practitioner discovery even though it has staff mappings for availability.
  if (result.interactive?.type === 'list' && Array.isArray(result.interactive.rows)) {
    const hiddenIds = await packageSessionServiceIds();
    const rows = result.interactive.rows.filter((row) => {
      const m = String(row.id || '').match(/^client_service_(\d+)$/);
      return !m || !hiddenIds.has(Number(m[1]));
    });
    return { ...result, interactive: { ...result.interactive, rows } };
  }
  return result;
}

module.exports = {
  SPORTS_PACKAGE_SLUG,
  activeEntitlementForPhone,
  activePackages,
  activateSportsPackage,
  massageTreatmentsInteractive,
  packageDetailInteractive,
  packageDirectoryInteractive,
  processClientDiscoveryMessage,
};
