const { pool } = require('../db/pool');

class EarningsError extends Error {
  constructor(message, httpStatus = 400) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

function clinicDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(date));
}

function nextClinicDate(now = new Date()) {
  return clinicDate(new Date(now.getTime() + 86400000));
}

function isChristelOwner(rows) {
  return rows.length === 1 && rows[0].active === true
    && rows[0].business_role === 'owner'
    && String(rows[0].display_name || '').trim().toLowerCase() === 'christel'
    && rows[0].staff_status === 'active'
    && String(rows[0].staff_name || '').trim().toLowerCase() === 'christel'
    && rows[0].permissions?.['appointment:view'] === true;
}

function selectRule(rules, appointment) {
  const date = clinicDate(appointment.starts_at);
  const serviceIds = appointment.service_ids || [];
  const candidates = rules.filter(rule => Number(rule.staff_id) === Number(appointment.staff_id)
    && String(rule.effective_from).slice(0, 10) <= date
    && (rule.service_id == null || (serviceIds.length === 1 && Number(rule.service_id) === Number(serviceIds[0]))));
  candidates.sort((a, b) => (Number(b.service_id != null) - Number(a.service_id != null))
    || String(b.effective_from).localeCompare(String(a.effective_from)));
  return candidates[0] || null;
}

function summarize(staff, appointments, rules) {
  const byStaff = staff.map(person => ({
    staffId: Number(person.id), name: person.display_name,
    completedValue: 0, commission: 0, completedCount: 0, reviewCount: 0,
    appointments: [],
  }));
  const map = new Map(byStaff.map(row => [row.staffId, row]));
  for (const appointment of appointments) {
    const row = map.get(Number(appointment.staff_id));
    if (!row) continue;
    const price = appointment.total_price == null ? null : Number(appointment.total_price);
    const rule = selectRule(rules, appointment);
    let reason = null;
    if (Number(appointment.staff_count) !== 1) reason = 'Shared appointment — review allocation';
    else if (price == null || !Number.isFinite(price) || price < 0) reason = 'Price missing — review';
    else if (!rule) reason = 'Commission rule missing — review';
    const commission = reason ? null : Math.round(price * Number(rule.rate_percent)) / 100;
    if (Number(appointment.staff_count) === 1 && price != null && Number.isFinite(price) && price >= 0) {
      row.completedValue += price;
      row.completedCount += 1;
    }
    if (reason) row.reviewCount += 1;
    else row.commission += commission;
    row.appointments.push({
      id: Number(appointment.id), startsAt: appointment.starts_at,
      serviceNames: appointment.service_names || [], price, reason,
      ratePercent: reason ? null : Number(rule.rate_percent), commission,
    });
  }
  return byStaff.map(row => ({
    ...row,
    completedValue: Math.round(row.completedValue * 100) / 100,
    commission: Math.round(row.commission * 100) / 100,
  }));
}

