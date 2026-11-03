const { annualClosureName } = require('../config/clinicAnnualClosures');
const { pool } = require('../db/pool');
const { WorkspaceClinicHoursError } = require('./workspaceClinicHours');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizedDate(value) {
  const date = String(value || '').trim();
  if (!DATE_PATTERN.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function createWorkspaceClinicHoursHolidayGuard({ db = pool } = {}) {
  if (!db || typeof db.query !== 'function') throw new Error('Workspace Clinic hours holiday guard database is required');

  async function requireLoadedZaPublicHoliday(exceptionDate) {
    const date = normalizedDate(exceptionDate);
    if (!date) {
      throw new WorkspaceClinicHoursError(
        'WORKSPACE_CLINIC_HOURS_INVALID_EXCEPTION_DATE',
        'Clinic closure or holiday hours require a valid YYYY-MM-DD date.',
        400
      );
    }
    if (annualClosureName(date)) return { exceptionDate: date, holidayName: annualClosureName(date) };
    const result = await db.query(
      `/* workspaceClinicHours:publicHolidayGuard */
       SELECT holiday_date, name
         FROM public_holidays
        WHERE holiday_date=$1::date
          AND country_code='ZA'
        LIMIT 1`,
      [date]
    );
    if (!Array.isArray(result.rows) || result.rows.length !== 1) {
      throw new WorkspaceClinicHoursError(
        'WORKSPACE_CLINIC_HOURS_HOLIDAY_NOT_LOADED',
        'Choose a loaded South African public-holiday date for this clinic-wide exception.',
        400
      );
    }
    return { exceptionDate: date, holidayName: String(result.rows[0].name || '').trim() || null };
  }

  return { requireLoadedZaPublicHoliday };
}

const guard = createWorkspaceClinicHoursHolidayGuard();

module.exports = {
  normalizedDate,
  createWorkspaceClinicHoursHolidayGuard,
  requireLoadedZaPublicHoliday: guard.requireLoadedZaPublicHoliday,
};
