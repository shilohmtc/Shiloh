'use strict';

const MAX_APPOINTMENTS = 5000;
const MIN_INTERVAL_DATES = 4;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function recordedVisitInterval(inputDates) {
  const dates = [...new Set(inputDates)].sort();
  const gaps = dates.slice(1).map((date, index) => (Date.parse(date) - Date.parse(dates[index])) / 86400000);
  let interval = { state: 'sparse' };
  if (dates.length >= MIN_INTERVAL_DATES && gaps.every(gap => Number.isFinite(gap) && gap > 0)) {
    const days = median(gaps), min = Math.min(...gaps), max = Math.max(...gaps);
    // A "usual" rhythm needs most gaps near the median and no very long break.
    const regular = gaps.filter(gap => gap >= days * .5 && gap <= days * 1.5).length / gaps.length >= .75 && max <= days * 2;
    interval = { state: regular ? 'regular' : 'variable', days: Math.round(days), min, max };
  }
  return interval;
}

function projectRecordedVisits(row, asOf) {
  const counts = ['record_count','visit_count','missing_treatment_visits','treatment_count','leader_count'];
  if (!row || counts.some(key => row[key] == null || !Number.isSafeInteger(Number(row[key])) || Number(row[key]) < 0) || Number(row.record_count) > MAX_APPOINTMENTS || row.split_group === true || !/^\d{4}-\d{2}-\d{2}$/.test(row.period_start || '') || !Number.isFinite(new Date(asOf).getTime())) return { available: false };
  if (Number(row.visit_count) > Number(row.record_count) || Number(row.missing_treatment_visits) > Number(row.visit_count) || Number(row.leader_count) > Number(row.treatment_count) || !Array.isArray(row.visit_dates) || !Array.isArray(row.leaders) || row.leaders.some(item => !item.name || !Number.isSafeInteger(Number(item.visits)) || Number(item.visits) < 1 || Number(item.visits) > Number(row.visit_count)) || row.visit_dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) return { available: false };
  return {
    available: true, asOf: new Date(asOf).toISOString(), periodStart: row.period_start,
    lastVisitAt: row.last_visit_at ? new Date(row.last_visit_at).toISOString() : null,
    visitCount: Number(row.visit_count), interval: recordedVisitInterval(row.visit_dates),
    missingTreatmentVisits: Number(row.missing_treatment_visits),
    treatmentCount: Number(row.treatment_count), leaderCount: Number(row.leader_count),
    leaders: (row.leaders || []).map(item => ({ name: String(item.name).slice(0, 160), visits: Number(item.visits) })),
  };
}

module.exports = { MAX_APPOINTMENTS, MIN_INTERVAL_DATES, projectRecordedVisits, recordedVisitInterval };
