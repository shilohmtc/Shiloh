'use strict';
const { error, moneyCents, operation } = require('./workspaceFinancialRecords');
const METRICS = {
  net_receipts: { label: 'Net recorded receipts', unit: 'cents' },
  completed_visits: { label: 'Recorded completed visits', unit: 'visits' },
};
function monthPeriod(value) {
  if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))
    throw error('Choose a month from 2000 to 2099.');
  const [year, month] = value.split('-').map(Number),
    next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return {
    month: value,
    start: value + '-01',
    end: next,
    from: value + '-01T00:00:00+02:00',
    to: next + 'T00:00:00+02:00',
  };
}
function validateTarget(input) {
  const period = monthPeriod(input.month);
  if (!Object.hasOwn(METRICS, input.metric) || !['set', 'clear'].includes(input.action))
    throw error('Choose a valid target action.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= 2147483647)
    throw error('Refresh the targets before saving.');
  let value = null;
  if (input.action === 'set') {
    if (input.metric === 'net_receipts') value = moneyCents(input.target);
    else {
      if (!/^\d{1,9}$/.test(String(input.target)))
        throw error('Enter a whole number of completed visits.');
      value = Number(input.target);
    }
  }
  return {
    period,
    metric: input.metric,
    action: input.action,
    value,
    revision: input.revision,
    operationId: operation(input.operationId),
  };
}
function comparison(actual, target) {
  if (!Number.isSafeInteger(actual))
    return { actual: null, target, remaining: null, percent: null };
  return {
    actual,
    target,
    remaining: target == null ? null : Math.max(target - actual, 0),
    percent: target > 0 ? Math.round((actual / target) * 100) : null,
  };
}
module.exports = { METRICS, monthPeriod, validateTarget, comparison };
