import clients from '../src/presentation/workspaceClientsUx.js';
import presentation from '../src/presentation/workspaceMessagesUx.js';

// Fabricated records only. These stories never query or mutate clinic data.
const change = { id: 901, eventKey: 'appointment-time:12:901', clientId: 9, appointmentId: 12,
  clientName: 'Example Client', label: 'Appointment update', status: 'uncertain',
  statusLabel: 'Send status uncertain', startsAt: '2026-11-10T09:00:00Z', updatedAt: '2026-09-01T08:00:00Z',
  nextAction: 'The phone-alert outcome is uncertain.' };
const model = { authority: { displayName: 'Example Reception' }, notificationAuthority: {}, selectedView: 'all',
  changeAttention: [change], attention: [], activity: [
    { ...change, label: 'Appointment updated', status: 'available', statusLabel: 'Available in My Shiloh', occurredAt: change.updatedAt },
    { eventKey: 'appointment-reminder:12:902', clientId: 9, clientName: 'Example Client', appointmentId: 12, label: 'Appointment reminder', status: 'available', statusLabel: 'Available in My Shiloh', occurredAt: '2026-11-03T10:00:00Z' },
  ] };
const navigation = { clientsHref: '/calendar/clients', messagesHref: '/calendar/messages', vouchersHref: '/calendar/vouchers', rewardsHref: '/calendar/rewards', formsHref: '/calendar/forms' };
function surface(overrides = {}, nav = navigation) {
  const html = presentation.renderMessagesPage({ ...model, ...overrides }, { navigation: nav });
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  return `<style>${css}</style>${body}`;
}
export default { title: 'Workspace/Client Services', parameters: { layout: 'fullscreen' } };
export const Activity = { render: () => surface() };
export const NeedsAttention = { render: () => surface({ selectedView: 'attention' }) };
export const LookupOnly = { render: () => surface({ notificationAuthority: null, changeAttention: [], attention: [] }, { messagesHref: '/calendar/messages' }) };
export const Unavailable = { render: () => surface({ activity: [], attention: [], changeAttention: [], activityUnavailable: true, changeAttentionUnavailable: true, attentionUnavailable: true }) };

export const Directory = { render: () => {
  const html = clients.renderClientListPage({ authority: { displayName: 'Example Reception' }, clients: [], offset: 0, pageSize: 24 }, { navigation });
  return `<style>${[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n')}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '')}`;
} };
export const DirectoryPermissions = { render: () => {
  const html = clients.renderClientManagementPage({}, {displayName:'Example Practitioner'});
  return `<style>${[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n')}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '')}`;
} };

export const ToolsOnly = { render: () => { const html=clients.renderClientManagementPage(navigation,{displayName:'Example Reception'});return `<style>${[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n')}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1]}`; } };
