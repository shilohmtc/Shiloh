'use strict';
const { insightAverageWindows } = require('./clientInsights');
function projectOpenDayAverage(counts, opening, period, totalVisits) {
  const unavailable = { kind: 'day', available: false, reason: 'Opening-day data unavailable' };
  const dates = insightAverageWindows(period)
    .filter((w) => w.kind === 'day')
    .map((w) => w.startDate);
  if (
    !opening?.available ||
    !Array.isArray(opening.days) ||
    !Array.isArray(counts) ||
    opening.days.length !== dates.length ||
    counts.length !== dates.length
  )
    return unavailable;
  let clientPeriods = 0,
    periods = 0,
    assumedDays = 0,
    savedDays = 0,
    outsideDates = 0,
    outsideClientDays = 0,
    total = 0;
  for (let i = 0; i < dates.length; i++) {
    const day = opening.days[i],
      count = counts[i];
    if (
      !day ||
      !count ||
      day.date !== dates[i] ||
      count.date !== dates[i] ||
      !['open', 'closed', 'unknown'].includes(day.state) ||
      !['saved_date', 'current_schedule', 'effective_rule'].includes(day.source) ||
      count.clients == null ||
      !Number.isSafeInteger(Number(count.clients)) ||
      Number(count.clients) < 0
    )
      return unavailable;
    if (day.state === 'unknown')
      return { ...unavailable, reason: 'A public holiday has no saved opening decision' };
    const clients = Number(count.clients);
    total += clients;
    if (day.state === 'open') {
      periods++;
      clientPeriods += clients;
      if (day.source === 'saved_date') savedDays++;
      else assumedDays++;
    } else if (clients) {
      outsideDates++;
      outsideClientDays += clients;
    }
  }
  if (total > totalVisits) return unavailable;
  return {
    kind: 'day',
    available: true,
    periods,
    clientPeriods,
    average: periods ? clientPeriods / periods : null,
    assumedDays,
    savedDays,
    outsideDates,
    outsideClientDays,
    asOf: opening.asOf,
  };
}
module.exports = { projectOpenDayAverage };
