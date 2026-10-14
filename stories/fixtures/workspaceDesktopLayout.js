const { dashboardModel } = require('./workspaceBrowserReview');
const { renderDashboardPage, dashboardClientScript, planningRequestClientScript } = require('../../src/presentation/workspaceDashboardUx');

// Fabricated appointments and requests only. No database or production reads.
function desktopDashboardModel(kind = 'sparse') {
  const model = dashboardModel();
  const busy = kind === 'busy';
  const staff = [41, 42, 43].map(id => ({ id, displayName: `Synthetic Team ${id}` }));
  model.calendar.timeline.staff = staff;
  model.teamGroups = staff.map((person, team) => ({
    key: String(person.id), label: person.displayName,
    appointments: Array.from({ length: busy ? 4 : 1 }, (_, index) => ({
      id: 9301 + team * 10 + index, clientName: `Synthetic Guest ${team + 1}-${index + 1}`,
      serviceName: 'Synthetic treatment', startsAt: `2026-10-14T${String(6 + index * 2).padStart(2, '0')}:00:00Z`,
      endsAt: `2026-10-14T${String(7 + index * 2).padStart(2, '0')}:00:00Z`,
      staffIds: [person.id], status: team === 0 && index === 0 ? 'completed' : 'confirmed',
      canFinalize: team !== 0 || index !== 0, revision: 'synthetic-revision',
      operationalDateKey: '2026-10-14',
    })),
  }));
  model.appointments = model.teamGroups.flatMap(group => group.appointments);
  model.awaitingFinalization = model.appointments.filter(item => item.canFinalize);
  model.canFinalizeAllBusiness = true;
  model.carryOver = busy ? model.appointments.slice(1, 4).map(item => ({ ...item, id: item.id + 100,
    startsAt: item.startsAt.replace('10-14', '10-13'), endsAt: item.endsAt.replace('10-14', '10-13'),
    operationalDateKey: '2026-10-13', canFinalize: true,
  })) : [];
  model.recentActivity = busy ? [model.appointments[0]] : [];
  model.holidayDecisions = [];
  return model;
}
const { workspaceIconClientScript } = require('../../src/presentation/workspaceIconClient');
const desktopNavigation = { vouchersHref: '/calendar/vouchers', rewardsHref: '/calendar/rewards' };
function desktopDashboardHtml(kind = 'sparse', render = renderDashboardPage) {
  return render(desktopDashboardModel(kind), { navigation: desktopNavigation })
    .replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g, '')
    .replace('</body>', `<script>${workspaceIconClientScript()}${dashboardClientScript()}${planningRequestClientScript()}</script></body>`);
}
module.exports = { desktopDashboardModel, desktopDashboardHtml, desktopNavigation };
