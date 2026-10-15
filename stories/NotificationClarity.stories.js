import messages from '../src/presentation/workspaceMessagesUx.js';
import clients from '../src/presentation/workspaceClientsUx.js';
import fixtures from './fixtures/notificationClarity.js';

function surface(html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}</style><div data-notification-clarity>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</div>`;
}
export default { title: 'Workspace/Notification Clarity', parameters: { layout: 'fullscreen' } };
export const All = { render: () => surface(messages.renderMessagesPage({ ...fixtures.messagesFixture(), selectedView: 'all' })) };
export const Recent = { render: () => surface(messages.renderMessagesPage({ ...fixtures.messagesFixture(), selectedView: 'recent' })) };
export const Attention = { render: () => surface(messages.renderMessagesPage(fixtures.messagesFixture())) };
export const ProfileUnknown = { render: () => surface(clients.renderClientDetailPage(fixtures.profileFixture())) };
export const ProfileUsed = { render: () => surface(clients.renderClientDetailPage(fixtures.profileFixture('Used before', 'Enabled'))) };
export const ProfileSetupNeeded = { render: () => surface(clients.renderClientDetailPage(fixtures.profileFixture('Used before', 'Setup needed'))) };
