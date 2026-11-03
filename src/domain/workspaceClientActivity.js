'use strict';

// Only an exact event key within the same client can join app availability to
// delivery attention. Two changes to the same booking are different events.
function eventIdentity(item) {
  return item?.eventKey && item?.clientId ? `${item.clientId}|${item.eventKey}` : null;
}

function buildClientActivity(model) {
  const rows = [];
  const changes = new Map();
  if (model.notificationAuthority) {
    for (const item of model.attention || []) {
      rows.push({ kind: 'confirmation', item, needsAttention: true });
    }
    for (const item of model.changeAttention || []) {
      const row = { kind: 'change', item, needsAttention: true };
      const identity = eventIdentity(item);
      if (identity) changes.set(identity, row);
      rows.push(row);
    }
  }
  const seen = new Set();
  for (const item of model.activity || []) {
    const identity = eventIdentity(item);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    const exception = identity && changes.get(identity);
    if (exception) exception.activity = item;
    else rows.push({ kind: 'activity', item, needsAttention: false });
  }
  // Exceptions come from independent authority queries and are never sliced to
  // the recent-activity window. Old unresolved work remains visible first.
  return rows;
}

module.exports = { eventIdentity, buildClientActivity };
