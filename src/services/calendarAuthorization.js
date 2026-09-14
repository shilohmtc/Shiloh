const CALENDAR_CAPABILITIES = Object.freeze({
  VIEW: 'appointment:view',
  BOOKING_CREATE: 'appointment:create',
  RECORD_PAST: 'appointment:record_past',
  ADJUST_END: 'appointment:adjust_end',
  CLIENT_LOOKUP: 'client:lookup',
  BOOKING_RESCHEDULE: 'calendar:booking:reschedule',
  BOOKING_CANCEL: 'calendar:booking:cancel',
  BOOKING_REASSIGN: 'calendar:booking:reassign',
  COUPLES_DISCOUNT: 'appointment:couples:discount',
  SCHEDULE_MANAGE: 'schedule:manage',
});

const RETROSPECTIVE_CLIENT_IDS_KEY = 'appointment:record_past:crm_v2_client_ids';

const CALENDAR_OPERATIONS = Object.freeze([
  'appointment:reschedule',
  'appointment:cancel',
  'appointment:reassign',
  'calendar_block:manage',
  'operational_leave:manage',
  'working_schedule:manage',
]);

const OPERATION_CAPABILITIES = Object.freeze({
  'appointment:reschedule': CALENDAR_CAPABILITIES.BOOKING_RESCHEDULE,
  'appointment:cancel': CALENDAR_CAPABILITIES.BOOKING_CANCEL,
  'appointment:reassign': CALENDAR_CAPABILITIES.BOOKING_REASSIGN,
  'calendar_block:manage': CALENDAR_CAPABILITIES.SCHEDULE_MANAGE,
  'operational_leave:manage': CALENDAR_CAPABILITIES.SCHEDULE_MANAGE,
  'working_schedule:manage': CALENDAR_CAPABILITIES.SCHEDULE_MANAGE,
});

const CALENDAR_SCOPES = new Set(['all_business', 'own_services', 'own_appointments', 'own']);
const SERVICE_SCOPES = new Set(['all_services', 'own_services']);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function permissionSet(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function hasCapability(authority, capability) {
  return authority?.capabilities?.includes(capability) === true;
}

function conditionedClientIds(permissions) {
  if (!Object.prototype.hasOwnProperty.call(permissions, RETROSPECTIVE_CLIENT_IDS_KEY)) return null;
  const raw = permissions[RETROSPECTIVE_CLIENT_IDS_KEY];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(positiveId).filter(Boolean))].sort((a, b) => a - b);
}

function evaluateCalendarAuthority(admin = {}, { allowedServiceIds = [] } = {}) {
  const operatorAdminId = positiveId(admin.id);
  if (!operatorAdminId || admin.admin_active !== true) return null;
  const calendarScope = String(admin.calendar_scope || '').trim().toLowerCase();
  const serviceScope = String(admin.service_scope || '').trim().toLowerCase();
  const businessRole = String(admin.business_role || '').trim().toLowerCase();
  if (!CALENDAR_SCOPES.has(calendarScope) || !SERVICE_SCOPES.has(serviceScope)) return null;
  if (calendarScope !== 'all_business' && serviceScope !== 'own_services') return null;

  const linkedStaffId = positiveId(admin.staff_id);
  const linkedStaffRequired = calendarScope !== 'all_business' || serviceScope === 'own_services';
  if (linkedStaffRequired && (!linkedStaffId || admin.staff_status !== 'active')) return null;
  if (linkedStaffId && admin.staff_status !== 'active') return null;

  const permissions = permissionSet(admin.permissions);
  const capabilities = Object.values(CALENDAR_CAPABILITIES).filter((capability) => permissions[capability] === true);
  const scopedServiceIds = serviceScope === 'own_services'
    ? [...new Set(allowedServiceIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b)
    : null;

  return {
    key: 'calendar_capability_scope_v1',
    operatorAdminId,
    linkedStaffId,
    businessRole,
    calendarScope,
    serviceScope,
    capabilities,
    allowedServiceIds: scopedServiceIds,
    retrospectiveClientIds: conditionedClientIds(permissions),
  };
}

function operationsForAuthority(authority) {
  return CALENDAR_OPERATIONS.filter((operation) => hasCapability(authority, OPERATION_CAPABILITIES[operation]));
}

function hasFullAppointmentEditAuthority(authority) {
  if (!authority || authority.calendarScope !== 'all_business' || authority.serviceScope !== 'all_services') return false;
  const operations = new Set(operationsForAuthority(authority));
  return hasCapability(authority, CALENDAR_CAPABILITIES.VIEW)
    && hasCapability(authority, CALENDAR_CAPABILITIES.ADJUST_END)
    && operations.has('appointment:reschedule')
    && operations.has('appointment:cancel')
    && operations.has('appointment:reassign');
}

function serviceScopeAllows(authority, serviceIds = []) {
  if (!authority) return false;
  if (authority.serviceScope === 'all_services') return true;
  if (authority.serviceScope !== 'own_services') return false;
  const ids = serviceIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!ids.length || ids.length !== serviceIds.length) return false;
  const allowed = new Set(authority.allowedServiceIds || []);
  return ids.every((id) => allowed.has(id));
}

function serviceVisibilityAllows(authority, privateOwnerStaffId) {
  if (!authority) return false;
  const ownerStaffId = positiveId(privateOwnerStaffId);
  if (!ownerStaffId) return true;
  if (authority.businessRole === 'booking_operator') return true;
  return authority.businessRole === 'tenant_practitioner'
    && positiveId(authority.linkedStaffId) === ownerStaffId;
}