function createWorkspaceStaffEarningsService({ db = pool } = {}) {
  async function requireOwner(adminId) {
    const id = Number(adminId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new EarningsError('Access denied.', 403);
    const result = await db.query(`/* StaffEarnings:owner */
      SELECT a.active,a.business_role,a.display_name,a.permissions,
             s.display_name AS staff_name,s.status AS staff_status
        FROM staff_admin_accounts a JOIN staff s ON s.id=a.staff_id
       WHERE a.id=$1 LIMIT 2`, [id]);
    if (!isChristelOwner(result.rows)) throw new EarningsError('Access denied.', 403);
    return id;
  }

  async function build({ adminId, period, selectedStaffId }) {
    await requireOwner(adminId);
    const staff = (await db.query(`/* StaffEarnings:staff */
      SELECT s.id,s.display_name FROM staff s
       WHERE s.resource_type='practitioner'
         AND (s.status='active' OR EXISTS (
           SELECT 1 FROM appointment_staff ast JOIN appointments a ON a.id=ast.appointment_id
            WHERE ast.staff_id=s.id AND a.status='completed'
              AND a.starts_at >= $1::timestamptz AND a.starts_at < $2::timestamptz))
       ORDER BY s.display_name,s.id`, [period.from, period.to])).rows;
    const allowed = new Set(staff.map(row => Number(row.id)));
    if (selectedStaffId != null && !allowed.has(Number(selectedStaffId))) throw new EarningsError('Choose a valid team member.');
    const [visits, configured] = await Promise.all([
      db.query(`/* StaffEarnings:visits */
        SELECT a.id,a.starts_at,a.total_price,ast.staff_id,
               (SELECT COUNT(*)::int FROM appointment_staff x WHERE x.appointment_id=a.id) AS staff_count,
               ARRAY(SELECT DISTINCT aps.service_id FROM appointment_services aps
                      WHERE aps.appointment_id=a.id AND aps.service_id IS NOT NULL ORDER BY aps.service_id) AS service_ids,
               ARRAY(SELECT aps.service_name_snapshot FROM appointment_services aps
                      WHERE aps.appointment_id=a.id ORDER BY aps.id) AS service_names
          FROM appointments a JOIN appointment_staff ast ON ast.appointment_id=a.id
         WHERE a.starts_at >= $1::timestamptz AND a.starts_at < $2::timestamptz
           AND a.status='completed'
           AND ($3::bigint IS NULL OR ast.staff_id=$3)
         ORDER BY a.starts_at,a.id`, [period.from, period.to, selectedStaffId || null]),
      db.query(`/* StaffEarnings:rules */
        SELECT r.id,r.staff_id,r.service_id,r.effective_from::text,r.rate_percent,
               s.name AS service_name
          FROM workspace_commission_rules r LEFT JOIN services s ON s.id=r.service_id
         ORDER BY r.staff_id,r.service_id NULLS FIRST,r.effective_from DESC`),
    ]);
    const displayStaff = selectedStaffId == null ? staff : staff.filter(row => Number(row.id) === Number(selectedStaffId));
    return {
      staff: summarize(displayStaff, visits.rows, configured.rows),
      rules: configured.rows.filter(row => selectedStaffId == null || Number(row.staff_id) === Number(selectedStaffId)),
      services: (await db.query(`SELECT id,name FROM services WHERE status='active' ORDER BY name,id`)).rows,
      earliestNewRuleDate: nextClinicDate(),
    };
  }

  async function addRule({ adminId, staffId, serviceId, effectiveFrom, ratePercent }) {
    await requireOwner(adminId);
    const staff = Number(staffId);
    const service = serviceId ? Number(serviceId) : null;
    const rate = Number(ratePercent);
    const day = String(effectiveFrom || '');
    if (!Number.isSafeInteger(staff) || staff <= 0
      || (service != null && (!Number.isSafeInteger(service) || service <= 0))
      || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < nextClinicDate()
      || clinicDate(`${day}T12:00:00+02:00`) !== day
      || !/^\d{1,3}(?:\.\d{1,2})?$/.test(String(ratePercent))
      || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new EarningsError('Check the team member, date and commission percentage.');
    }
    const result = await db.query(`/* StaffEarnings:add_rule */
      WITH eligible AS (
        SELECT st.id FROM staff st
        WHERE st.id=$2 AND st.status='active' AND st.resource_type='practitioner'
          AND ($3::bigint IS NULL OR EXISTS (
            SELECT 1 FROM staff_services ss JOIN services sv ON sv.id=ss.service_id
             WHERE ss.staff_id=st.id AND ss.service_id=$3 AND sv.status='active'))
      ), inserted AS (
        INSERT INTO workspace_commission_rules
          (staff_id,service_id,effective_from,rate_percent,created_by_admin_id)
        SELECT id,$3,$4::date,$5,$1 FROM eligible
        ON CONFLICT DO NOTHING RETURNING id
      ), audit AS (
        INSERT INTO crm_audit_events(actor_admin_id,action,entity_type,entity_id,metadata)
        SELECT $1,'workspace.commission_rule.create','commission_rule',id,
               jsonb_build_object('staffId',$2,'serviceId',$3,'effectiveFrom',$4,'ratePercent',$5)
          FROM inserted RETURNING id
      ) SELECT id FROM audit`, [adminId, staff, service, day, rate]);
    if (result.rows.length !== 1) throw new EarningsError('This rule already exists, or the service is unavailable for that team member.', 409);
    return { id: result.rows[0].id };
  }
  return { requireOwner, build, addRule };
}

module.exports = { EarningsError, clinicDate, nextClinicDate, isChristelOwner, selectRule, summarize, createWorkspaceStaffEarningsService,
  ...createWorkspaceStaffEarningsService() };
