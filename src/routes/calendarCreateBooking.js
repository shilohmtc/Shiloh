const express = require('express');
const { pool } = require('../db/pool');
const { createCalendarCreateBookingService } = require('../services/calendarCreateBooking');
const { createCalendarRetrospectiveBookingService } = require('../services/calendarRetrospectiveBooking');
const { confirmCalendarV2BookingDirect } = require('../services/calendarDirectBookingConfirmation');
const { createCalendarBookingClientDirectory } = require('../services/calendarBookingClientDirectory');
const workspaceServiceCreation = require('../services/workspaceServiceCreation');
const { isOperationalDateKey } = require('../services/operationalCalendar');
const {
  requireStaffSession,
  sameOriginGuard,
  csrfGuard,
} = require('../middleware/staffBrowserSession');
const {
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
} = require('../presentation/calendarCreateBookingUx');
const {
  calendarCreateBookingClientChoiceScript,
} = require('../presentation/calendarCreateBookingClientChoiceUx');
const {
  injectCalendarInlineServiceCreation,
  serviceCreationClientScript,
} = require('../presentation/workspaceServiceCreationUx');
const {
  decorateCreateBookingNotes,
  calendarCreateBookingNotesClientScript,
} = require('../presentation/calendarAppointmentNotesUx');

const CLIENT_BROWSE_QUERY = '__shiloh_calendar_active_clients_v1__';

function setBookingSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function statusForError(error) {
  const code = String(error?.code || '');
  if (code === 'CALENDAR_BOOKING_FORBIDDEN' || code === 'CALENDAR_BOOKING_SCOPE_UNRESOLVED') return 403;
  if (code === 'CALENDAR_BOOKING_CRM_V2_CONFLICT' || code === 'CALENDAR_BOOKING_CLIENT_MOBILE_CHANGED' || code === 'CALENDAR_BOOKING_CRM_V2_CLIENT_INACTIVE') return 409;
  if (code === 'CALENDAR_BOOKING_INELIGIBLE_SELECTION' || code === 'CALENDAR_BOOKING_CONFIRMATION_UNSAFE' || code === 'CALENDAR_BOOKING_NO_PENDING') return 409;
  if (code === 'APPOINTMENT_NOTES_TOO_LONG') return 400;
  if (code === 'CRM_V2_CLIENT_NOT_FOUND') return 404;
  if (code === 'CRM_V2_INVALID_MOBILE' || code === 'CRM_V2_INVALID_NAME' || code === 'CRM_V2_SEARCH_TOO_SHORT' || code === 'CRM_V2_INVALID_CLIENT_ID') return 400;
  if (code.startsWith('CALENDAR_BOOKING_INVALID_') || code === 'CALENDAR_BOOKING_CLIENT_REQUIRED') return 400;
  if (code === 'OPERATOR_AUTHORITY_UNAUTHORIZED') return 401;
  if (code === 'OPERATOR_AUTHORITY_FORBIDDEN' || code === 'OPERATOR_AUTHORITY_BOOKING_SCOPE_DENIED') return 403;
  if (code.includes('BOOKING_CONTEXT') || code.endsWith('_MISMATCH') || code.endsWith('_AMBIGUOUS') || code.endsWith('_INACTIVE') || code.endsWith('_NOT_VERIFIED')) return 409;
  if (code.startsWith('OPERATOR_AUTHORITY_') || code.startsWith('CLIENT_FACING_NAME_')) return 400;
  return 503;
}

