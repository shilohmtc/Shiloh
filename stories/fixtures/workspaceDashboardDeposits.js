const { desktopDashboardModel, desktopNavigation } = require('./workspaceDesktopLayout');
const { renderDashboardPage, dashboardClientScript, planningRequestClientScript, depositQueueClientScript } = require('../../src/presentation/workspaceDashboardUx');
const { workspaceIconClientScript } = require('../../src/presentation/workspaceIconClient');
function dashboardDepositsModel(kind = 'sparse') {
  const model = desktopDashboardModel(kind);
  model.depositQueue = { items: [
    { accountId: 7101, appointmentId: 7201, state: 'partial', outstanding: '150', hasLink: true,
      members: [{appointmentId:7201,clientName:'Synthetic nearest guest',serviceName:'Synthetic massage',startsAt:'2026-10-15T08:00:00Z',staffNames:['Synthetic team']}] },
    { accountId: 7102, appointmentId: 7202, state: 'awaiting', outstanding: '500', hasLink: true,
      members: [7202,7203].map((id,index)=>({appointmentId:id,clientName:`Synthetic shared guest ${index+1}`,serviceName:'Synthetic shared treatment',startsAt:'2026-10-20T08:00:00Z',staffNames:['Synthetic team']})) },
  ] };
  return model;
}
function dashboardDepositsHtml(kind = 'sparse', render = renderDashboardPage) {
  return render(dashboardDepositsModel(kind), { navigation: desktopNavigation })
    .replace(/<script\b[^>]*src="[^"]+"><\/script>/g,'')
    .replace('</body>', `<script>${workspaceIconClientScript()}${dashboardClientScript()}${planningRequestClientScript()}${depositQueueClientScript()}</script></body>`);
}
module.exports = { dashboardDepositsModel, dashboardDepositsHtml };
