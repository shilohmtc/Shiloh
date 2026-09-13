const ORDINARY_PRACTITIONER_ROLES = new Set(['tenant_practitioner', 'employee_practitioner']);
const BUSINESS_WIDE_ROLES = new Set(['owner', 'business_admin', 'booking_operator']);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizedRole(value) {
  return String(value || '').trim().toLowerCase();
}

function permissions(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isOrdinaryPractitioner(principal = {}) {
  const linkedStaffId = positiveId(principal.staff_id ?? principal.linkedStaffId);
  const businessRole = normalizedRole(principal.business_role ?? principal.businessRole);
  const resourceType = normalizedRole(principal.staff_resource_type ?? principal.resource_type ?? principal.staffResourceType);
  const staffStatus = normalizedRole(principal.staff_status ?? principal.staffStatus);
  return linkedStaffId != null
    && ORDINARY_PRACTITIONER_ROLES.has(businessRole)
    && (!resourceType || resourceType === 'practitioner')
    && (!staffStatus || staffStatus === 'active');
}

function isBusinessWideRole(principal = {}) {
  return BUSINESS_WIDE_ROLES.has(normalizedRole(principal.business_role ?? principal.businessRole));
}

module.exports = {
  ORDINARY_PRACTITIONER_ROLES,
  BUSINESS_WIDE_ROLES,
  positiveId,
  normalizedRole,
  permissions,
  isOrdinaryPractitioner,
  isBusinessWideRole,
};
