'use strict';
// Preserve only the existing Directory filters; never accept arbitrary return URLs.
function clientDirectoryReturnHref(value) {
  if (typeof value !== 'string' || value.length > 2000 || !value.startsWith('/calendar/clients?')) return null;
  try {
    const url = new URL(value, 'https://workspace.invalid');
    if (url.origin !== 'https://workspace.invalid' || url.pathname !== '/calendar/clients' || url.hash) return null;
    const params = new URLSearchParams();
    const q = url.searchParams.get('q');
    if (q && q.length <= 120) params.set('q', q);
    const status = url.searchParams.get('status');
    if (['active','archived','all'].includes(status)) params.set('status',status);
    const offset = url.searchParams.get('offset');
    if (/^\d{1,7}$/.test(offset || '')) params.set('offset',String(Number(offset)));
    return '/calendar/clients' + (params.size ? '?' + params.toString() : '');
  } catch (_error) { return null; }
}
module.exports = {clientDirectoryReturnHref};
