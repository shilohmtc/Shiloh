const express = require('express');
const { pool } = require('../db/pool');
const { requireStaffSession, sameOriginGuard, csrfGuard } = require('../middleware/staffBrowserSession');
const { setBookingSecurityHeaders, bookingPrefillFromQuery } = require('./calendarCreateBooking');
const { createCalendarCouplesBookingService } = require('../services/calendarCouplesBooking');
const {
  renderCalendarCouplesBookingPage,
  calendarCouplesBookingClientScript,
} = require('../presentation/calendarCouplesBookingUx');

function errorStatus(error) {
  if (Number.isInteger(error?.httpStatus)) return error.httpStatus;
  if (String(error?.code || '').includes('FORBIDDEN')) return 403;
  if (String(error?.code || '').startsWith('CRM_V2_')) return Number(error?.httpStatus) || 400;
  if (String(error?.code || '').startsWith('CALENDAR_BOOKING_')) return 400;
  if (String(error?.code || '').startsWith('COUPLES_')) return 400;
  return 503;
}

function createCalendarCouplesBookingRouter({
  env = process.env,
  sessionService,
  bookingService = createCalendarCouplesBookingService({ db: pool }),
  renderPage = renderCalendarCouplesBookingPage,
  renderClient = calendarCouplesBookingClientScript,
} = {}) {
  if (!sessionService) throw new Error('Couples booking staff session service is required');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });
  router.use((req, res, next) => { setBookingSecurityHeaders(res); next(); });

  router.get('/', requireSession, async (req, res, next) => {
    try {
      const options = await bookingService.listOptions(req.staffBrowserSession.adminId);
      const prefill = bookingPrefillFromQuery(req.query, options);
      return res.status(200).type('html').send(renderPage({ options, prefill, clientScriptPath: `${req.baseUrl || '/calendar/book/couples'}/client.js` }));
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
      if (errorStatus(error) !== 503) return res.status(404).type('text/plain').send('Not Found');
      return next(error);
    }
  });

  router.post('/client-search', sameOrigin, requireSession, async (req, res, next) => {
    try {
      return res.status(200).json(await bookingService.searchClients(req.staffBrowserSession.adminId, String(req.body?.query || '')));
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 503) return res.status(status).json({ error: error.message, code: error.code });
      return next(error);
    }
  });

  for (const action of ['prepare', 'discard', 'confirm']) {
    router.post(`/${action}`, sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
      try {
        const result = await bookingService[action]({ adminId: req.staffBrowserSession.adminId, ...req.body });
        return res.status(action === 'confirm' ? 201 : 200).json(result);
      } catch (error) {
        const status = errorStatus(error);
        if (status !== 503) return res.status(status).json({ error: error.message, code: error.code });
        return next(error);
      }
    });
  }
  return router;
}

module.exports = { createCalendarCouplesBookingRouter, errorStatus };
