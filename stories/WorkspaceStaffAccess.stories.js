import accessPresentation from '../src/presentation/workspaceStaffAccessProfilesUx.js';

const { renderStaffAccessPage, renderStaffAccessDetail } = accessPresentation;

function productionSurface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}.staff-access-story{min-height:100vh}.staff-access-story script{display:none}</style><div class="staff-access-story" data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}

const authority = { displayName: 'Owner' };
const clinicTeam = {
  id: 21,
  staffId: 41,
  displayName: 'Naomi',
  active: true,
  profileKey: 'clinic_team_v1',
  profileLabel: 'Clinic team',
  profileSummary: 'Can see the clinic Workspace and finish their own visits. Clinic-wide management stays protected.',
  protectedRestrictions: [
    'Cannot change Clinic Hours.',
    'Cannot edit, cancel, reassign or delete another practitioner’s appointments.',
    'Cannot change client, service or staff records.',
  ],
  editable: true,
  revision: 'a'.repeat(64),
  toggles: [{ key: 'finish_own_appointments', label: 'Complete or mark my appointments no-show', description: 'Lets this team member finish only appointments that belong to them.', on: true }],
};
const ownWorkspace = {
  id: 31,
  staffId: 51,
  displayName: 'Marietjie',
  active: true,
  profileKey: 'own_workspace_v1',
  profileLabel: 'Own workspace',
  profileSummary: 'Can fully manage their own work while clinic-wide records and other practitioners stay protected.',
  protectedRestrictions: [
    'Cannot change Clinic Hours.',
    'Cannot edit, cancel, reassign or delete another practitioner’s appointments.',
    'Cannot access clinic-only client relationships.',
    'Cannot create services or change staff/access settings.',
  ],
  editable: true,
  revision: 'b'.repeat(64),
  toggles: [
    { key: 'manage_own_appointments', label: 'Manage my appointments', description: 'Create, reschedule, cancel and adjust only appointments inside this workspace boundary.', on: true },
    { key: 'finish_own_appointments', label: 'Complete or mark my appointments no-show', description: 'Finish only appointments assigned to this practitioner.', on: true },
    { key: 'manage_my_clients', label: 'Manage my clients', description: 'Add and update this practitioner’s own client relationships.', on: true },
    { key: 'manage_my_services', label: 'Manage my services', description: 'Manage only services assigned and permitted to this practitioner.', on: true },
    { key: 'view_clinic_hours', label: 'View clinic hours', description: 'See clinic and booking hours without permission to change them.', on: true },
  ],
};

export default {
  title: 'Workspace/Staff access',
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
};

export const AccessOverview = {
  render: () => productionSurface(renderStaffAccessPage({ authority, people: [clinicTeam, { ...clinicTeam, id: 22, displayName: 'ILince' }, { ...clinicTeam, id: 23, displayName: 'Abigail' }, ownWorkspace] })),
};

export const ClinicTeam = {
  render: () => productionSurface(renderStaffAccessDetail({ authority, person: clinicTeam })),
};

export const OwnWorkspace = {
  render: () => productionSurface(renderStaffAccessDetail({ authority, person: ownWorkspace })),
};
