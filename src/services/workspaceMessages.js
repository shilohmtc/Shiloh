const workspaceClients = require('./workspaceClients');
const workspaceClientNotifications = require('./workspaceClientNotifications');
const workspaceCommunicationEvidence = require('./workspaceCommunicationEvidence');

const RECENT_ACTIVITY_LIMIT = 50;

class WorkspaceMessagesError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'WorkspaceMessagesError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function normalizeView(value) {
  const view = String(value || 'all').trim().toLowerCase();
  if (['all', 'attention', 'recent'].includes(view)) return view;
  throw new WorkspaceMessagesError('WORKSPACE_MESSAGES_INVALID_VIEW', 'Messages view is invalid.', 400);
}

function createWorkspaceMessagesService({
  clientAccessService = workspaceClients,
  notificationService = workspaceClientNotifications,
  communicationService = workspaceCommunicationEvidence,
} = {}) {
  if (!clientAccessService || typeof clientAccessService.requireAccess !== 'function') {
    throw new Error('Workspace Messages requires canonical client read authority');
  }
  if (!notificationService || typeof notificationService.resolveAccess !== 'function') {
    throw new Error('Workspace Messages requires canonical client notification authority');
  }
  if (!communicationService || typeof communicationService.listRecent !== 'function') {
    throw new Error('Workspace Messages requires canonical communication evidence');
  }

  async function resolveAccess(adminId) {
    try { return await clientAccessService.resolveAccess(adminId); }
    catch (_error) { return null; }
  }

  async function buildModel({ adminId, view, now = new Date(), activityLimit = RECENT_ACTIVITY_LIMIT } = {}) {
    const authority = await clientAccessService.requireAccess(adminId);
    const selectedView = normalizeView(view);
    let activity = [];
    let activityUnavailable = false;
    try {
      activity = await communicationService.listRecent({
        limit: activityLimit,
        scope: authority.clientScope,
      });
    } catch (_error) {
      activityUnavailable = true;
    }

    let notificationAuthority = null;
    let attention = [];
    let attentionUnavailable = false;
    try {
      notificationAuthority = await notificationService.resolveAccess(adminId);
      if (notificationAuthority) {
        const result = await notificationService.listBookingConfirmationExceptions({ adminId, now });
        attention = result.exceptions || [];
      }
    } catch (_error) {
      attentionUnavailable = true;
    }

    return {
      authority,
      notificationAuthority,
      selectedView,
      attention,
      attentionUnavailable,
      activity,
      activityUnavailable,
      generatedAt: now.toISOString(),
    };
  }

  return { resolveAccess, buildModel };
}

const service = createWorkspaceMessagesService();

module.exports = {
  RECENT_ACTIVITY_LIMIT,
  WorkspaceMessagesError,
  normalizeView,
  createWorkspaceMessagesService,
  ...service,
};
