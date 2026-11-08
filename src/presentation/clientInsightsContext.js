'use strict';
const { clientDirectoryReturnHref } = require('./clientDirectoryContext');
function insightsHref({ months = 2, offset = 0, returnTo } = {}) {
  const params = new URLSearchParams({ months: String(months === 5 ? 5 : 2) });
  if (Number.isSafeInteger(offset) && offset > 0 && offset <= 100000)
    params.set('offset', String(offset));
  const directory = clientDirectoryReturnHref(returnTo);
  if (directory) params.set('returnTo', directory);
  return '/calendar/clients/insights?' + params.toString();
}
function clientInsightsReturnHref(value) {
  if (
    typeof value !== 'string' ||
    value.length > 2000 ||
    !value.startsWith('/calendar/clients/insights?')
  )
    return null;
  try {
    const url = new URL(value, 'https://workspace.invalid');
    if (
      url.origin !== 'https://workspace.invalid' ||
      url.pathname !== '/calendar/clients/insights' ||
      url.hash
    )
      return null;
    const offset = /^\d{1,6}$/.test(url.searchParams.get('offset') || '')
      ? Math.min(100000, Number(url.searchParams.get('offset')))
      : 0;
    return insightsHref({
      months: url.searchParams.get('months') === '5' ? 5 : 2,
      offset,
      returnTo: url.searchParams.get('returnTo'),
    });
  } catch (_) {
    return null;
  }
}
module.exports = { insightsHref, clientInsightsReturnHref };
