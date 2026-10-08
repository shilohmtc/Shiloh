'use strict';
const express = require('express');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');
const { createClientTreatmentCreditService, TreatmentCreditError } = require('../services/clientTreatmentCredit');
const { renderTreatmentCreditPage, treatmentCreditClientScript } = require('../presentation/clientTreatmentCreditUx');
const { setWorkspaceClientsSecurityHeaders } = require('./workspaceClients');
function createWorkspaceTreatmentCreditRouter({ env = process.env, sessionService, service = createClientTreatmentCreditService() } = {}) {
  if (!sessionService) throw new Error('Treatment credit requires the existing staff session authority.');
  const router = express.Router();
  router.use((_req, res, next) => { setWorkspaceClientsSecurityHeaders(res); next(); });
  router.use(requireStaffSession({ service: sessionService, env }));
  router.get('/client.js', (_req, res) => res.type('application/javascript').send(treatmentCreditClientScript()));
  router.get('/clients/:clientId', async (req, res, next) => {
    try {
      const model = await service.getClientModel({ adminId: req.staffBrowserSession.adminId, clientId: req.params.clientId });
      const token = await sessionService.rotateCsrfToken(req.staffBrowserSession.sessionId);
      if (!token.ok) return res.sendStatus(401);
      return res.type('html').send(renderTreatmentCreditPage({ model, csrfToken: token.csrfToken }));
    } catch (error) { if (error instanceof TreatmentCreditError) return res.status(error.httpStatus).type('text/plain').send(error.message); return next(error); }
  });
  for (const action of ['issue', 'apply']) router.post(`/${action}`, sameOriginGuard({ env }), csrfGuard({ service: sessionService }), async (req, res, next) => {
    try { return res.status(200).json(await service[action]({ ...req.body, adminId: req.staffBrowserSession.adminId })); }
    catch (error) { if (error instanceof TreatmentCreditError) return res.status(error.httpStatus).json({ error: error.message, code: error.code }); return next(error); }
  });
  return router;
}
module.exports = { createWorkspaceTreatmentCreditRouter };
