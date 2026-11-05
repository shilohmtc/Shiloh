const express = require('express');
const workspaceMessages = require('../services/workspaceMessages');
const {
  renderMessagesPage,
  renderMessagesUnavailablePage,
} = require('../presentation/workspaceMessagesUx');
const { requireStaffSession } = require('../middleware/staffBrowserSession');
const {
  isWorkspaceOperationalEnabled,
  setWorkspaceOperationalSecurityHeaders,
} = require('./workspaceOperational');

function messagesSafeError(error) {
  const status = Number(error?.httpStatus) || 503;
  if (status === 400) return { status, message: 'The requested Messages view is invalid.' };
  if (status === 403) return { status, message: 'Your authenticated Shiloh access does not permit client communication activity.' };
  return { status: 503, message: 'Canonical communication evidence is temporarily unavailable.' };
}

function createWorkspaceMessagesRouter({
  env = process.env,
  sessionService,
  service = workspaceMessages,
  renderPage = renderMessagesPage,
  renderUnavailable = renderMessagesUnavailablePage,
  staffAccessPath = '/calendar/staff',
} = {}) {
  if (!sessionService) throw new Error('Workspace Messages requires the existing staff browser session service');
  const router = express.Router();
  router.use((req, res, next) => {
    setWorkspaceOperationalSecurityHeaders(res);
    if (!isWorkspaceOperationalEnabled(env)) return res.sendStatus(404);
    return next();
  });
  router.use(requireStaffSession({ service: sessionService, env, humanNavigationSigninPath: staffAccessPath }));
  router.get('/', async (req, res) => {
    try {
      const model = await service.buildModel({
        adminId: req.staffBrowserSession?.adminId,
        view: req.query?.view,
      });
      return res.status(200).type('html').send(renderPage(model, {
        staffAccessScriptPath: `${staffAccessPath}/client.js`,
      }));
    } catch (error) {
      const safe = messagesSafeError(error);
      return res.status(safe.status).type('html').send(renderUnavailable({ message: safe.message }));
    }
  });
  return router;
}

module.exports = { messagesSafeError, createWorkspaceMessagesRouter };
