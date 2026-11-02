'use strict';
const { escapeHtml: h } = require('./workspaceShell');

function requestTime(value, now) {
  if (!value) return null;
  const time = new Date(value).getTime();
  const current = new Date(now).getTime();
  return Number.isFinite(time) && Number.isFinite(current) && time <= current ? time : null;
}

function requestAge(value, now) {
  const time = requestTime(value, now);
  if (time === null) return '';
  const hours = Math.floor((new Date(now).getTime() - time) / 3600000);
  const days = Math.floor(hours / 24);
  const age = hours < 1 ? 'less than an hour ago'
    : hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'} ago`
      : `${days} day${days === 1 ? '' : 's'} ago`;
  const exact = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(time));
  return `<p class="request-age"><time datetime="${new Date(time).toISOString()}">Requested ${age}</time> · ${h(exact)} SAST</p>`;
}

// Only orders the already-authorized dashboard projection. No status or action changes.
function renderRequestQueue(entries, now) {
  const rows = entries.map((entry, index) => ({ ...entry, index, time: requestTime(entry.requestedAt, now) }))
    .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.index - b.index);
  const datedCard = entry => entry.html.replace(/^(<article\b[^>]*>)/, `$1${requestAge(entry.requestedAt, now)}`);
  if (rows.length < 2) return rows.map(datedCard).join('');
  const waiting = rows.filter(entry => entry.awaitingClient).length;
  return `<div data-request-queue><div class="request-filter-row" data-request-filter-wrap hidden><label>Show requests <select data-request-filter><option value="all">All requests (${rows.length})</option><option value="staff">Needs staff response (${rows.length - waiting})</option><option value="client">Awaiting client (${waiting})</option></select></label></div>${rows.some(entry => entry.time !== null) ? '<p class="request-queue-order">Oldest requests first; undated requests follow.</p>' : ''}<p class="request-filter-status" data-request-filter-status role="status" aria-live="polite"></p>${rows.map(entry => `<div data-request-state="${entry.awaitingClient ? 'client' : 'staff'}">${datedCard(entry)}</div>`).join('')}</div>`;
}

function requestQueueClientScript() {
  return `(()=>{'use strict';document.querySelectorAll('[data-request-queue]').forEach(root=>{const select=root.querySelector('[data-request-filter]');const rows=[...root.querySelectorAll('[data-request-state]')];root.querySelector('[data-request-filter-wrap]').hidden=false;select.addEventListener('change',()=>{const filter=['staff','client'].includes(select.value)?select.value:'all';let shown=0;rows.forEach(row=>{row.hidden=filter!=='all'&&row.dataset.requestState!==filter;if(!row.hidden)shown++;});root.querySelector('[data-request-filter-status]').textContent='Showing '+shown+' of '+rows.length+' requests.';});});})();`;
}

const requestQueueStyles = `[data-request-state]+[data-request-state]{margin-top:12px}.request-filter-row{margin-top:14px}.request-filter-row label{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-weight:700;font-size:13px}.request-filter-row select{max-width:100%;min-height:44px;padding:8px;border:1px solid var(--line);border-radius:9px;background:var(--panel,#fffdf9);color:var(--ink);font:inherit}.request-filter-row select:focus-visible{outline:2px solid var(--leaf,#496b5a);outline-offset:2px}.request-age,.request-queue-order,.request-filter-status{font-size:12px;line-height:1.5;color:var(--muted,#56685f);margin:8px 0}.request-age{margin-top:0}.request-filter-status:empty{display:none}[data-request-queue] [hidden]{display:none!important}`;

module.exports = { requestAge, renderRequestQueue, requestQueueClientScript, requestQueueStyles };
