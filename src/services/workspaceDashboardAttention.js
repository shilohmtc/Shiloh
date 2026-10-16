'use strict';

// The same queue displayed under Dashboard → Needs attention. This is not an unread count.
function workspaceDashboardAttention(model) {
  const visitKey = item => `${item.id}|${item.operationalDateKey || model.operationalDateKey}`;
  const today = new Set((model.appointments || []).map(visitKey));
  const carryOver = new Set((model.carryOver || []).map(visitKey));
  const exceptionalFinalization = (model.awaitingFinalization || [])
    .filter(item => !today.has(visitKey(item)) && !carryOver.has(visitKey(item)));
  const count = exceptionalFinalization.length + (model.bookingRequests || []).length
    + (model.planningRequests || []).length + (model.rescheduleRequests || []).length
    + (model.holidayDecisions || []).length + (Number(model.bookingProblems?.pendingCount) || 0);
  return { exceptionalFinalization, count };
}

module.exports = { workspaceDashboardAttention };
