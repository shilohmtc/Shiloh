const { desktopDashboardModel, desktopNavigation } = require('./workspaceDesktopLayout');
const { renderDashboardPage, dashboardClientScript } = require('../../src/presentation/workspaceDashboardUx');
function attendedHtml() {
  const model = desktopDashboardModel('sparse');
  model.bookingRequests = [{ appointmentId: 100, clientName: 'Synthetic Aloe', serviceName: 'Full body massage', staffName: 'Synthetic practitioner', effectiveStatus: 'pending', requestedStartsAt: '2020-01-02T10:00:00Z', requestedEndsAt: '2020-01-02T11:00:00Z', requestedRevision: '2020-01-01T00:00:00.000Z', appointmentRevision: '2020-01-01T00:00:00.000Z', approvalRevision: '2020-01-01T00:00:00.000Z', canRecordAttendance: true, canChangePractitioner: false },
    { appointmentId: 101, clientName: 'Synthetic group', serviceName: 'Group booking', staffName: 'Synthetic team', effectiveStatus: 'pending', requestedStartsAt: '2020-01-02T10:00:00Z', attendanceGroupReview: true, canRecordAttendance: false, canChangePractitioner: false }];
  return renderDashboardPage(model, { navigation: desktopNavigation })
    .replaceAll('/calendar/pwa/icon-192.png', '/assets/pwa/shiloh-pwa-192.png')
    .replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g, '')
    .replace('</body>', `<script>${dashboardClientScript()}</script></body>`);
}
module.exports = { attendedHtml };