function calendarScopeAllowsBookingTarget(authority, staffId) {
  const targetStaffId = positiveId(staffId);
  if (!authority || !targetStaffId) return false;
  if (authority.calendarScope === 'all_business' || authority.calendarScope === 'own_services') return true;
  if (authority.calendarScope === 'own_appointments' || authority.calendarScope === 'own') {
    return targetStaffId === authority.linkedStaffId;
  }
  return false;
}

function allowsBookingTarget(authority, { staffId, serviceId, privateOwnerStaffId = null } = {}) {
  return hasCapability(authority, CALENDAR_CAPABILITIES.BOOKING_CREATE)
    && hasCapability(authority, CALENDAR_CAPABILITIES.CLIENT_LOOKUP)
    && calendarScopeAllowsBookingTarget(authority, staffId)
    && serviceScopeAllows(authority, [serviceId])
    && serviceVisibilityAllows(authority, privateOwnerStaffId);
}

function retrospectiveClientAllows(authority, clientId) {
  if (!authority) return false;
  if (authority.retrospectiveClientIds == null) return positiveId(clientId) != null;
  const targetClientId = positiveId(clientId);
  return targetClientId != null && authority.retrospectiveClientIds.includes(targetClientId);
}

function allowsRetrospectiveBookingTarget(authority, {
  clientId,
  staffId,
  serviceId,
  privateOwnerStaffId = null,
} = {}) {
  return hasCapability(authority, CALENDAR_CAPABILITIES.BOOKING_CREATE)
    && hasCapability(authority, CALENDAR_CAPABILITIES.RECORD_PAST)
    && retrospectiveClientAllows(authority, clientId)
    && calendarScopeAllowsBookingTarget(authority, staffId)
    && serviceScopeAllows(authority, [serviceId])
    && serviceVisibilityAllows(authority, privateOwnerStaffId);
}

function allowsAppointmentTarget(authority, { staffIds = [], serviceIds = [] } = {}) {
  if (!authority || !serviceScopeAllows(authority, serviceIds)) return false;
  const assigned = staffIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!assigned.length || assigned.length !== staffIds.length) return false;
  if (authority.calendarScope === 'all_business' || authority.calendarScope === 'own_services') return true;
  if (authority.calendarScope === 'own_appointments' || authority.calendarScope === 'own') {
    return assigned.includes(authority.linkedStaffId);
  }
  return false;
}

function allowsStaffTarget(authority, staffId) {
  const targetStaffId = positiveId(staffId);
  if (!authority || !targetStaffId) return false;
  if (authority.calendarScope === 'all_business') return true;
  return targetStaffId === authority.linkedStaffId;
}

function allowsReassignmentTarget(authority, { appointment, destinationStaffId } = {}) {
  if (!allowsAppointmentTarget(authority, appointment)) return false;
  if (authority.calendarScope === 'all_business' || authority.calendarScope === 'own_services') {
    return positiveId(destinationStaffId) != null;
  }
  return positiveId(destinationStaffId) === authority.linkedStaffId;
}

async function resolveCalendarAuthority(queryable, adminId) {
  if (!queryable || typeof queryable.query !== 'function') throw new Error('Calendar authorization requires a queryable database.');
  const id = positiveId(adminId);
  if (!id) return null;
  const result = await queryable.query(
    `/* calendarAuthorization:principal */
     SELECT a.id, a.staff_id, a.display_name, a.role, a.business_role,
            a.calendar_scope, a.service_scope, a.permissions,
            a.active AS admin_active, s.status AS staff_status
       FROM staff_admin_accounts a
       LEFT JOIN staff s ON s.id=a.staff_id
      WHERE a.id=$1 AND a.active=TRUE
      LIMIT 1`,
    [id]
  );
  const admin = result.rows[0] || null;
  if (!admin) return null;

  let allowedServiceIds = [];
  if (admin.service_scope === 'own_services') {
    const staffId = positiveId(admin.staff_id);
    if (!staffId || admin.staff_status !== 'active') return null;
    const services = await queryable.query(
      `/* calendarAuthorization:services */
       SELECT ss.service_id
         FROM staff_services ss
         JOIN services sv ON sv.id=ss.service_id AND sv.status='active'
        WHERE ss.staff_id=$1
        ORDER BY ss.service_id`,
      [staffId]
    );
    allowedServiceIds = services.rows.map((row) => Number(row.service_id));
  }

  const calendarAuthority = evaluateCalendarAuthority(admin, { allowedServiceIds });
  return calendarAuthority ? { ...admin, calendarAuthority } : null;
}

module.exports = {
  CALENDAR_CAPABILITIES,
  RETROSPECTIVE_CLIENT_IDS_KEY,
  CALENDAR_OPERATIONS,
  OPERATION_CAPABILITIES,
  evaluateCalendarAuthority,
  resolveCalendarAuthority,
  hasCapability,
  operationsForAuthority,
  hasFullAppointmentEditAuthority,
  serviceScopeAllows,
  serviceVisibilityAllows,
  calendarScopeAllowsBookingTarget,
  retrospectiveClientAllows,
  allowsBookingTarget,
  allowsRetrospectiveBookingTarget,
  allowsAppointmentTarget,
  allowsStaffTarget,
  allowsReassignmentTarget,
};
