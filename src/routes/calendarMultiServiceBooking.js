const express = require('express');
const { pool } = require('../db/pool');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');
const { setBookingSecurityHeaders, bookingPrefillFromQuery } = require('./calendarCreateBooking');
const { createCalendarMultiServiceBookingService } = require('../services/calendarMultiServiceBooking');
const {
  renderCalendarMultiServiceBookingPage,
  calendarMultiServiceBookingClientScript,
} = require('../presentation/calendarMultiServiceBookingUx');

function errorStatus(error) {
  if (Number.isInteger(error?.httpStatus)) return error.httpStatus;
  if (String(error?.code || '').includes('FORBIDDEN')) return 403;
  if (String(error?.code || '').startsWith('CRM_V2_')) return Number(error?.httpStatus) || 400;
  if (String(error?.code || '').startsWith('MULTI_SERVICE_')) return 400;
  return 503;
}

function createCalendarMultiServiceBookingRouter({
  env = process.env,
  sessionService,
  bookingService = createCalendarMultiServiceBookingService({ db: pool }),
  renderPage = renderCalendarMultiServiceBookingPage,
  renderClient = calendarMultiServiceBookingClientScript,
} = {}) {
  if (!sessionService) throw new Error('Multiple-treatment booking staff session service is required');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });
  router.use((req, res, next) => { setBookingSecurityHeaders(res); next(); });

  router.get('/', requireSession, async (req, res, next) => {
    try {
      const options = await bookingService.listOptions(req.staffBrowserSession.adminId);
      const prefill = bookingPrefillFromQuery(req.query, options);
      return res.status(200).type('html').send(renderPage({
        options,
        prefill,
        clientScriptPath: `${req.baseUrl || '/calendar/book/multiple'}/client.js`,
      }));
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 503) return res.status(status).type('text/plain').send(error.message);
      return next(error);
    }
  });

  router.get('/client.js', requireSession, async (req, res, next) => {
    try {
      await bookingService.resolveOperator(req.staffBrowserSession.adminId);
      return res.status(200).type('application/javascript').send(renderClient());
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 503) return res.status(status).type('text/plain').send('Not Found');
      return next(error);
    }
  });

  router.post('/client-search', sameOrigin, requireSession, async (req, res, next) => {
    try {
      return res.status(200).json(await bookingService.searchClients(
        req.staffBrowserSession.adminId,
        req.body?.query
      ));
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 503) return res.status(status).json({ error: error.message, code: error.code, requestId: req.id });
      return next(error);
    }
  });

  router.post('/prepare', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      return res.status(200).json(await bookingService.prepare({
        adminId: req.staffBrowserSession.adminId,
        clientId: req.body?.clientId,
        treatments: req.body?.treatments,
        date: req.body?.date,
        notes: req.body?.notes,
      }));
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 503) return res.status(status).json({ error: error.message, code: error.code, requestId: req.id });
      return next(error);
    }
  });

  router.post('/discard', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      return res.status(200).json(await bookingService.discard({ adminId: req.staffBrowserSession.adminId }));
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 503) return res.status(status).json({ error: error.message, code: error.code, requestId: req.id });
      return next(error);
    }
  });

  router.post('/confirm', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await bookingService.confirm({ adminId: req.staffBrowserSession.adminId });
      return res.status(201).json(result);
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 503) return res.status(status).json({ error: error.message, code: error.code, requestId: req.id });
      return next(error);
    }
  });
  return router;
}

module.exports = { createCalendarMultiServiceBookingRouter, errorStatus };
