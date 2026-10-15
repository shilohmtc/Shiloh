'use strict';
const { randomUUID } = require('node:crypto');
const observability = require('../lib/observability');
const { UUID, technicalCode } = require('./bookingSubmissionIncidents');

// Deliberately copy no error message, cause, SQL, parameters or request context.
// Existing Sentry filtering remains the final boundary for technical stack frames.
function technicalException(error) {
  const safe = new Error('Booking confirmation failed');
  safe.code = technicalCode(error);
  if (typeof error?.stack === 'string') safe.stack = 'Error: Booking confirmation failed\n' + error.stack.split('\n').slice(1).filter(line => /^\s+at /.test(line)).join('\n');
  return safe;
}
async function reportConfirmationFailure({ service, context, error, req, report = observability }) {
  let incident;
  try { if (context) incident = await service.failure(context,error); } catch (_) { /* Never replace the booking error. */ }
  const validReference = UUID.test(String(incident?.reference || ''));
  const reference = validReference ? incident.reference : randomUUID();
  const linkSaved = validReference && incident?.linkSaved === true;
  const safe = technicalException(error);
  try { report.captureException(safe, { 'error.kind':'booking_confirmation','error.code':safe.code,
    'support.reference':reference,'http.method':'POST','http.route':req.route?.path }); } catch (_) { /* Monitoring must not replace the original error. */ }
  try { req.log?.error({ code:safe.code, reference },'Booking confirmation failed'); } catch (_) { /* Logging is best effort too. */ }
  return { supportReference:reference, incidentLinkSaved:linkSaved,
    supportMessage:linkSaved
      ? 'We saved a support link in Shiloh. Quote this reference if you contact Reception.'
      : 'We could not save a client support link. Please contact Reception and quote this reference.' };
}
module.exports = { technicalException, reportConfirmationFailure };
