'use strict';
// This legacy fixture has exactly five undated, staff-response requests.
// Accept only its new filter chrome; preserve every byte of every request card.
// Age, ordering, action, field, identity and script changes still fail comparison.
function stripUndatedRebookFilterChrome(html) {
  const opening = '<div data-request-queue><div class="request-filter-row" data-request-filter-wrap hidden><label>Show requests <select data-request-filter><option value="all">All requests (5)</option><option value="staff">Needs staff response (5)</option><option value="client">Awaiting client (0)</option></select></label></div><p class="request-filter-status" data-request-filter-status role="status" aria-live="polite"></p>';
  const escaped = opening.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const queue = new RegExp(escaped + '((?:<div data-request-state="staff"><article\\b[\\s\\S]*?<\\/article><\\/div>){5})<\\/div>', 'g');
  return html.replace(queue, (_, cards) => cards.replace(/<div data-request-state="staff">(<article\b[\s\S]*?<\/article>)<\/div>/g, '$1'));
}
module.exports = { stripUndatedRebookFilterChrome };
