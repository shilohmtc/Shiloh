'use strict';
const { shellStart, formatDateTime } = require('./workspaceClientsUx');
const { escapeHtml } = require('./workspaceShell');
const { insightsHref } = require('./clientInsightsContext');
const { treatmentLabel } = require('./clientRecordedVisitsUx');

function periodDate(date) {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date + 'T00:00:00+02:00'));
}
function intervalLabel(interval) {
  if (interval.state !== 'regular')
    return interval.state === 'variable' ? 'Intervals vary' : 'Not enough history';
  const number = interval.days >= 14 ? Math.round(interval.days / 7) : interval.days,
    unit = interval.days >= 14 ? 'week' : 'day';
  return `About every ${number} ${unit}${number === 1 ? '' : 's'}`;
}
function renderInsightTreatment(treatment) {
  if (!treatment || treatment.state === 'unavailable') return 'Treatment details unavailable';
  if (treatment.state === 'incomplete')
    return `Treatment details incomplete<small>${treatment.missingVisits} visit${treatment.missingVisits === 1 ? ' has' : 's have'} incomplete details</small>`;
  const summary = {
    visitCount: 1,
    missingTreatmentVisits: 0,
    leaderCount: treatment.leaderCount,
    leaders: treatment.leaders,
  };
  const names =
    treatment.leaderCount > 1
      ? `<small>${treatment.leaders.map((l) => escapeHtml(l.name)).join(' · ')}${treatment.leaderCount > treatment.leaders.length ? ` · and ${treatment.leaderCount - treatment.leaders.length} more` : ''}</small>`
      : '';
  return escapeHtml(treatmentLabel(summary)) + names;
}
function renderAverages(averages) {
  const title = '<h2 id="insight-average-title">Average individual clients</h2>';
  if (!averages?.available)
    return `<section class="insight-panel" aria-labelledby="insight-average-title">${title}<p role="status">Client averages unavailable.</p></section>`;
  const cards = averages.items
    .map((item) => {
      const daily = item.kind === 'day';
      const label = daily ? 'Per open day · estimate' : `Per calendar ${item.kind}`;
      const value =
        item.available === false
          ? 'Unavailable'
          : item.average == null
            ? daily
              ? 'No complete open days'
              : 'Not enough complete periods'
            : item.average.toFixed(1);
      const detail =
        item.available === false
          ? item.reason
          : `${item.periods} complete ${daily ? 'open days' : item.kind + (item.periods === 1 ? '' : 's')}`;
      return `<div><dt>${label}</dt><dd><span class="insight-average-value">${escapeHtml(value)}</span><small>${escapeHtml(detail)}</small></dd></div>`;
    })
    .join('');
  const daily = averages.items[0];
  const evidence =
    daily.available === true
      ? `<p class="insight-caption">Open-day basis: ${daily.savedDays} saved-date openings and ${daily.assumedDays} dates using current hours. ${daily.outsideClientDays} recorded client-days on ${daily.outsideDates} dates outside the assumed open schedule are excluded from this daily estimate and remain in the other totals.</p>`
      : '';
  return `<section class="insight-panel" aria-labelledby="insight-average-title">${title}<dl class="insight-averages">${cards}</dl><p class="insight-caption">The daily estimate includes open days with no recorded clients. It uses current clinic hours and saved date decisions for earlier dates; historical opening hours may differ. Today is excluded. Missing visit history can lower the figures.</p>${evidence}<details><summary>How these averages are counted</summary><p class="insight-caption">Each client counts once per open date for the daily estimate, including visits outside its assumed clock hours. A shorter open day still counts as one day. Known closed dates are excluded; unresolved holiday decisions make the daily estimate unavailable. Current hours are not a reconstruction of historical hours. Weekly and monthly figures count each client once within each complete Monday–Sunday week or calendar month, including zero-activity periods. Partial boundary weeks and the current month are excluded from those averages. The daily estimate includes elapsed complete open dates in the current month. Dates and cutoffs use Africa/Johannesburg time.</p></details></section>`;
}
function renderComparison(comparison) {
  const title = '<h2 id="insight-comparison-title">Individual clients · last three months</h2>';
  if (!comparison?.available)
    return `<section class="insight-panel" aria-labelledby="insight-comparison-title">${title}<p role="status">Client comparison unavailable. Recorded activity could not be verified for these dates.</p></section>`;
  const { period, monthly } = comparison;
  const max = Math.max(1, ...monthly.map((item) => item.clients));
  const bars = monthly
    .map((item) => {
      const window = period.windows.find((entry) => entry.month === item.month);
      const label = new Intl.DateTimeFormat('en-ZA', {
        timeZone: 'Africa/Johannesburg',
        month: 'long',
        year: 'numeric',
      }).format(new Date(item.month + '-01T00:00:00+02:00'));
      return `<li><div class="insight-month-label"><span>${escapeHtml(label)}</span><strong>${item.clients} client${item.clients === 1 ? '' : 's'}</strong></div><span class="insight-bar" aria-hidden="true"><span style="width:${Math.round((item.clients / max) * 100)}%"></span></span><small>${escapeHtml(periodDate(window.startDate))} – ${escapeHtml(periodDate(window.endDate))}</small></li>`;
    })
    .join('');
  const cutoff =
    period.timeLabel === 'end of day'
      ? 'Compared through the end of each date range.'
      : `Compared up to ${escapeHtml(period.timeLabel)} each month.`;
  return `<section class="insight-panel" aria-labelledby="insight-comparison-title">${title}<p class="insight-caption">Same dates each month. ${cutoff} Each client counts once per month.</p>${period.clamped ? `<p class="insight-caption">All three months end on day ${period.day} because one month is shorter.</p>` : ''}<ul class="insight-comparison">${bars}</ul><p class="insight-caption">Three-month comparison, regardless of the selected view.</p></section>`;
}
function renderClientInsightsPage(model, options = {}) {
  const { period } = model;
  const href = (offset) =>
    insightsHref({ months: period.months, offset, returnTo: model.directoryHref });
  const periodLinks = `<nav class="insight-period" aria-label="Insights period">${[2, 5].map((months) => `<a class="button" href="${escapeHtml(insightsHref({ months, returnTo: model.directoryHref }))}"${period.months === months ? ' aria-current="page"' : ''}>${months} months</a>`).join('')}</nav>`;
  let content =
    '<section class="insight-panel" role="status"><h2>Client Insights unavailable</h2><p>Recorded activity could not be verified for this period. Try the shorter view, or review individual client profiles.</p></section>';
  if (model.available) {
    const max = Math.max(1, ...model.monthly.map((item) => item.visits));
    const trend = model.monthly
      .map((item) => {
        const label = new Intl.DateTimeFormat('en-ZA', {
          timeZone: 'Africa/Johannesburg',
          month: 'long',
          year: 'numeric',
        }).format(new Date(item.month + '-01T00:00:00+02:00'));
        return `<li><div class="insight-month-label"><span>${escapeHtml(label)}${item.month === period.partialMonth ? '<small>Month to date</small>' : ''}</span><strong>${item.visits} visit${item.visits === 1 ? '' : 's'}</strong></div><span class="insight-bar" aria-hidden="true"><span style="width:${Math.round((item.visits / max) * 100)}%"></span></span><small>${item.clients} client${item.clients === 1 ? '' : 's'} with recorded visits</small></li>`;
      })
      .join('');
    const returnTo = encodeURIComponent(href(model.offset));
    const rows = model.ranking
      .map(
        (client) =>
          `<li class="insight-client"><div class="insight-client-name"><a href="/calendar/clients/${encodeURIComponent(client.clientId)}?returnTo=${returnTo}">${escapeHtml(client.name)}</a>${client.status === 'archived' ? '<small>Archived profile</small>' : ''}</div><dl><div class="insight-bubble"><dt>Visits</dt><dd>${client.visits}</dd></div><div class="insight-bubble"><dt>Last recorded visit</dt><dd>${escapeHtml(formatDateTime(client.lastVisitAt).date)}</dd></div><div class="insight-bubble"><dt>Usual interval</dt><dd>${escapeHtml(intervalLabel(client.interval))}</dd></div><div class="insight-bubble insight-treatment"><dt>Most-received treatment</dt><dd>${renderInsightTreatment(client.treatment)}</dd></div></dl></li>`,
      )
      .join('');
    const empty = model.uniqueClients
      ? 'No clients on this page.'
      : 'No completed or no-charge visits are recorded in this period.';
    const previous =
      model.offset > 0
        ? `<a class="button" href="${escapeHtml(href(Math.max(0, model.offset - model.pageSize)))}">Previous clients</a>`
        : '<span></span>';
    const next = model.hasMore
      ? `<a class="button" href="${escapeHtml(href(model.offset + model.pageSize))}">Next clients</a>`
      : '<span></span>';
    content = `<dl class="insight-totals"><div><dt>Total visits</dt><dd>${model.totalVisits}</dd></div><div><dt>Individual clients</dt><dd>${model.uniqueClients}</dd></div></dl>${renderAverages(model.averages)}${renderComparison(model.comparison)}<section class="insight-panel" aria-labelledby="insight-trend-title"><h2 id="insight-trend-title">Monthly recorded visits</h2><p class="insight-caption">The current month is incomplete.</p><ul class="insight-months">${trend}</ul></section><section class="insight-panel" aria-labelledby="insight-ranking-title"><header><div><h2 id="insight-ranking-title">Most frequent clients</h2><p>Most visits first, then alphabetical. Details are for the selected period.</p></div></header>${rows ? `<ul class="insight-ranking">${rows}</ul><p class="insight-caption">Showing ${model.offset + 1}–${model.offset + model.ranking.length} of ${model.uniqueClients} clients</p>` : `<p>${empty}</p>${model.uniqueClients ? `<a class="button" href="${escapeHtml(href(0))}">First clients</a>` : ''}`}<nav class="pager" aria-label="Client ranking pages">${previous}${next}</nav></section>`;
  }
  const start = shellStart({
    title: 'Client Insights',
    subtitle: 'Recorded client visits and visiting patterns.',
    displayName: model.authority?.displayName,
    ...options,
    active: 'clientInsights',
    clientsHref: model.directoryHref || '/calendar/clients',
  }).replace('</style>', `${insightStyles}</style>`);
  return `${start}<main data-client-insights><div class="insight-controls"><a class="button" href="${escapeHtml(model.directoryHref || '/calendar/clients')}">Back to Client Directory</a>${periodLinks}</div><p class="insight-dates"><strong>${escapeHtml(periodDate(period.startDate))} – ${escapeHtml(periodDate(period.endDate))}</strong><span>Includes this month so far</span></p>${content}<p class="insight-note">Based on completed and no-charge visits recorded in Shiloh, within your access. Older or unlinked history may be incomplete. Treatment reflects recorded visits, not personal preference.</p></main></div></div></div></body></html>`;
}
const insightStyles = `[data-client-insights] .button{min-height:44px}[data-client-insights]{min-width:0}.insight-controls{display:flex;gap:14px;justify-content:space-between;align-items:center;flex-wrap:wrap}.insight-period{display:flex;gap:6px}.insight-period [aria-current="page"]{background:var(--leaf-soft);color:var(--leaf-deep);border-color:var(--leaf)}.insight-dates{display:flex;gap:6px;flex-direction:column;margin:20px 0;color:var(--ink);line-height:1.5}.insight-dates span,.insight-caption,.insight-note{color:var(--muted);font-size:.78rem;line-height:1.6}.insight-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0 0 16px}.insight-totals>div,.insight-panel{border:1px solid var(--line);background:var(--panel);border-radius:15px;padding:20px}.insight-totals dt{font-size:.85rem;color:var(--muted)}.insight-totals dd{font-size:1.8rem;font-weight:750;margin:8px 0 0}.insight-averages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.insight-averages dt,.insight-averages small{font-size:.78rem;color:var(--muted);line-height:1.6}.insight-averages dd small{display:block;font-weight:400}.insight-averages dd{font-size:1.5rem;font-weight:750;margin:6px 0;overflow-wrap:anywhere}@media(max-width:600px){.insight-averages{grid-template-columns:1fr}.insight-averages>div{padding:10px 0;border-bottom:1px solid var(--line)}}.insight-panel{margin-bottom:16px;min-width:0}.insight-panel h2{font-size:1.1rem;margin:0 0 8px}.insight-panel header p{font-size:.78rem;color:var(--muted);line-height:1.5}.insight-months,.insight-comparison,.insight-ranking{list-style:none;margin:0;padding:0}.insight-months,.insight-comparison{display:grid;gap:20px;margin-top:20px}.insight-month-label{display:flex;gap:10px;justify-content:space-between;align-items:center;font-size:.9rem}.insight-month-label small{display:block;color:var(--muted);font-size:.72rem;margin-top:3px}.insight-months li>small,.insight-comparison li>small{color:var(--muted);font-size:.75rem}.insight-bar{display:block;height:10px;border-radius:5px;background:var(--leaf-soft);margin:9px 0 5px;overflow:hidden}.insight-bar>span{display:block;height:100%;background:var(--leaf);border-radius:5px}.insight-client{display:grid;grid-template-columns:minmax(150px,1fr) minmax(350px,1.5fr);gap:12px;align-items:center;padding:14px 0;border-top:1px solid var(--line)}.insight-client-name{min-width:0;overflow-wrap:anywhere}.insight-client-name a{display:inline-flex;align-items:center;min-height:44px;font-size:.9rem;font-weight:750}.insight-client-name small{display:block;color:var(--muted);font-size:.72rem}.insight-client dl{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr);gap:8px;margin:0}.insight-client dt{font-size:.72rem;color:var(--muted);line-height:1.5;margin-bottom:5px}.insight-client dd{font-size:.82rem;font-weight:650;line-height:1.5;overflow-wrap:anywhere;margin:0}.insight-bubble{border-radius:18px;background:var(--surface-soft,#f3f4f2);padding:10px 12px;min-width:0}.insight-treatment{grid-column:1/-1}.insight-treatment dd small{display:block;font-size:.75rem;font-weight:400;color:var(--muted);margin-top:4px}.insight-note{margin:18px 2px}.insight-period a:focus-visible,[data-client-insights] a:focus-visible{outline:3px solid var(--leaf-deep);outline-offset:3px}@media(max-width:900px){.insight-client{grid-template-columns:minmax(0,1fr)}.insight-client dl{grid-column:1/-1;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr)}.insight-panel{padding:16px}}@media(max-width:460px){.insight-totals>div{padding:15px}.insight-totals dt{font-size:.76rem}.insight-client dl{gap:6px}.insight-bubble{padding:9px 10px}.insight-client dt{font-size:.68rem}}`;
module.exports = { renderClientInsightsPage, intervalLabel };
