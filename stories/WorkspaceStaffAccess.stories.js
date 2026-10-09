import capabilityMetadata from '../src/domain/workspaceAccessCapabilities.js';
import accessPresentation from '../src/presentation/workspaceStaffAccessProfilesUx.js';
import staffPresentation from '../src/presentation/workspaceStaffUx.js';
import onboardingPresentation from '../src/presentation/workspaceStaffOnboardingUx.js';

const { renderStaffAccessPage, renderStaffAccessDetail } = accessPresentation;

function productionSurface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.staff-access-story{min-height:100vh}.staff-access-story script{display:none}</style><div class="staff-access-story" data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}

const authority = { displayName: 'Owner' };
const metadata = capabilityMetadata.ACCESS_CAPABILITIES;
function toggles(keys) {
  return keys.map(key => ({ key, ...metadata[key], on: true, group: capabilityMetadata.CAPABILITY_GROUPS.find(group => group.capabilities.includes(key))?.label || 'Other operational access' }));
}
const clinicTeam = {
  id: 21, staffId: 41, displayName: 'Naomi', active: true, profileKey: 'clinic_team_v1', profileLabel: 'Clinic team',
  profileSummary: 'Choose individual access, then save your changes. Existing record boundaries still apply.',
  granularAccess: true, editable: true, revision: 'a'.repeat(64),
  protectedRestrictions: ['Cannot change Clinic Hours.', 'Cannot edit, cancel, reassign or delete another practitioner’s appointments.'],
  toggles: toggles(['appointment:view', 'booking:update', 'client:lookup', 'services:view', 'staff:services:view', 'staff:view', 'reports:view_all', 'schedule:view', 'forms:view', 'forms:clinical_manage']),
};
const ownWorkspace = {
  ...clinicTeam, id: 31, staffId: 51, displayName: 'Synthetic practitioner', profileKey: 'own_workspace_v1', profileLabel: 'Own workspace', revision: 'b'.repeat(64),
  toggles: toggles(['appointment:view', 'appointment:create', 'appointment:adjust_end', 'booking:update', 'calendar:booking:reschedule', 'calendar:booking:cancel', 'client:lookup', 'client:manage', 'services:view', 'services:manage', 'service:pricing', 'staff:services:view', 'schedule:view', 'schedule:availability_manage']),
};
const administrator = { ...clinicTeam, id: 42, staffId: null, profileKey: null, businessRole: 'business_admin', displayName: 'Synthetic Client AI', toggles: toggles(Object.keys(metadata).filter(key => !metadata[key].legacy)), protectedRestrictions: ['Record and practitioner boundaries remain unchanged.'] };

export default {
  title: 'Workspace/Staff access',
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
};

export const AccessOverview = {
  render: () => productionSurface(renderStaffAccessPage({ authority, people: [clinicTeam, { ...clinicTeam, id: 22, displayName: 'ILince' }, { ...clinicTeam, id: 23, displayName: 'Abigail' }, ownWorkspace], otherPeople: [administrator, { ...administrator, id: 43, displayName: 'Shiloh Reception', businessRole: 'booking_operator' }] })),
};

export const ClinicTeam = {
  render: () => productionSurface(renderStaffAccessDetail({ authority, person: clinicTeam })),
};

export const OwnWorkspace = {
  render: () => productionSurface(renderStaffAccessDetail({ authority, person: ownWorkspace })),
};

export const ProtectedAdministrator = {
  render: () => productionSurface(renderStaffAccessDetail({ authority, person: { ...administrator, editable: false, toggles: [], editRestriction: 'Another authorized clinic administrator must change your access, so you cannot lock yourself out.', accessGroups: [{ label: 'Payments', capabilities: ['payment:refund'] }] } })),
};
export const AdministratorAccess = {
  render: () => productionSurface(renderStaffAccessDetail({ authority, person: administrator })),
};
export const ReceptionAccess = {
  render: () => productionSurface(renderStaffAccessDetail({ authority, person: { ...administrator, id: 43, displayName: 'Shiloh Reception', businessRole: 'booking_operator', toggles: administrator.toggles.filter(toggle => !['staff_access:manage', 'staff_auth:reset', 'staff_earnings:manage', 'welcome_vouchers:view_campaign'].includes(toggle.key)) } })),
};

export const AccessOff = {
  render: () => productionSurface(renderStaffAccessDetail({ authority, person: { ...clinicTeam, active: false } })),
};

export const EmptyAccess = {
  render: () => productionSurface(renderStaffAccessPage({ authority, people: [] })),
};

export const StaffProfiles = {
  render: () => {
    const model = { authority, manageAllowed: true, accessManageAllowed: true, status: 'active', offset: 0, pageSize: 40, staff: [{ id: 41, display_name: 'Naomi', status: 'active', business_role: 'employee_practitioner', service_count: 4, client_bookable: true }] };
    return productionSurface(onboardingPresentation.decorateStaffListOnboardingHtml(staffPresentation.renderStaffListPage(model), model));
  },
};

export const StaffDetail = {
  render: () => productionSurface(staffPresentation.renderStaffDetailPage({ authority, manageAllowed: true, accessManageAllowed: true,
    staff: { id: 41, display_name: 'Synthetic practitioner', status: 'active', resource_type: 'practitioner', scheduling_type: 'regular', client_bookable: true, revision: '2026-09-30T10:00:00.000Z' },
    services: [{ name: 'Sports Massage' }], access: null,
  })),
};
