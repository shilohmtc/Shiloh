const express = require('express');
const { pool } = require('../db/pool');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');
const {
  createCalendarOperationalMutationService,
} = require('../services/calendarOperationalMutations');
const {
  calendarOperationalMutationsClientScript,
} = require('../presentation/calendarOperationalMutationsUx');
const workspaceClientNotifications = require('../services/workspaceClientNotifications');
const customerChangeNotifications = require('../services/customerChangeNotification');
const { createWorkspaceAppointmentNotesService } = require('../services/workspaceAppointmentNotes');
const { calendarManageAppointmentNotesClientScript } = require('../presentation/calendarAppointmentNotesUx');
const { calendarAppointmentCompactEditorClientScript } = require('../presentation/calendarAppointmentCompactEditorUx');
const logger = require('../lib/logger');

function setOperationalSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function statusForOperationalError(error) {
  const code = String(error?.code || '');
  if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 503) return error.httpStatus;
  if (code === 'CALENDAR_OPERATION_FORBIDDEN') return 403;
  if (code === 'WORKSPACE_CLIENT_NOTIFY_FORBIDDEN') return 403;
  if (code.startsWith('WORKSPACE_CLIENT_NOTIFY_') && code.endsWith('_NOT_FOUND')) return 404;
  if (code.startsWith('WORKSPACE_CLIENT_NOTIFY_') && (code.includes('ALREADY') || code.includes('NOT_SENDABLE'))) return 409;
  if (code.startsWith('WORKSPACE_CLIENT_NOTIFY_')) return 400;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (
    code.includes('STALE')
    || code.includes('CONFLICT')
    || code.includes('MAPPING')
    || code.includes('AMBIGUOUS')
    || code.includes('UNAVAILABLE')
    || code.includes('FINAL')
    || code.includes('DUPLICATE')
    || code.includes('IDEMPOTENCY')
  ) return 409;
  if (code.startsWith('CALENDAR_OPERATION_')) return 400;
  return 503;
}

function sendOperationalError(error, req, res, next) {
  const status = statusForOperationalError(error);
  if (status === 503) return next(error);
  return res.status(status).json({
    error: error.message,
    code: error.code,
    details: error.details || undefined,
    requestId: req.id,
  });
}

