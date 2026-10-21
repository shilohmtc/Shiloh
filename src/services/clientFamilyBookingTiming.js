'use strict';

// Shared by client review and Reception's atomic linked-booking decisions.
function validFamilyWindows(items) {
  if (!Array.isArray(items) || items.length < 2 || items.length > 10) return false;
  const starts = items.map(item => new Date(item.startsAt).getTime());
  const ends = items.map(item => new Date(item.endsAt).getTime());
  if (starts.some((start,index) => !Number.isFinite(start) || !Number.isFinite(ends[index]) || ends[index] <= start)) return false;
  const together = starts.every(start => start === starts[0]);
  return together ? new Set(items.map(item => Number(item.staffId))).size === items.length
    : starts.every((start,index) => index === 0 || start >= ends[index - 1]);
}

module.exports = { validFamilyWindows };