function bookingRecoveryFor(status) {
  const key = String(status || 'booking_unavailable');
  const recovery = {
    kind: key,
    title: 'This booking could not be prepared.',
    message: 'Nothing has been booked or changed.',
    steps: [
      'Check the selected date and start time.',
      'Try another available time or eligible practitioner.',
      'Report the problem if the same error continues.',
    ],
    actions: ['change_time', 'change_date', 'change_practitioner', 'report_problem'],
  };
  if (key === 'outside_clinic_hours') {
    return {
      ...recovery,
      title: 'The full treatment does not fit within the clinic’s booking hours.',
      message: 'Choose an earlier start time or another date. Nothing has been booked.',
      steps: [
        'Choose an earlier start time so the full treatment can finish before closing.',
        'Or choose another date with enough time available.',
        'Report the problem only if a time that should fit is still rejected.',
      ],
      actions: ['change_time', 'change_date', 'report_problem'],
    };
  }
  if (key === 'outside_working_hours') {
    return {
      ...recovery,
      title: 'The practitioner is not available for the full treatment at this time.',
      message: 'Only this practitioner’s availability is involved. Other staff and Shiloh are not affected.',
      steps: [
        'Choose another time or date for this practitioner.',
        'Or choose another eligible practitioner.',
        'If these hours look wrong, the practitioner can check My availability or report the problem.',
      ],
    };
  }
  if (key === 'schedule_exception') {
    return {
      ...recovery,
      title: 'The practitioner is unavailable during part of this treatment.',
      message: 'A time-off entry or availability change prevents the full appointment from fitting.',
      steps: [
        'Choose another time or date.',
        'Or choose another eligible practitioner.',
        'The practitioner can check My availability if this does not look right.',
      ],
    };
  }
  if (key === 'conflict') {
    return {
      ...recovery,
      title: 'This time overlaps another booking or blocked period.',
      message: 'Nothing has been booked. Choose a time where the full treatment is free.',
      steps: [
        'Choose another start time or date.',
        'Or choose another eligible practitioner.',
        'Report the problem if the Calendar shows this time as free.',
      ],
    };
  }
  return recovery;
}

function customerConfirmationState(result) {
  const delivery = result?.customerConfirmation || {};
  if (delivery.sent === true || delivery.deliveryStatus === 'sent') {
    return { status: 'sent', sent: true, retryable: false, reason: null };
  }
  const reason = String(delivery.reason || result?.customerConfirmationObligation?.reason || 'confirmation_not_sent');
  if (delivery.deliveryStatus === 'uncertain' || reason === 'delivery_state_uncertain') {
    return { status: 'delivery_status_uncertain', sent: false, retryable: false, reason: 'delivery_state_uncertain' };
  }
  const manualAction = [
    'client_contact_not_found',
    'client_contact_unverified',
    'client_contact_ambiguous',
    'client_name_authority_not_found',
    'canonical_client_inactive',
    'crm_v2_client_inactive',
    'crm_v2_recipient_missing',
    'crm_v2_name_missing',
    'crm_v2_identity_invalid',
  ].includes(reason);
  return {
    status: manualAction ? 'manual_action_required' : 'retry_pending',
    sent: false,
    retryable: manualAction ? true : delivery.retryable !== false,
    reason,
  };
}

function bookingPrefillFromQuery(query = {}, options = { staff: [] }) {
  const rawDate = String(query?.date || '').trim();
  const date = isOperationalDateKey(rawDate) ? rawDate : '';
  const rawTime = String(query?.time || '').trim();
  const timeMatch = rawTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const time = date && timeMatch && Number(timeMatch[2]) % 5 === 0 ? rawTime : '';
  const requestedStaffId = Number(String(query?.staff || '').trim());
  const staffId = Number.isSafeInteger(requestedStaffId)
    && (options.staff || []).some(person => Number(person.id) === requestedStaffId)
    ? requestedStaffId
    : null;
  return { date, time, staffId };
}

