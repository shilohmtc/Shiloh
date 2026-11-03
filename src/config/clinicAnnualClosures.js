// Owner-approved defaults, effective 3 November 2026. Explicit date decisions
// take precedence; this module never writes holiday settings or appointments.
const { dayOfWeek } = require('../services/operationalCalendar');
const EFFECTIVE_FROM = '2026-11-03';
const ANNUAL_DATES = Object.freeze({ '01-01': 'New Year’s Day', '12-24': 'Christmas Eve', '12-25': 'Christmas Day' });
function annualClosureName(date) {
  return date >= EFFECTIVE_FROM && dayOfWeek(date) !== null ? ANNUAL_DATES[String(date).slice(5)] || null : null;
}
function annualClosuresBetween(from, to) {
  if (dayOfWeek(from) === null || dayOfWeek(to) === null || from > to) return [];
  const result = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    for (const suffix of Object.keys(ANNUAL_DATES)) {
      const date = `${year}-${suffix}`;
      if (date >= from && date <= to && annualClosureName(date)) result.push({ holiday_date: date, name: ANNUAL_DATES[suffix], annualDefault: true });
    }
  }
  return result.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
}
module.exports = { annualClosureName, annualClosuresBetween };
