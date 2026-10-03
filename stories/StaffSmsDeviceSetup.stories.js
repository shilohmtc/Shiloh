import presentation from '../src/presentation/workspaceAccessV2Ux.js';

export default { title: 'Workspace/Staff SMS device setup' };

const principal = {
  id: 19, revision: 'a'.repeat(64), displayName: 'Abigail', active: true, principalLabel: 'Staff',
  businessRole: 'employee_practitioner', calendarScope: 'own', serviceScope: 'own_services',
  preset: { label: 'Practitioner', status: 'current' },
  capabilities: ['appointment:view'],
  capabilityGroups: [{ label: 'Calendar', capabilities: ['appointment:view'] }],
  staff: { status: 'active', resourceType: 'practitioner', businessRole: 'employee_practitioner' },
};

export const ApprovedDeviceSetup = {
  render: () => {
    const html = presentation.renderAccessDetailPage({
      principal, copySources: [], authority: { displayName: 'Christel', operatorAdminId: 1 },
    });
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
    return `<style>${styles}</style>${body}`;
  },
};