function calendarPastHandoffClientScript({ pastPath = '/calendar/book/past' } = {}) {
  return `(function(){
'use strict';
var PAST=${JSON.stringify(String(pastPath || '/calendar/book/past'))};
function el(selector){return document.querySelector(selector);}
function options(){try{return JSON.parse((document.getElementById('calendar-booking-options')||{}).textContent||'{}');}catch(_error){return {};}}
function selectedService(){var id=Number((el('#service-select')||{}).value);return (options().services||[]).find(function(item){return Number(item.id)===id;})||null;}
function endedWindow(){var date=String((el('#booking-date')||{}).value||'');var time=String((el('#booking-time')||{}).value||'');var service=selectedService();if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(time)||!service)return null;var duration=Number(service.durationMinutes);if(!Number.isFinite(duration)||duration<=0)return null;var start=new Date(date+'T'+time+':00+02:00');if(Number.isNaN(start.getTime()))return null;var end=new Date(start.getTime()+duration*60000);return end.getTime()<Date.now()?{date:date,time:time,staff:Number((el('#staff-select')||{}).value)||null}:null;}
function href(context){var params=new URLSearchParams();params.set('date',context.date);params.set('time',context.time);if(context.staff)params.set('staff',String(context.staff));return PAST+'?'+params.toString();}
function show(context){var status=el('[data-booking-status]');if(!status)return;status.textContent='';status.classList.remove('error','ready');status.classList.add('warn');status.append(document.createTextNode('This appointment has already ended. Record it as a past appointment instead. '));var action=document.createElement('a');action.className='button secondary';action.setAttribute('data-record-past-handoff','');action.href=href(context);action.textContent='Record past appointment';status.append(action);}
document.addEventListener('click',function(event){var target=event.target&&event.target.closest?event.target.closest('[data-review-booking]'):null;if(!target)return;var context=endedWindow();if(!context)return;event.preventDefault();event.stopImmediatePropagation();show(context);},true);
})();`;
}

function injectPastHandoffScript(html, scriptPath) {
  if (!scriptPath) return String(html);
  return String(html).replace('</head>', `<script src="${String(scriptPath).replace(/"/g, '&quot;')}" defer></script></head>`);
}