function createCalendarOperationalMutationRouter({
  env = process.env,
  sessionService,
  mutationService = createCalendarOperationalMutationService({ db: pool }),
  notificationService = workspaceClientNotifications,
  customerChangeNotificationService = customerChangeNotifications,
  notesService = createWorkspaceAppointmentNotesService({ db: pool }),
  renderClient = calendarOperationalMutationsClientScript,
  renderNotesClient = calendarManageAppointmentNotesClientScript,
  renderCompactEditorClient = calendarAppointmentCompactEditorClientScript,
} = {}) {
  if (!sessionService) throw new Error('Calendar operational mutations require the staff session service.');
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });
  const requireCapability = async (req, res, next) => {
    try {
      req.calendarMutationOperator = await mutationService.resolveOperator(req.staffBrowserSession.adminId);
      return next();
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  };
  const requireNotificationCapability = async (req, res, next) => {
    try {
      req.clientNotificationOperator = await notificationService.requireAccess(req.staffBrowserSession.adminId);
      return next();
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  };
  const requireAnyActionCapability = async (req, res, next) => {
    try {
      req.calendarMutationOperator = await mutationService.resolveOperator(req.staffBrowserSession.adminId);
      return next();
    } catch (_mutationError) {
      return requireNotificationCapability(req, res, next);
    }
  };
  const mutationChain = [sameOrigin, requireSession, requireCsrf, requireCapability];

  router.use((_req, res, next) => {
    setOperationalSecurityHeaders(res);
    return next();
  });

  router.get('/capability', requireSession, requireCapability, (req, res) => res.status(200).json({
    capability: req.calendarMutationOperator.mutationCapability,
  }));

  router.get('/client.js', requireSession, requireAnyActionCapability, (_req, res) => {
    return res.status(200).type('application/javascript').send(`${renderClient()}\n${renderNotesClient()}\n${renderCompactEditorClient()}`);
  });

  router.get('/booking-confirmation-exceptions', requireSession, requireNotificationCapability, (_req, res) => {
    return res.redirect(302, '/calendar/messages?view=attention');
  });

  router.get('/appointments/:appointmentId/booking-confirmation', requireSession, requireNotificationCapability, async (req, res, next) => {
    try {
      const result = await notificationService.getAppointmentConfirmation({
        adminId: req.staffBrowserSession.adminId,
        appointmentId: req.params.appointmentId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.post('/appointments/:appointmentId/booking-confirmation/recover', sameOrigin, requireSession, requireCsrf, requireNotificationCapability, async (req, res, next) => {
    try {
      const result = await notificationService.sendBookingConfirmation({
        adminId: req.staffBrowserSession.adminId,
        appointmentId: req.params.appointmentId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.get('/appointments/:appointmentId/notes', requireSession, async (req, res, next) => {
    try {
      const result = await notesService.get({
        adminId: req.staffBrowserSession.adminId,
        appointmentId: req.params.appointmentId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.patch('/appointments/:appointmentId/notes', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await notesService.update({
        adminId: req.staffBrowserSession.adminId,
        appointmentId: req.params.appointmentId,
        expectedRevision: req.body?.expectedRevision,
        notes: req.body?.notes,
        requestId: req.body?.requestId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.get('/staff/:staffId/schedule/:dayOfWeek', requireSession, requireCapability, async (req, res, next) => {
    try {
      const result = await mutationService.getScheduleState(req.staffBrowserSession.adminId, {
        staffId: req.params.staffId,
        dayOfWeek: req.params.dayOfWeek,
        locationId: req.query?.locationId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.post('/appointments/:appointmentId/reschedule', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.reschedule({
        adminId: req.staffBrowserSession.adminId,
        appointmentId: req.params.appointmentId,
        expectedRevision: req.body?.expectedRevision,
        startsAt: req.body?.startsAt,
        requestId: req.body?.requestId,
      });
      let customerNotification;
      try {
        customerNotification = await customerChangeNotificationService.queueCustomerChangeNotification(
          Number(result.appointmentId || result.entityId || req.params.appointmentId),
          'time'
        );
      } catch (notificationError) {
        logger.error({
          err: notificationError,
          appointmentId: Number(result.appointmentId || result.entityId || req.params.appointmentId),
          requestId: req.id,
        }, 'Calendar reschedule saved but customer update confirmation could not be queued');
        customerNotification = { queued: false, reason: 'queue_failed' };
      }
      return res.status(200).json({
        ...result,
        customerNotification: {
          queued: customerNotification?.queued === true,
          reason: customerNotification?.reason || customerNotification?.attempted?.reason || null,
        },
      });
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.post('/appointments/:appointmentId/reassign', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.reassign({
        adminId: req.staffBrowserSession.adminId,
        appointmentId: req.params.appointmentId,
        expectedRevision: req.body?.expectedRevision,
        fromStaffId: req.body?.fromStaffId,
        destinationStaffId: req.body?.destinationStaffId,
        requestId: req.body?.requestId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.post('/appointments/:appointmentId/cancel', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.cancel({
        adminId: req.staffBrowserSession.adminId,
        appointmentId: req.params.appointmentId,
        expectedRevision: req.body?.expectedRevision,
        confirmation: req.body?.confirmation,
        reason: req.body?.reason,
        requestId: req.body?.requestId,
      });
      let customerNotification;
      try {
        customerNotification = await customerChangeNotificationService.queueCustomerChangeNotification(
          Number(result.appointmentId || req.params.appointmentId),
          'cancellation'
        );
      } catch (notificationError) {
        logger.error({
          err: notificationError,
          appointmentId: Number(result.appointmentId || req.params.appointmentId),
          requestId: req.id,
        }, 'Calendar cancellation saved but customer cancellation update could not be queued');
        customerNotification = { queued: false, reason: 'queue_failed' };
      }
      return res.status(200).json({
        ...result,
        customerNotification: {
          queued: customerNotification?.queued === true,
          reason: customerNotification?.reason || customerNotification?.attempted?.reason || null,
        },
      });
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.post('/blocks', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.createBlock({
        adminId: req.staffBrowserSession.adminId,
        requestId: req.body?.requestId,
        staffId: req.body?.staffId,
        locationId: req.body?.locationId,
        startsAt: req.body?.startsAt,
        endsAt: req.body?.endsAt,
        blockType: req.body?.blockType,
        title: req.body?.title,
        notes: req.body?.notes,
      });
      return res.status(201).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.patch('/blocks/:blockId', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.editBlock({
        adminId: req.staffBrowserSession.adminId,
        blockId: req.params.blockId,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        staffId: req.body?.staffId,
        locationId: req.body?.locationId,
        startsAt: req.body?.startsAt,
        endsAt: req.body?.endsAt,
        blockType: req.body?.blockType,
        title: req.body?.title,
        notes: req.body?.notes,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.delete('/blocks/:blockId', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.removeBlock({
        adminId: req.staffBrowserSession.adminId,
        blockId: req.params.blockId,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.post('/leave', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.createLeave({
        adminId: req.staffBrowserSession.adminId,
        requestId: req.body?.requestId,
        staffId: req.body?.staffId,
        locationId: req.body?.locationId,
        date: req.body?.date,
        reason: req.body?.reason,
      });
      return res.status(201).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.patch('/leave/:leaveId', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.editLeave({
        adminId: req.staffBrowserSession.adminId,
        leaveId: req.params.leaveId,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
        locationId: req.body?.locationId,
        date: req.body?.date,
        reason: req.body?.reason,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.delete('/leave/:leaveId', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.removeLeave({
        adminId: req.staffBrowserSession.adminId,
        leaveId: req.params.leaveId,
        expectedRevision: req.body?.expectedRevision,
        requestId: req.body?.requestId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  router.put('/staff/:staffId/schedule/:dayOfWeek', ...mutationChain, async (req, res, next) => {
    try {
      const result = await mutationService.setWorkingSchedule({
        adminId: req.staffBrowserSession.adminId,
        requestId: req.body?.requestId,
        staffId: req.params.staffId,
        dayOfWeek: req.params.dayOfWeek,
        locationId: req.body?.locationId,
        expectedRevision: req.body?.expectedRevision,
        mode: req.body?.mode,
        startsLocal: req.body?.startsLocal,
        endsLocal: req.body?.endsLocal,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendOperationalError(error, req, res, next);
    }
  });

  return router;
}

module.exports = {
  createCalendarOperationalMutationRouter,
  setOperationalSecurityHeaders,
  statusForOperationalError,
  sendOperationalError,
};
