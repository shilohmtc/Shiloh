'use strict';
const { recordedVisitInterval } = require('./clientRecordedVisits');
const MAX_INSIGHT_RECORDS = 10000;
const INSIGHT_PAGE_SIZE = 20;

function insightPeriod(months = 2, asOf = new Date()) {
  if (![2, 5].includes(Number(months)) || !Number.isFinite(new Date(asOf).getTime())) {
    const error = Error('Choose the 2- or 5-month view.');
    error.httpStatus = 400;
    throw error;
  }
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(asOf));
  const [year, month] = date.split('-').map(Number);
  const monthKeys = Array.from({ length: Number(months) }, (_, i) =>
    new Date(Date.UTC(year, month - Number(months) + i, 1)).toISOString().slice(0, 7),
  );
  return {
    months: Number(months),
    monthKeys,
    startDate: monthKeys[0] + '-01',
    endDate: date,
    asOf: new Date(asOf).toISOString(),
    partialMonth: monthKeys.at(-1),
  };
}
function projectClientInsights(row, period, offset = 0) {
  const unavailable = { available: false, period, offset, pageSize: INSIGHT_PAGE_SIZE };
  const integer = (value) =>
    value != null && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
  if (
    !row ||
    !integer(row.record_count) ||
    Number(row.record_count) > MAX_INSIGHT_RECORDS ||
    row.split_group === true ||
    !integer(row.total_visits) ||
    !integer(row.unique_clients) ||
    Number(row.unique_clients) > Number(row.total_visits) ||
    !Array.isArray(row.monthly) ||
    !Array.isArray(row.ranking) ||
    row.monthly.length !== period.months ||
    row.ranking.length > INSIGHT_PAGE_SIZE
  )
    return unavailable;
  if (
    row.monthly.some(
      (item, index) =>
        item.month !== period.monthKeys[index] ||
        !integer(item.visits) ||
        !integer(item.clients) ||
        Number(item.clients) > Number(item.visits),
    ) ||
    row.monthly.reduce((sum, item) => sum + Number(item.visits), 0) !== Number(row.total_visits)
  )
    return unavailable;
  if (
    row.ranking.some(
      (item) =>
        !/^[1-9]\d*$/.test(item.clientId) ||
        !integer(item.visits) ||
        !Number(item.visits) ||
        !integer(item.rank) ||
        !Number(item.rank) ||
        !Number.isFinite(new Date(item.lastVisitAt).getTime()) ||
        !Array.isArray(item.dates) ||
        item.dates.some(
          (date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)),
        ),
    )
  )
    return unavailable;
  return {
    available: true,
    period,
    offset,
    pageSize: INSIGHT_PAGE_SIZE,
    totalVisits: Number(row.total_visits),
    uniqueClients: Number(row.unique_clients),
    monthly: row.monthly.map((item) => ({
      ...item,
      visits: Number(item.visits),
      clients: Number(item.clients),
    })),
    ranking: row.ranking.map((item) => ({
      ...item,
      name: String(item.name || 'Unnamed client').slice(0, 120),
      visits: Number(item.visits),
      rank: Number(item.rank),
      interval: recordedVisitInterval(item.dates),
    })),
    hasMore: offset + row.ranking.length < Number(row.unique_clients),
  };
}
module.exports = { MAX_INSIGHT_RECORDS, INSIGHT_PAGE_SIZE, insightPeriod, projectClientInsights };
