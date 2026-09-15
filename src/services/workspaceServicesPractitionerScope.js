const { pool } = require('../db/pool');
const base = require('./workspaceServices');
const { serviceVisibilityAllows } = require('./calendarAuthorization');
const { isOrdinaryPractitioner, positiveId } = require('./practitionerWorkspaceScope');

function createWorkspaceServicesPractitionerScopeService({ db = pool, service = base } = {}) {
  async function principal(adminId) {
    const id = positiveId(adminId);
    if (!id) return null;
    const result = await db.query(
      `/* practitionerWorkspaceScope:services-principal */
       SELECT a.id, a.staff_id, a.business_role, a.permissions, a.active AS admin_active,
              s.status AS staff_status, s.resource_type AS staff_resource_type
         FROM staff_admin_accounts a
         LEFT JOIN staff s ON s.id=a.staff_id
        WHERE a.id=$1 AND a.active=TRUE
        LIMIT 2`,
      [id],
    );
    return result.rows.length === 1 ? result.rows[0] : null;
  }

  async function ordinaryPrincipal(adminId) {
    const row = await principal(adminId);
    return isOrdinaryPractitioner(row) ? row : null;
  }

  async function serviceScope(adminId, serviceId) {
    const practitioner = await ordinaryPrincipal(adminId);
    if (!practitioner) return { ordinary: false, practitioner: null, assigned: false, privateOwned: false };
    const id = positiveId(serviceId);
    if (!id) throw new base.WorkspaceServicesError('WORKSPACE_SERVICES_INVALID_ID', 'Service reference is invalid.', 400);
    const result = await db.query(
      `/* practitionerWorkspaceScope:service-scope */
       SELECT svc.id,
              visibility.owner_staff_id AS private_owner_staff_id,
              EXISTS(
                SELECT 1 FROM staff_services ss
                 WHERE ss.service_id=svc.id AND ss.staff_id=$2
              ) AS assigned_to_self
         FROM services svc
         LEFT JOIN service_visibility_policies visibility ON visibility.service_id=svc.id
        WHERE svc.id=$1
        LIMIT 1`,
      [id, practitioner.staff_id],
    );
    const row = result.rows[0];
    if (!row) throw new base.WorkspaceServicesError('WORKSPACE_SERVICE_NOT_FOUND', 'Service was not found.', 404);
    const authority = await service.requireAccess(adminId);
    if (!serviceVisibilityAllows(authority, row.private_owner_staff_id)) {
      throw new base.WorkspaceServicesError('WORKSPACE_SERVICE_NOT_FOUND', 'Service was not found.', 404);
    }
    const privateOwned = positiveId(row.private_owner_staff_id) === positiveId(practitioner.staff_id);
    const assigned = row.assigned_to_self === true;
    if (!assigned && !privateOwned) {
      throw new base.WorkspaceServicesError('WORKSPACE_SERVICE_NOT_FOUND', 'Service was not found.', 404);
    }
    return { ordinary: true, practitioner, assigned, privateOwned };
  }

  async function listServices({ adminId, q, status, offset } = {}) {
    const practitioner = await ordinaryPrincipal(adminId);
    if (!practitioner) return service.listServices({ adminId, q, status, offset });
    const authority = await service.requireAccess(adminId);
    const search = base.normalizeSearch(q);
    const serviceStatus = base.normalizeStatus(status);
    const safeOffset = base.normalizeOffset(offset);
    const values = [positiveId(practitioner.staff_id)];
    const where = [
      `(EXISTS (
          SELECT 1 FROM staff_services self_ss
           WHERE self_ss.service_id=svc.id AND self_ss.staff_id=$1
        ) OR visibility.owner_staff_id=$1)`,
    ];
    if (serviceStatus) {
      values.push(serviceStatus);
      where.push(`svc.status=$${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      where.push(`svc.name ILIKE $${values.length}`);
    }
    values.push(base.SERVICES_LIST_PAGE_SIZE + 1);
    const limitParam = `$${values.length}`;
    values.push(safeOffset);
    const offsetParam = `$${values.length}`;
    const result = await db.query(
      `/* practitionerWorkspaceScope:services-list */
       SELECT svc.id, svc.name, svc.duration_minutes,
              svc.processing_time_minutes, svc.extra_time_minutes,
              svc.variable_price, svc.price, svc.display_price, svc.status,
              sc.name AS category_name, visibility.owner_staff_id AS private_owner_staff_id,
              CASE WHEN EXISTS (
                SELECT 1 FROM staff_services self_ss
                 WHERE self_ss.service_id=svc.id AND self_ss.staff_id=$1
              ) THEN 1 ELSE 0 END AS assigned_staff_count,
              CASE WHEN EXISTS (
                SELECT 1
                  FROM staff_services self_ss
                  JOIN staff self_st ON self_st.id=self_ss.staff_id
                 WHERE self_ss.service_id=svc.id
                   AND self_ss.staff_id=$1
                   AND self_st.status='active'
                   AND self_st.client_bookable=TRUE
              ) THEN 1 ELSE 0 END AS client_bookable_staff_count
         FROM services svc
         LEFT JOIN service_categories sc ON sc.id=svc.category_id
         LEFT JOIN service_visibility_policies visibility ON visibility.service_id=svc.id
        WHERE ${where.join(' AND ')}
        ORDER BY CASE WHEN svc.status='active' THEN 0 ELSE 1 END,
                 sc.display_order NULLS LAST,
                 svc.display_order,
                 LOWER(svc.name), svc.id
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    );
    const visibleRows = result.rows.filter(row => serviceVisibilityAllows(authority, row.private_owner_staff_id));
    const rows = visibleRows.slice(0, base.SERVICES_LIST_PAGE_SIZE).map(row => {
      const { private_owner_staff_id: privateOwnerStaffId, ...serviceRow } = row;
      return {
        ...serviceRow,
        total_minutes: base.totalServiceMinutes(serviceRow),
        booking_eligibility: base.projectBookingEligibility(serviceRow),
        manageUiAllowed: positiveId(privateOwnerStaffId) === positiveId(practitioner.staff_id),
      };
    });
    return {
      authority,
      services: rows,
      hasMore: visibleRows.length > base.SERVICES_LIST_PAGE_SIZE,
      offset: safeOffset,
      pageSize: base.SERVICES_LIST_PAGE_SIZE,
      query: search,
      status: serviceStatus,
      practitionerScoped: true,
    };
  }

  async function getServiceDetail({ adminId, serviceId } = {}) {
    const scope = await serviceScope(adminId, serviceId);
    const model = await service.getServiceDetail({ adminId, serviceId });
    if (!scope.ordinary) return model;
    const selfId = positiveId(scope.practitioner.staff_id);
    const assignedStaff = (model.assignedStaff || []).filter(row => positiveId(row.id) === selfId);
    const practitioners = (model.practitioners || []).filter(row => positiveId(row.id) === selfId);
    return {
      ...model,
      assignedStaff,
      practitioners,
      bookingEligibility: base.projectBookingEligibility(model.service, assignedStaff),
      practitionerScoped: true,
      manageUiAllowed: scope.privateOwned && Boolean(await service.resolveManageAccess(adminId)),
      mutationScope: {
        canonicalFields: scope.privateOwned,
        selfAssignmentOnly: true,
        staffId: selfId,
      },
    };
  }

  async function requirePrivateOwnedMutation(adminId, serviceId) {
    const scope = await serviceScope(adminId, serviceId);
    if (!scope.ordinary) return null;
    await service.requireManageAccess(adminId);
    if (!scope.privateOwned) {
      throw new base.WorkspaceServicesError(
        'WORKSPACE_SERVICES_SHARED_MUTATION_FORBIDDEN',
        'Shared catalogue fields cannot be changed from practitioner scope.',
        403,
      );
    }
    return scope;
  }

  async function updateService(input = {}) {
    await requirePrivateOwnedMutation(input.adminId, input.serviceId);
    return service.updateService(input);
  }

  async function setServiceStatus(input = {}) {
    await requirePrivateOwnedMutation(input.adminId, input.serviceId);
    return service.setServiceStatus(input);
  }

  async function requireSelfAssignmentMutation(adminId, serviceId, staffId) {
    const scope = await serviceScope(adminId, serviceId);
    if (!scope.ordinary) return null;
    await service.requireManageAccess(adminId);
    if (positiveId(staffId) !== positiveId(scope.practitioner.staff_id)) {
      throw new base.WorkspaceServicesError(
        'WORKSPACE_SERVICES_OTHER_PRACTITIONER_FORBIDDEN',
        'Practitioner scope cannot change another practitioner assignment.',
        403,
      );
    }
    return scope;
  }

  async function assignPractitioner(input = {}) {
    await requireSelfAssignmentMutation(input.adminId, input.serviceId, input.staffId);
    return service.assignPractitioner(input);
  }

  async function unassignPractitioner(input = {}) {
    await requireSelfAssignmentMutation(input.adminId, input.serviceId, input.staffId);
    return service.unassignPractitioner(input);
  }

  return {
    ...service,
    resolveAccess: service.resolveAccess,
    resolveManageAccess: service.resolveManageAccess,
    requireAccess: service.requireAccess,
    requireManageAccess: service.requireManageAccess,
    listServices,
    getServiceDetail,
    updateService,
    setServiceStatus,
    assignPractitioner,
    unassignPractitioner,
    serviceScope,
  };
}

const scoped = createWorkspaceServicesPractitionerScopeService();
module.exports = {
  createWorkspaceServicesPractitionerScopeService,
  ...scoped,
};
