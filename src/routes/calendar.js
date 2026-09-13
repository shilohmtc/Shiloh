const express = require("express");
const { pool } = require('../db/pool');
const calendarReadOnlyUxRoutes = require('./calendarReadOnlyUxPractitionerScope');
const staffCalendarAccessUxRoutes = require('./staffCalendarAccessUx');
const { createCalendarCreateBookingRouter } = require('./calendarCreateBooking');
const { createCalendarRetrospectiveBookingRouter } = require('./calendarRetrospectiveBooking');
const { createStaffBrowserSessionService } = require('../services/staffBrowserSession');
const { createStaffBrowserSessionRouter } = require('./staffBrowserSession');
const { createStaffAuthBrowserEnrollmentRouter } = require('./staffAuthBrowserEnrollment');
const { createStaffPasskeyBootstrapRouter } = require('./staffPasskeyBootstrap');
const { createStaffPasskeyAuthRouter } = require('./staffPasskeyAuth');
const { createOptionalCalendarSessionMiddleware } = require('../middleware/staffBrowserSession');
const { createOperatorContactAuthorityRouter } = require('./operatorContactAuthority');
const { createCalendarOperationalMutationRouter } = require('./calendarOperationalMutations');
const { createCalendarAppointmentEndTimeRouter } = require('./calendarAppointmentEndTime');
const { createWorkspaceClientsRouter } = require('./workspaceClients');
const { createWorkspaceClientMutationRouter } = require('./workspaceClientMutations');
const { createWorkspaceClientNotificationRouter } = require('./workspaceClientNotifications');
const { createWorkspaceStaffRouter } = require('./workspaceStaff');
const { createWorkspaceStaffMutationRouter } = require('./workspaceStaffMutations');
const { createWorkspaceServicesRouter } = require('./workspaceServices');
const { createWorkspaceServicesMutationRouter } = require('./workspaceServicesMutations');
const { createWorkspaceReportsRouter } = require('./workspaceReports');
const { createWorkspaceClinicHoursRouter } = require('./workspaceClinicHours');
const { createWorkspaceOperationalRouter } = require('./workspaceOperational');
const { createWorkspaceMessagesRouter } = require('./workspaceMessages');
const { createWorkspacePwaRouter, createWorkspacePwaHtmlMiddleware } = require('./workspacePwa');
const { calendarPhoneCompactV2ClientScript } = require('../presentation/calendarPhoneCompactV2');
const { calendarPhoneAllStaffClientScript } = require('../presentation/calendarPhoneAllStaffUx');
const { calendarAppointmentDetailsClientScript } = require('../presentation/calendarAppointmentDetailsUx');
const router = express.Router();

const staffBrowserSessionService = createStaffBrowserSessionService({ db: pool });

function esc(v=''){return String(v).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
function stamp(v){return new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}

router.get('/:token.ics',async(req,res,next)=>{try{
  const token=String(req.params.token||'');if(!/^[A-Za-z0-9_-]{20,80}$/.test(token))return res.sendStatus(404);
  const r=await pool.query(`
    SELECT a.id,a.starts_at,a.ends_at,a.status,l.name AS location_name,
           c.display_name AS client_name,
           COALESCE((SELECT aps.service_name_snapshot FROM appointment_services aps WHERE aps.appointment_id=a.id ORDER BY aps.position LIMIT 1),a.title,'Shiloh appointment') AS service_name,
           COALESCE((SELECT ast.staff_name_snapshot FROM appointment_staff ast WHERE ast.appointment_id=a.id ORDER BY ast.position LIMIT 1),'Shiloh practitioner') AS staff_name
      FROM appointment_calendar_share_tokens t
      JOIN appointments a ON a.id=t.appointment_id
      LEFT JOIN clients c ON c.id=a.client_id
      LEFT JOIN locations l ON l.id=a.location_id
     WHERE t.token=$1`,[token]);
  const a=r.rows[0];if(!a||a.status==='cancelled')return res.sendStatus(404);
  const now=stamp(new Date());
  const body=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Shiloh//Appointment//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:shiloh-${a.id}@appointments`,`DTSTAMP:${now}`,`DTSTART:${stamp(a.starts_at)}`,`DTEND:${stamp(a.ends_at)}`,`SUMMARY:${esc(`Shiloh — ${a.service_name}`)}`,`DESCRIPTION:${esc(`Appointment with ${a.staff_name} at Shiloh.`)}`,`LOCATION:${esc(a.location_name||'Shiloh')}`,'END:VEVENT','END:VCALENDAR',''].join('\r\n');
  res.setHeader('Content-Type','text/calendar; charset=utf-8');res.setHeader('Content-Disposition',`inline; filename="shiloh-appointment-${a.id}.ics"`);res.send(body);
}catch(e){next(e);}});

router.use(createWorkspacePwaHtmlMiddleware());
router.use('/pwa', createWorkspacePwaRouter({ sessionService: staffBrowserSessionService }));
router.use('/staff-auth/admin-enrollment', createStaffAuthBrowserEnrollmentRouter({ sessionService: staffBrowserSessionService }));
router.use('/staff-auth/passkeys', createStaffPasskeyBootstrapRouter());
router.use('/staff-auth/passkeys', createStaffPasskeyAuthRouter({ sessionService: staffBrowserSessionService }));
router.use('/staff-auth', createStaffBrowserSessionRouter({ service: staffBrowserSessionService }));
router.use('/staff', staffCalendarAccessUxRoutes);
router.use('/client-authority', createOperatorContactAuthorityRouter({ sessionService: staffBrowserSessionService }));
router.use('/book/past', createCalendarRetrospectiveBookingRouter({ sessionService: staffBrowserSessionService }));
router.use('/book', createCalendarCreateBookingRouter({ sessionService: staffBrowserSessionService }));
router.use('/operations', createCalendarAppointmentEndTimeRouter({ sessionService: staffBrowserSessionService }));
router.use('/operations', createCalendarOperationalMutationRouter({ sessionService: staffBrowserSessionService }));
router.use('/clients', createWorkspaceClientsRouter({ sessionService: staffBrowserSessionService }));
router.use('/clients', createWorkspaceClientMutationRouter({ sessionService: staffBrowserSessionService }));
router.use('/clients', createWorkspaceClientNotificationRouter({ sessionService: staffBrowserSessionService }));
router.use('/team', createWorkspaceStaffRouter({ sessionService: staffBrowserSessionService }));
router.use('/team', createWorkspaceStaffMutationRouter({ sessionService: staffBrowserSessionService }));
router.use('/services', createWorkspaceServicesRouter({ sessionService: staffBrowserSessionService }));
router.use('/services', createWorkspaceServicesMutationRouter({ sessionService: staffBrowserSessionService }));
router.use('/reports', createWorkspaceReportsRouter({ sessionService: staffBrowserSessionService }));
router.use('/clinic-hours', createWorkspaceClinicHoursRouter({ sessionService: staffBrowserSessionService }));
router.use('/workspace', createWorkspaceOperationalRouter({ sessionService: staffBrowserSessionService }));
router.use('/messages', createWorkspaceMessagesRouter({ sessionService: staffBrowserSessionService }));
router.get('/read-only/phone-v2.js', (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).type('application/javascript').send(`${calendarPhoneCompactV2ClientScript()}\n${calendarPhoneAllStaffClientScript()}\n${calendarAppointmentDetailsClientScript()}`);
});
router.use('/read-only', createOptionalCalendarSessionMiddleware({ service: staffBrowserSessionService }), calendarReadOnlyUxRoutes);
router.get('/', (_req, res) => res.redirect(302, '/calendar/workspace'));

module.exports=router;
