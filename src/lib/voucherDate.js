'use strict';

function voucherDateParts(value) {
  if (!value) return null;
  const raw = value instanceof Date ? value : String(value).trim();
  const parsed = raw instanceof Date
    ? raw
    : /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T12:00:00Z`)
      : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth(),
    day: parsed.getUTCDate(),
  };
}

function formatVoucherDate(value) {
  if (!value) return 'No expiry';
  const parts = voucherDateParts(value);
  if (!parts) return 'Expiry unavailable';
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month, parts.day, 12)));
}

function voucherExpiryTimestamp(value) {
  const parts = voucherDateParts(value);
  return parts ? Date.UTC(parts.year, parts.month, parts.day, 23, 59, 59, 999) : null;
}

module.exports = { formatVoucherDate, voucherExpiryTimestamp };
