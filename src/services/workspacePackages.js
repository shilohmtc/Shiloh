const crypto = require('crypto');
const { pool } = require('../db/pool');
const services = require('./workspaceServices');
const creation = require('./workspaceServiceCreation');
const { normalizeDuration, normalizeStaffIds } = creation;
const {
  WorkspaceServicesError: ErrorType,
  positiveId,
  normalizeName,
  normalizePrice,
  normalizeCustomerDescription,
} = services;
function fail(code, message, status = 400) {
  throw new ErrorType(code, message, status);
}
function integer(value, min, max, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    fail('PACKAGE_INVALID', `${label} must be between ${min} and ${max}.`);
  return n;
}
function revision(row) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        row.id,
        row.name,
        String(row.package_price),
        row.sessions_included,
        row.validity_days,
        row.validity_months,
        row.customer_description,
        row.status,
        String(row.updated_at),
      ]),
    )
    .digest('hex');
}
function packagePayload(input) {
  const price = normalizePrice(input.price);
  if (price === null || Number(price) <= 0)
    fail('PACKAGE_PRICE_REQUIRED', 'Enter the full upfront package price.');
  const unit = input.validityUnit;
  if (!['days', 'months'].includes(unit))
    fail('PACKAGE_INVALID', 'Choose days or months for validity.');
  return {
    name: normalizeName(input.name),
    price,
    sessions: integer(input.sessions, 1, 100, 'Treatments'),
    validity: integer(input.validity, 1, unit === 'months' ? 12 : 365, 'Validity'),
    unit,
    description: normalizeCustomerDescription(input.description),
  };
}
function createWorkspacePackages({
  db = pool,
  serviceAuthority = services,
  creationAuthority = creation,
} = {}) {
  async function requireAccess(adminId, queryable = db) {
    const a = await serviceAuthority.resolveManageAccess(adminId, queryable);
    if (
      !a ||
      a.serviceScope !== 'all_services' ||
      !['owner', 'business_admin', 'booking_operator'].includes(a.businessRole)
    )
      fail('PACKAGE_FORBIDDEN', 'Package management is not available for this account.', 403);
    return a;
  }
  async function list(adminId) {
    await requireAccess(adminId);
    const r = await db.query(
      `SELECT p.*,s.duration_minutes,s.name AS session_name FROM service_packages p JOIN services s ON s.id=p.session_service_id ORDER BY p.status,LOWER(p.name),p.id`,
    );
    return r.rows.map((p) => ({ ...p, revision: revision(p) }));
  }
  async function audit(c, a, action, id, data) {
    await c.query(
      `INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'service_package',$3,$4::jsonb)`,
      [a.operatorAdminId, action, id, JSON.stringify(data)],
    );
  }
  async function mutate({ adminId, id, expectedRevision, requestId, action, ...input }) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(requestId || '')))
      fail('PACKAGE_INVALID_REQUEST', 'Reload Packages and try again.');
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const a = await requireAccess(adminId, c);
      let p;
      await c.query('SELECT pg_advisory_xact_lock(918405)');
      if (action !== 'create') {
        const r = await c.query('SELECT * FROM service_packages WHERE id=$1 FOR UPDATE', [
          positiveId(id),
        ]);
        p = r.rows[0];
        if (!p) fail('PACKAGE_NOT_FOUND', 'Package was not found.', 404);
        if (revision(p) !== expectedRevision)
          fail('PACKAGE_CHANGED', 'This package changed. Reload before saving.', 409);
      }
      if (action === 'delete' || action === 'restore') {
        await c.query(
          'UPDATE service_packages SET status=$2,updated_by_admin_id=$3,updated_at=NOW() WHERE id=$1',
          [p.id, action === 'delete' ? 'inactive' : 'active', a.operatorAdminId],
        );
      } else {
        const v = packagePayload(input);
        const dup = await c.query(
          'SELECT id FROM service_packages WHERE LOWER(name)=LOWER($1) AND id IS DISTINCT FROM $2',
          [v.name, p?.id || null],
        );
        if (dup.rows.length)
          fail('PACKAGE_DUPLICATE', 'A package with this name already exists.', 409);
        if (action === 'create') {
          await creationAuthority.requireCreateAccess(adminId, c);
          const duration = normalizeDuration(input.durationMinutes);
          const categoryId = positiveId(input.categoryId);
          await creationAuthority.canonicalCategory(c, categoryId);
          const staffIds = normalizeStaffIds(input.staffIds);
          const staff = await c.query(
            `SELECT id FROM staff WHERE id=ANY($1::bigint[]) AND status='active' AND resource_type='practitioner' AND client_bookable=TRUE AND COALESCE(business_role,'')<>'tenant_practitioner'`,
            [staffIds],
          );
          if (staff.rows.length !== staffIds.length)
            fail('PACKAGE_PRACTITIONER_CHANGED', 'Choose active clinic practitioners.', 409);
          const slug = 'package-' + crypto.randomUUID();
          const inserted = await c.query(
            `INSERT INTO services(category_id,name,duration_minutes,price,display_price,customer_description,status,external_source,external_id) VALUES($1,$2,$3,$4,'Prepaid package session',$5,'active','shiloh_package',$6) RETURNING id`,
            [
              categoryId,
              v.name + ' — Session',
              duration,
              Number(v.price) / v.sessions,
              v.description,
              slug,
            ],
          );
          const sid = inserted.rows[0].id;
          for (const staffId of staffIds)
            await c.query('INSERT INTO staff_services(staff_id,service_id) VALUES($1,$2)', [
              staffId,
              sid,
            ]);
          const r = await c.query(
            `INSERT INTO service_packages(slug,name,session_service_id,package_price,sessions_included,validity_days,validity_months,customer_description,updated_by_admin_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [
              slug,
              v.name,
              sid,
              v.price,
              v.sessions,
              v.unit === 'days' ? v.validity : 30,
              v.unit === 'months' ? v.validity : null,
              v.description,
              a.operatorAdminId,
            ],
          );
          p = r.rows[0];
        } else {
          await c.query(
            `UPDATE service_packages SET name=$2,package_price=$3,sessions_included=$4,validity_days=$5,validity_months=$6,customer_description=$7,updated_by_admin_id=$8,updated_at=NOW() WHERE id=$1`,
            [
              p.id,
              v.name,
              v.price,
              v.sessions,
              v.unit === 'days' ? v.validity : 30,
              v.unit === 'months' ? v.validity : null,
              v.description,
              a.operatorAdminId,
            ],
          );
        }
      }
      await audit(c, a, 'workspace.package_' + action, p.id, {
        requestId,
        purchasesPreserved: true,
      });
      await c.query('COMMIT');
      return { status: action, id: Number(p.id) };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async function purchases(adminId) {
    const a = await requireAccess(adminId);
    if (a.permissions?.['client:lookup'] !== true || a.permissions?.['payment:view'] !== true)
      return [];
    const r = await db.query(`SELECT e.*,p.name,c.name AS client_name,
 COUNT(r.id) FILTER(WHERE r.status='reserved')::int AS booked,COUNT(r.id) FILTER(WHERE r.status='redeemed')::int AS used
 FROM client_package_entitlements e JOIN service_packages p ON p.id=e.package_id JOIN crm_v2_clients c ON c.id=e.crm_v2_client_id LEFT JOIN package_session_redemptions r ON r.entitlement_id=e.id GROUP BY e.id,p.name,c.name ORDER BY e.purchased_at DESC LIMIT 100`);
    return r.rows;
  }
  async function recordPaid({
    adminId,
    packageId,
    crmV2ClientId,
    paymentReference,
    paymentMethod,
    requestId,
    paidConfirmed,
    packageRevision,
  }) {
    if (paidConfirmed !== true)
      fail('PACKAGE_PAYMENT_REQUIRED', 'Confirm that the full upfront payment has been received.');
    if (!['cash', 'card_machine', 'manual_eft'].includes(paymentMethod))
      fail('PACKAGE_PAYMENT_METHOD', 'Choose how the upfront payment was received.');
    const ref = String(paymentReference || '').trim();
    if (!ref || ref.length > 200)
      fail('PACKAGE_PAYMENT_REFERENCE', 'Enter a receipt or payment reference.');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(requestId || '')))
      fail('PACKAGE_INVALID_REQUEST', 'Reload and try again.');
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const a = await requireAccess(adminId, c);
      if (a.permissions?.['payment:collect'] !== true || a.permissions?.['client:lookup'] !== true)
        fail('PACKAGE_PAYMENT_FORBIDDEN', 'Payment recording access is required.', 403);
      const old = await c.query(
        'SELECT id,crm_v2_client_id,package_id FROM client_package_entitlements WHERE operation_key=$1',
        [requestId],
      );
      if (old.rows.length) {
        if (
          Number(old.rows[0].crm_v2_client_id) !== Number(crmV2ClientId) ||
          Number(old.rows[0].package_id) !== Number(packageId)
        )
          fail('PACKAGE_REQUEST_CONFLICT', 'This operation belongs to another purchase.', 409);
        await c.query('COMMIT');
        return { id: old.rows[0].id, status: 'recorded' };
      }
      const r = await c.query(
        `SELECT p.* FROM service_packages p JOIN services s ON s.id=p.session_service_id WHERE p.id=$1 AND p.status='active' AND s.status='active' AND s.deleted_at IS NULL FOR UPDATE OF p`,
        [positiveId(packageId)],
      );
      const p = r.rows[0];
      if (!p) fail('PACKAGE_UNAVAILABLE', 'This package is no longer available.', 409);
      if (revision(p) !== packageRevision)
        fail('PACKAGE_CHANGED', 'Package terms changed. Reload before recording payment.', 409);
      const client = await c.query(
        `SELECT c.id FROM crm_v2_clients c WHERE c.id=$1 AND c.status='active' AND EXISTS(SELECT 1 FROM crm_v2_client_relationships rel WHERE rel.client_id=c.id AND rel.relationship_type='clinic' AND rel.status='active') FOR SHARE`,
        [positiveId(crmV2ClientId)],
      );
      if (client.rows.length !== 1)
        fail('PACKAGE_CLIENT_UNAVAILABLE', 'Choose an active clinic client.', 409);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `package-purchase:${client.rows[0].id}:${p.id}`,
      ]);
      const existing = await c.query(
        `SELECT id FROM client_package_entitlements e WHERE e.crm_v2_client_id=$1 AND e.package_id=$2 AND e.status='active' AND e.payment_status='paid' AND (e.expires_at IS NULL OR e.expires_at>NOW()) AND (SELECT COUNT(*) FROM package_session_redemptions r WHERE r.entitlement_id=e.id AND r.status IN ('reserved','redeemed'))<e.sessions_total`,
        [client.rows[0].id, p.id],
      );
      if (existing.rows.length)
        fail(
          'PACKAGE_ALREADY_OWNED',
          'This client already has an unused package. Use their existing balance.',
          409,
        );
      const ent = await c.query(
        `INSERT INTO client_package_entitlements(crm_v2_client_id,package_id,purchase_price,sessions_total,validity_days,validity_months,payment_reference,payment_method,operation_key,activated_by_admin_id,purchase_name,purchase_description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          client.rows[0].id,
          p.id,
          p.package_price,
          p.sessions_included,
          p.validity_days,
          p.validity_months,
          ref,
          paymentMethod,
          requestId,
          a.operatorAdminId,
          p.name,
          p.customer_description,
        ],
      );
      await audit(c, a, 'workspace.package_paid', p.id, {
        entitlementId: ent.rows[0].id,
        amount: p.package_price,
        paymentMethod,
        requestId,
      });
      await c.query('COMMIT');
      return { status: 'recorded', id: Number(ent.rows[0].id) };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async function forClient(crmV2ClientId) {
    const r = await db.query(
      `SELECT p.*,s.duration_minutes,e.id AS entitlement_id,e.starts_at,e.expires_at,e.sessions_total,e.purchase_price,e.purchase_name AS owned_name,e.purchase_description,e.validity_days AS purchased_validity_days,e.validity_months AS purchased_validity_months,e.status AS entitlement_status,
 (SELECT COUNT(*) FROM package_session_redemptions r WHERE r.entitlement_id=e.id AND r.status='reserved')::int AS booked,
 (SELECT COUNT(*) FROM package_session_redemptions r WHERE r.entitlement_id=e.id AND r.status='redeemed')::int AS used
 FROM service_packages p JOIN services s ON s.id=p.session_service_id LEFT JOIN client_package_entitlements e ON e.package_id=p.id AND e.crm_v2_client_id=$1 AND e.payment_status='paid'
 WHERE p.status='active' OR e.id IS NOT NULL ORDER BY p.id,e.purchased_at DESC`,
      [positiveId(crmV2ClientId)],
    );
    return r.rows;
  }
  async function available(crmV2ClientId, serviceId) {
    const r = await db.query(
      `SELECT e.*,COALESCE(e.purchase_name,p.name) AS name FROM client_package_entitlements e JOIN service_packages p ON p.id=e.package_id WHERE e.crm_v2_client_id=$1 AND p.session_service_id=$2 AND e.status='active' AND e.payment_status='paid' AND (e.expires_at IS NULL OR e.expires_at>NOW()) AND (SELECT COUNT(*) FROM package_session_redemptions r WHERE r.entitlement_id=e.id AND r.status IN ('reserved','redeemed'))<e.sessions_total ORDER BY e.expires_at NULLS LAST,e.id LIMIT 1`,
      [positiveId(crmV2ClientId), positiveId(serviceId)],
    );
    if (!r.rows.length)
      fail(
        'PACKAGE_BALANCE_REQUIRED',
        'You need a paid package with an available treatment to book this session.',
        409,
      );
    return r.rows[0];
  }
  async function permitsStart(entitlementId, startsAt) {
    const r = await db.query(
      `SELECT CASE WHEN e.starts_at IS NOT NULL THEN $2::timestamptz>=e.starts_at AND $2::timestamptz<e.expires_at ELSE GREATEST($2::timestamptz,COALESCE(MAX(a.starts_at),$2::timestamptz))<shiloh_package_expiry(LEAST($2::timestamptz,COALESCE(MIN(a.starts_at),$2::timestamptz)),e.validity_days,e.validity_months) END AS allowed FROM client_package_entitlements e LEFT JOIN package_session_redemptions r ON r.entitlement_id=e.id AND r.status IN ('reserved','redeemed') LEFT JOIN appointments a ON a.id=r.appointment_id WHERE e.id=$1 GROUP BY e.id`,
      [entitlementId, startsAt],
    );
    return r.rows[0]?.allowed === true;
  }
  async function readiness() {
    const result = await db.query(`SELECT p.slug,p.package_price,p.sessions_included,p.validity_days,p.validity_months,p.status,s.duration_minutes,s.deleted_at IS NULL AS session_preserved,
      (SELECT COUNT(*)::int FROM services duplicate WHERE duplicate.status='active' AND duplicate.deleted_at IS NULL AND regexp_replace(lower(duplicate.name),'[^a-z]','','g') IN ('sportsmassagemonthlypackage','sportmassagemonthlypackage','spaortmassagemonthlypackage') AND duplicate.id<>p.session_service_id) AS active_duplicate_services
      FROM service_packages p JOIN services s ON s.id=p.session_service_id WHERE p.slug='sports-massage-monthly'`);
    return { migration: '185_workspace_packages_and_service_trash.sql', firstTreatmentValidity: true, crmV2Balances: true, sportsPackage: result.rows[0] || null };
  }
  return { requireAccess, readiness, list, mutate, purchases, recordPaid, forClient, available, permitsStart };
}
module.exports = {
  revision,
  packagePayload,
  createWorkspacePackages,
  ...createWorkspacePackages(),
};