function createCalendarCreateBookingRouter({
  env = process.env,
  sessionService,
  bookingService = createCalendarCreateBookingService({ db: pool, env, confirmBooking: confirmCalendarV2BookingDirect }),
  retrospectiveService = createCalendarRetrospectiveBookingService({ db: pool }),
  clientDirectory = createCalendarBookingClientDirectory(),
  creationService = workspaceServiceCreation,
  renderPage = renderCalendarCreateBookingPage,
  renderClient = calendarCreateBookingClientScript,
  renderClientChoice = calendarCreateBookingClientChoiceScript,
  injectServiceCreation = injectCalendarInlineServiceCreation,
  renderServiceCreationClient = serviceCreationClientScript,
  injectAppointmentNotes = decorateCreateBookingNotes,
  renderAppointmentNotesClient = calendarCreateBookingNotesClientScript,
} = {}) {
  if (!sessionService) throw new Error('Calendar Create Booking staff session service is required');
  if (!clientDirectory || typeof clientDirectory.listActiveClients !== 'function') {
    throw new Error('Calendar Create Booking client directory is required');
  }
  const router = express.Router();
  const requireSession = requireStaffSession({ service: sessionService, env });
  const sameOrigin = sameOriginGuard({ env });
  const requireCsrf = csrfGuard({ service: sessionService });

  router.use((req, res, next) => {
    setBookingSecurityHeaders(res);
    return next();
  });

  router.get('/', requireSession, async (req, res, next) => {
    try {
      const options = await bookingService.listBookableOptions(req.staffBrowserSession.adminId);
      const prefill = bookingPrefillFromQuery(req.query, options);
      let html = renderPage({
        options,
        date: prefill.date,
        prefill,
        clientScriptPath: `${req.baseUrl || '/calendar/book'}/client.js`,
      });
      try {
        await retrospectiveService.resolveOperator(req.staffBrowserSession.adminId);
        html = injectPastHandoffScript(html, `${req.baseUrl || '/calendar/book'}/past-handoff.js`);
      } catch (_retrospectiveAuthorityError) {
        // Unauthorized principals receive no retrospective hint, teaser or client script.
      }
      try {
        if (await creationService.resolveCreateAccess(req.staffBrowserSession.adminId)) html = injectServiceCreation(html);
      } catch (_error) {}
      html = injectAppointmentNotes(html);
      return res.status(200).type('html').send(html);
    } catch (error) {
      if (statusForError(error) !== 503) return res.status(statusForError(error)).type('text/plain').send('Calendar booking unavailable');
      return next(error);
    }
  });

  router.get('/client.js', requireSession, async (req, res, next) => {
    try {
      await bookingService.resolveOperator(req.staffBrowserSession.adminId);
      let source = `${renderClient()}\n${renderClientChoice()}\n${renderAppointmentNotesClient()}`;
      try {
        if (await creationService.resolveCreateAccess(req.staffBrowserSession.adminId)) source += `\n${renderServiceCreationClient()}`;
      } catch (_error) {}
      return res.status(200).type('application/javascript').send(source);
    } catch (error) {
      if (statusForError(error) !== 503) return res.status(statusForError(error)).type('text/plain').send('Not Found');
      return next(error);
    }
  });

  router.get('/past-handoff.js', requireSession, async (req, res, next) => {
    try {
      await retrospectiveService.resolveOperator(req.staffBrowserSession.adminId);
      return res.status(200).type('application/javascript').send(calendarPastHandoffClientScript());
    } catch (error) {
      if (Number(error?.httpStatus) === 403 || String(error?.code || '').includes('FORBIDDEN')) {
        return res.status(404).type('text/plain').send('Not Found');
      }
      return next(error);
    }
  });

  router.post('/client-search', sameOrigin, requireSession, async (req, res, next) => {
    try {
      const query = String(req.body?.query || '').trim();
      let result;
      if (query === CLIENT_BROWSE_QUERY) {
        await bookingService.resolveOperator(req.staffBrowserSession.adminId);
        result = await clientDirectory.listActiveClients(10);
      } else {
        result = await bookingService.searchClients(req.staffBrowserSession.adminId, query);
      }
      return res.status(200).json(result);
    } catch (error) {
      const status = statusForError(error);
      if (status !== 503) return res.status(status).json({ error: 'Client search is not authorized', requestId: req.id });
      return next(error);
    }
  });

  router.post('/prepare', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await bookingService.prepare({
        adminId: req.staffBrowserSession.adminId,
        clientId: req.body?.clientId,
        newClient: req.body?.newClient,
        staffId: req.body?.staffId,
        serviceId: req.body?.serviceId,
        date: req.body?.date,
        time: req.body?.time,
      });
      if (result.status !== 'pending_confirmation') {
        return res.status(409).json({
          status: result.status,
          reply: result.reply || 'Booking cannot be prepared.',
          recovery: bookingRecoveryFor(result.status),
        });
      }
      return res.status(200).json(result);
    } catch (error) {
      const status = statusForError(error);
      if (status !== 503) return res.status(status).json({
        error: error.message,
        code: error.code,
        requestId: req.id,
        recovery: bookingRecoveryFor(error.code),
      });
      return next(error);
    }
  });

  router.post('/discard', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await bookingService.discard({ adminId: req.staffBrowserSession.adminId });
      return res.status(200).json(result);
    } catch (error) {
      const status = statusForError(error);
      if (status !== 503) return res.status(status).json({ error: error.message, code: error.code, requestId: req.id });
      return next(error);
    }
  });

  router.post('/confirm', sameOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const result = await bookingService.confirm({
        adminId: req.staffBrowserSession.adminId,
        notes: req.body?.notes,
      });
      if (result.status !== 'created') {
        return res.status(409).json({ status: result.status, reply: result.reply || 'Booking was not created.' });
      }
      return res.status(201).json({
        status: 'created',
        appointmentId: result.appointmentId,
        customerConfirmation: customerConfirmationState(result),
      });
    } catch (error) {
      const status = statusForError(error);
      if (status !== 503) return res.status(status).json({ error: error.message, code: error.code, requestId: req.id });
      return next(error);
    }
  });

  return router;
}

module.exports = {
  CLIENT_BROWSE_QUERY,
  createCalendarCreateBookingRouter,
  setBookingSecurityHeaders,
  statusForError,
  bookingRecoveryFor,
  customerConfirmationState,
  bookingPrefillFromQuery,
  calendarPastHandoffClientScript,
  injectPastHandoffScript,
};
