const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'customerChangeNotification.js'), 'utf8');
const patch = fs.readFileSync(path.join(__dirname, '..', 'src', 'bootstrap', 'adminBookingCustomerNotificationPatch.js'), 'utf8');
const operationalRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'calendarOperationalMutations.js'), 'utf8');
const lifecycle = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientLifecycleTemplateProvisioning.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('booking-update template carries the full latest appointment confirmation', () => {
  assert.match(lifecycle, /booking_update:\s*\{ name: 'shiloh_booking_update_v1'/);
  assert.match(lifecycle, /Service: \{\{2\}\}/);
  assert.match(lifecycle, /With: \{\{3\}\}/);
  assert.match(lifecycle, /Date: \{\{4\}\}/);
  assert.match(lifecycle, /Time: \{\{5\}\}/);
  assert.match(lifecycle, /Booked price: \{\{6\}\}/);
  assert.match(lifecycle, /Booking #\{\{7\}\}/);
  assert.match(lifecycle, /This is your latest confirmation/);
});

test('all material admin booking mutations map to customer notification kinds', () => {
  assert.match(service, /service:\s*'appointment\.service_updated'/);
  assert.match(service, /practitioner:\s*'appointment\.staff_updated'/);
  assert.match(service, /time:\s*'appointment\.time_updated'/);
  assert.match(service, /price:\s*'appointment\.price_updated'/);
  assert.match(service, /cancellation:\s*'admin\.appointment_cancelled'/);
  assert.match(service, /time:\s*Object\.freeze\(\['calendar\.appointment_rescheduled'\]\)/);
  assert.match(service, /action=ANY\(\$2::text\[\]\)/);
});

test('authenticated Calendar reschedules queue the latest customer confirmation after the canonical save', () => {
  const route = operationalRoute.match(/router\.post\('\/appointments\/:appointmentId\/reschedule'[\s\S]*?\n  \}\);/)?.[0] || '';
  const mutation = route.indexOf('mutationService.reschedule');
  const notification = route.indexOf('queueCustomerChangeNotification');
  const response = route.indexOf('res.status(200).json');
  assert.ok(mutation >= 0 && notification > mutation && response > notification);
  assert.match(route, /queueCustomerChangeNotification\([\s\S]*?'time'/);
  assert.match(route, /customerNotification/);
  assert.match(route, /reason: 'queue_failed'/);
});

test('delivery is audit-event idempotent and retries provider or send failures', () => {
  assert.match(service, /audit_event_id BIGINT PRIMARY KEY/);
  assert.match(service, /status TEXT NOT NULL CHECK \(status IN \('pending','sending','sent','failed','suppressed'\)\)/);
  assert.match(service, /ON CONFLICT \(audit_event_id\) DO NOTHING/);
  assert.match(service, /template_not_approved/);
  assert.match(service, /queued for retry/);
  assert.match(service, /INTERVAL '5 minutes'/);
});

test('ended booking updates are terminally suppressed before provider checks and rechecked before send claim', () => {
  assert.match(service, /suppression_reason TEXT/);
  assert.match(service, /suppressed_at TIMESTAMPTZ/);
  assert.match(service, /status='suppressed'/);
  assert.match(service, /suppression_reason='appointment_already_ended'/);
  assert.match(service, /appointment\.ends_at <= NOW\(\)/);
  assert.match(service, /!UPDATE_KINDS\.has\(item\.change_kind\)/);
  assert.match(service, /item\.status === 'suppressed'/);

  const providerCheck = service.indexOf('templateStatus = await getTemplateStatus()');
  const suppressionChecks = [...service.matchAll(/await suppressEndedBookingUpdate\(item\)/g)].map((match) => match.index);
  assert.ok(providerCheck > 0);
  assert.ok(suppressionChecks.length >= 2, 'expected an early stale guard and a pre-claim recheck');
  assert.ok(suppressionChecks[0] < providerCheck, 'stale rows must be suppressed before provider/configuration checks');

  const claim = service.indexOf("SET status='sending'");
  assert.ok(claim > 0);
  assert.ok(suppressionChecks.some((index) => index > providerCheck && index < claim), 'appointment end must be rechecked after provider lookup and before send claim');
});

test('suppression preserves failed-attempt history and terminal rows are excluded from retry scans', () => {
  const suppressStart = service.indexOf('async function suppressEndedBookingUpdate');
  const suppressEnd = service.indexOf('async function provisionRequiredCustomerChangeTemplates');
  const suppressBlock = service.slice(suppressStart, suppressEnd);
  assert.match(suppressBlock, /suppressed_at=COALESCE\(notification\.suppressed_at,NOW\(\)\)/);
  assert.doesNotMatch(suppressBlock, /attempt_count\s*=/);
  assert.doesNotMatch(suppressBlock, /last_error\s*=/);
  assert.doesNotMatch(suppressBlock, /sent_at\s*=/);
  assert.doesNotMatch(suppressBlock, /DELETE/i);

  const flushStart = service.indexOf('async function flushCustomerChangeNotifications');
  const schedulerStart = service.indexOf('function startCustomerChangeNotificationScheduler');
  const flushBlock = service.slice(flushStart, schedulerStart);
  assert.match(flushBlock, /WHERE status IN \('pending','failed'\)/);
  assert.doesNotMatch(flushBlock, /suppressed/);
});

test('future booking updates remain on the normal delivery path while cancellations are not stale-suppressed', () => {
  assert.match(service, /if \(!item \|\| !UPDATE_KINDS\.has\(item\.change_kind\)\) return false/);
  assert.match(service, /AND appointment\.ends_at <= NOW\(\)/);
  assert.match(service, /WHERE audit_event_id=\$1 AND status IN \('pending','failed'\)/);
  assert.match(service, /sendWhatsAppTemplate/);
  assert.match(service, /preferredTemplateKey = item\.change_kind === 'cancellation' \? 'cancellation_confirmation_v2' : 'booking_update'/);
  assert.match(service, /fallbackTemplateKey = item\.change_kind === 'cancellation' \? 'cancellation_confirmation' : null/);
});

test('customer messages are sent only through approved utility templates', () => {
  assert.match(service, /item\.provider\.status !== 'APPROVED'/);
  assert.match(service, /sendWhatsAppTemplate/);
  assert.match(service, /cancellation_confirmation/);
  assert.match(service, /booking_update/);
  assert.doesNotMatch(service, /sendWhatsAppMessage\(/);
});

test('booking change patch queues notifications only after successful mutation results', () => {
  assert.match(patch, /✅\\s\*Service changed to/);
  assert.match(patch, /✅\\s\*Practitioner changed to/);
  assert.match(patch, /✅\\s\*Date\\\/time updated/);
  assert.match(patch, /✅\\s\*Booked price updated/);
  assert.match(patch, /cancelledAppointmentId/);
  assert.match(patch, /postSend = async/);
  assert.match(patch, /queueCustomerChangeNotification/);
});

test('customer notification patch is preloaded after the Google provider guard', () => {
  const provider = pkg.scripts.start.indexOf('adminBookingProviderGuardPatch.js');
  const customer = pkg.scripts.start.indexOf('adminBookingCustomerNotificationPatch.js');
  assert.ok(provider >= 0 && customer > provider);
  assert.match(pkg.scripts.dev, /adminBookingCustomerNotificationPatch\.js/);
});


test('cancellation payment-safety template warns that old payment links are invalid', () => {
  const lifecycleSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientLifecycleTemplateProvisioning.js'), 'utf8');
  assert.match(lifecycleSource, /cancellation_confirmation_v2/);
  assert.match(lifecycleSource, /earlier unpaid deposit or payment link/);
  assert.match(lifecycleSource, /No refund is issued automatically/);
  assert.match(service, /\['booking_update', 'cancellation_confirmation_v2'\]/);
});
