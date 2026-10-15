'use strict';
const { createCalendarAppointmentDetailsService } = require('../services/calendarAppointmentDetails');

function createCalendarAppointmentDetailsHandler({
  resolveViewer, isFeatureEnabled, setSecurityHeaders, statusForError = () => 503, env = process.env, buildModel,
  detailsService = createCalendarAppointmentDetailsService({ ...(buildModel ? { buildModel } : {}) }),
} = {}) {
  return async (req, res) => {
    setSecurityHeaders(res);
    if (!isFeatureEnabled(env)) return res.sendStatus(404);
    const viewer = resolveViewer(req);
    if (!viewer || !req.staffBrowserSession?.adminId) return res.status(401).json({ error: 'Sign in to Shiloh Workspace.', code: 'CALENDAR_DETAILS_UNAUTHORIZED' });
    try {
      return res.json(await detailsService.get({ adminId: req.staffBrowserSession.adminId, viewer,
        appointmentId: req.params.appointmentId, view: req.query.view, date: req.query.date, staff: req.query.staff }));
    } catch (error) {
      const requestedStatus = error?.httpStatus || statusForError(error);
      const status = [400,403,404,409].includes(requestedStatus) ? requestedStatus : 503;
      // No SQL, contact information, note content, form answers or financial payload in errors.
      return res.status(status).json({ error: 'Appointment details are unavailable. Refresh Calendar and try again.', code: 'CALENDAR_DETAILS_UNAVAILABLE' });
    }
  };
}
module.exports = { createCalendarAppointmentDetailsHandler };
