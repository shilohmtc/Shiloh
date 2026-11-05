'use strict';

// Appointment outcomes, not unique clients, cash receipts or a retention cohort.
function recordedVisitTrend(current, previous) {
  function count(rows) {
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return null;
    let total = 0;
    for (const status of ['completed', 'no_charge']) {
      const value = Object.hasOwn(rows, status) ? rows[status] : 0;
      if (!Number.isSafeInteger(value) || value < 0) return null;
      total += value;
    }
    return Number.isSafeInteger(total) ? total : null;
  }
  const currentCount = count(current), previousCount = count(previous);
  if (currentCount === null || previousCount === null) return { available: false };
  const delta = currentCount - previousCount;
  return { available: true, currentCount, previousCount, delta,
    percent: previousCount > 0 ? Math.round(delta / previousCount * 100) : null };
}

module.exports = { recordedVisitTrend };
