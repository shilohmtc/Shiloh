const { appUpdatesHtml } = require('../stories/fixtures/appUpdates');
const {detailsHtml}=require('../stories/fixtures/appointmentDetailsReview');
const fs = require('node:fs');
const path = require('node:path');
const review = require('../stories/fixtures/workspaceBrowserReview');
const { bookingProblemsHtml } = require('../stories/fixtures/bookingProblems');
const { desktopDashboardHtml } = require('../stories/fixtures/workspaceDesktopLayout');
const { shortcutHtml } = require('../stories/fixtures/dashboardDepositWaiverShortcut');
const { rebookHtml } = require('../stories/fixtures/rebookActionPresentation');
const { dashboardDepositsHtml } = require('../stories/fixtures/workspaceDashboardDeposits');
const { attendedHtml } = require('../stories/fixtures/alreadyAttended');
const destination = path.resolve(__dirname, '../stories/fixtures/workspaceBrowserReview.generated');
fs.mkdirSync(destination, { recursive: true });
for (const [name, html] of [
  ['update-workspace',appUpdatesHtml('workspace')],['update-client',appUpdatesHtml('client')],
  ['appointment-details',detailsHtml()],['appointment-details-pending',detailsHtml({pending:true})],['appointment-details-read-only',detailsHtml({readOnly:true})],
  ['booking-problems-recent',bookingProblemsHtml()],['booking-problems-unavailable',bookingProblemsHtml('unavailable')],
  ['rebook-actions',rebookHtml()],
  ['already-attended',attendedHtml()],
  ['waiver-shortcut-sparse',shortcutHtml('sparse')],['waiver-shortcut-busy',shortcutHtml('busy')],
  ['waiver-shortcut-restricted',shortcutHtml('sparse',false)],
  ['empty',review.calendarHtml(true)],['populated',review.calendarHtml(false)],
  ['messages',review.messagesHtml()],['dashboard',review.dashboardHtml()],
  ['clients',review.clientsHtml()],['rewards',review.rewardsHtml()],
  ['deposits-sparse',dashboardDepositsHtml('sparse')],['deposits-busy',dashboardDepositsHtml('busy')],
  ['desktop-sparse',desktopDashboardHtml('sparse')],['desktop-busy',desktopDashboardHtml('busy')],
]) fs.writeFileSync(path.join(destination, `${name}.html`),html);

// Synthetic enquiry handover, rendered with the production page and client script.
{
  const production = require('../src/presentation/calendarGroupBookingUx');
  const requestContext = { requestId: 42, revision: 'synthetic-request-v1', organiser: { clientId: 201, name: 'Synthetic Organiser', mobile: '27810000201', revision: 'synthetic-contact-v1' }, preferredDate: '2099-10-24', serviceDetail: 'Three friends planning a massage morning', guestCount: 3, preferredDaypart: 'morning', occasionNote: 'Birthday gathering', clientNote: 'Please agree the actual treatments with each guest.', returnTo: '/calendar/workspace#planning-request-42' };
  const options = { requestContext, authority: { operatorAdminId: 7, canApplyDiscount: true }, guestBooking: { available: true }, services: [{ id: 81, name: 'Swedish Massage', durationMinutes: 60, price: 590, staffIds: [11, 12, 13] }], staff: [11, 12, 13].map((id, i) => ({ id, displayName: `Synthetic Practitioner ${i + 1}` })) };

  const html = production.renderCalendarGroupBookingPage({ options, prefill: { date: requestContext.preferredDate } }).replace(/<script src="[^"]+" defer><\/script>/, '').replace('</body>', `<script>window.fetch=async()=>new Response(JSON.stringify({error:'Synthetic preview only. Browser regression tests exercise review and confirmation.'}),{status:503,headers:{'Content-Type':'application/json'}});</script><script>${production.calendarGroupBookingClientScript().replace(/<\/script/gi, '<\\/script')}</script></body>`);
  fs.writeFileSync(path.join(destination, 'group-enquiry-handover.html'), html);
}
