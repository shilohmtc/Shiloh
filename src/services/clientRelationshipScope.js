const CLIENT_RELATIONSHIP_TYPES = Object.freeze({
  CLINIC: 'clinic',
  TENANT_STAFF: 'tenant_staff',
});

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function scopeForPrincipal(principal = {}) {
  const role = String(principal.business_role || principal.businessRole || '').trim().toLowerCase();
  const staffId = positiveId(principal.staff_id ?? principal.linkedStaffId);
  if (role === 'tenant_practitioner') {
    if (!staffId) return null;
    return Object.freeze({ kind: CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF, ownerStaffId: staffId });
  }
  return Object.freeze({ kind: CLIENT_RELATIONSHIP_TYPES.CLINIC, ownerStaffId: null });
}

function validClientScope(scope) {
  if (scope?.kind === CLIENT_RELATIONSHIP_TYPES.CLINIC && scope?.ownerStaffId == null) return true;
  return scope?.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF && positiveId(scope?.ownerStaffId) != null;
}

function relationshipPredicate(alias, scope, parameterIndex) {
  if (!validClientScope(scope)) throw new Error('A valid client relationship scope is required');
  if (scope.kind === CLIENT_RELATIONSHIP_TYPES.CLINIC) {
    return {
      sql: `${alias}.relationship_type='clinic' AND ${alias}.owner_staff_id IS NULL`,
      values: [],
      nextParameterIndex: parameterIndex,
    };
  }
  return {
    sql: `${alias}.relationship_type='tenant_staff' AND ${alias}.owner_staff_id=$${parameterIndex}`,
    values: [positiveId(scope.ownerStaffId)],
    nextParameterIndex: parameterIndex + 1,
  };
}

function appointmentScopePredicate(appointmentExpression, scope, parameterIndex) {
  if (!validClientScope(scope)) throw new Error('A valid client relationship scope is required');
  if (scope.kind === CLIENT_RELATIONSHIP_TYPES.TENANT_STAFF) {
    return {
      sql: `EXISTS (
        SELECT 1
          FROM appointment_services scope_aps
          JOIN service_visibility_policies scope_visibility
            ON scope_visibility.service_id=scope_aps.service_id
           AND scope_visibility.visibility_scope='tenant_private'
         WHERE scope_aps.appointment_id=${appointmentExpression}
           AND scope_visibility.owner_staff_id=$${parameterIndex}
      )`,
      values: [positiveId(scope.ownerStaffId)],
      nextParameterIndex: parameterIndex + 1,
    };
  }
  return {
    sql: `(
      NOT EXISTS (
        SELECT 1 FROM appointment_services scope_any
         WHERE scope_any.appointment_id=${appointmentExpression}
      )
      OR EXISTS (
        SELECT 1
          FROM appointment_services scope_aps
          LEFT JOIN service_visibility_policies scope_visibility
            ON scope_visibility.service_id=scope_aps.service_id
           AND scope_visibility.visibility_scope='tenant_private'
         WHERE scope_aps.appointment_id=${appointmentExpression}
           AND scope_visibility.service_id IS NULL
      )
    )`,
    values: [],
    nextParameterIndex: parameterIndex,
  };
}

module.exports = {
  CLIENT_RELATIONSHIP_TYPES,
  positiveId,
  scopeForPrincipal,
  validClientScope,
  relationshipPredicate,
  appointmentScopePredicate,
};
