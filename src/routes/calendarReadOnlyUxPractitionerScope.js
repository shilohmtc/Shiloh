const base = require('./calendarReadOnlyUx');
const scoped = require('../services/calendarReadOnlyUxPractitionerScope');

function resolveScopedServerViewer(req) {
  const viewer = base.resolveServerViewer(req);
  if (!viewer) return null;
  const adminId = Number(req?.staffBrowserSession?.adminId);
  return Number.isSafeInteger(adminId) && adminId > 0
    ? { ...viewer, operatorAdminId: adminId }
    : viewer;
}

function createCalendarReadOnlyPractitionerScopeRouter(options = {}) {
  return base.createCalendarReadOnlyRouter({
    ...options,
    buildModel: options.buildModel || scoped.buildModel,
    resolveViewer: options.resolveViewer || resolveScopedServerViewer,
  });
}

module.exports = createCalendarReadOnlyPractitionerScopeRouter();
Object.assign(module.exports, base, {
  resolveScopedServerViewer,
  createCalendarReadOnlyPractitionerScopeRouter,
});
