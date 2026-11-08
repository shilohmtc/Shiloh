'use strict';
const { escapeHtml } = require('./workspaceShell');

function visitDate(value) {
  return value ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : 'None recorded';
}
function treatmentLabel(summary) {
  if (!summary.visitCount) return 'No treatments recorded in this period';
  if (summary.missingTreatmentVisits) return 'Treatment details incomplete';
  if (!summary.leaders.length) return 'Treatment details unavailable';
  if (summary.leaderCount > 1) return `${summary.leaderCount} treatments tied · ${summary.leaders[0].visits} visit${summary.leaders[0].visits === 1 ? '' : 's'} each`;
  const leader = summary.leaders[0];
  return `${leader.name} · ${leader.visits} visit${leader.visits === 1 ? '' : 's'}`;
}
function renderCompactRecordedVisits(summary) {
  if (!summary) return '';
  if (!summary.available) return '<span class="client-visit-compact" data-recorded-visit-summary>Recorded visit summary unavailable</span>';
  return `<span class="client-visit-compact" data-recorded-visit-summary><span>${summary.visitCount} recorded visit${summary.visitCount === 1 ? '' : 's'} · past 12 months</span><span>Most received: ${escapeHtml(treatmentLabel(summary))}</span></span>`;
}
function renderRecordedVisits(summary, { clientId, returnTo } = {}) {
  if (!summary) return '';
  const query = new URLSearchParams({ services: 'appointments', ...(returnTo ? { returnTo } : {}) });
  const link = `<a class="button" href="/calendar/clients/${encodeURIComponent(String(clientId))}?${escapeHtml(query.toString())}#client-appointments">View appointments</a>`;
  if (!summary.available) return `<section class="client-recorded-visits" aria-label="Recorded visits"><h3>Recorded visits</h3><p>Visit summary unavailable. Review the linked appointments for recorded history.</p>${link}</section>`;
  const interval = summary.interval;
  const value = interval.days >= 14 ? Math.round(interval.days / 7) : interval.days;
  const unit = interval.days >= 14 ? 'week' : 'day';
  const rhythm = interval.state === 'regular' ? `About every ${value} ${unit}${value === 1 ? '' : 's'}` : interval.state === 'variable' ? 'Recorded intervals vary' : 'Not enough recorded history';
  const range = interval.state === 'sparse' ? '' : `<small>Recorded gaps: ${interval.min === interval.max ? interval.min : interval.min + '–' + interval.max} days</small>`;
  const names = summary.leaderCount > 1 && !summary.missingTreatmentVisits
    ? `<small>${summary.leaders.map(item => escapeHtml(item.name)).join(' · ')}${summary.leaderCount > summary.leaders.length ? ` · and ${summary.leaderCount - summary.leaders.length} more` : ''}</small>` : '';
  return `<section class="client-recorded-visits" aria-label="Recorded visits" data-recorded-visit-summary><header><div><h3>Recorded visits</h3><p>${escapeHtml(visitDate(summary.periodStart + 'T00:00:00+02:00'))} – ${escapeHtml(visitDate(summary.asOf))} · past 12 months</p></div>${link}</header><dl class="recorded-visit-grid"><div><dt>Last recorded visit</dt><dd>${escapeHtml(visitDate(summary.lastVisitAt))}</dd></div><div><dt>Visits in the past 12 months</dt><dd>${summary.visitCount}</dd></div><div><dt>Most-received treatment</dt><dd>${escapeHtml(treatmentLabel(summary))}${names}</dd></div><div><dt>Usual interval</dt><dd>${escapeHtml(rhythm)}${range}</dd></div></dl><p class="recorded-visit-note">Completed and no-charge visits linked to this profile. Older records may be incomplete. Only history you can access is included.${summary.missingTreatmentVisits ? ` ${summary.missingTreatmentVisits} visit${summary.missingTreatmentVisits === 1 ? ' has' : 's have'} incomplete treatment details.` : ''}</p></section>`;
}
const recordedVisitStyles = `.client-visit-compact{display:grid;gap:3px;font-size:.75rem;line-height:1.4;color:var(--muted);min-width:0;overflow-wrap:anywhere}.client-recorded-visits{margin-top:20px;padding-top:18px;border-top:1px solid var(--line)}.client-recorded-visits header{display:flex;align-items:center;justify-content:space-between;gap:12px}.client-recorded-visits h3{margin:0;font-size:1rem}.client-recorded-visits p{color:var(--muted);font-size:.78rem;line-height:1.5}.client-recorded-visits header p{margin:5px 0 0}.recorded-visit-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin:20px 0 14px}.recorded-visit-grid dt{font-size:.75rem;color:var(--muted);margin-bottom:7px}.recorded-visit-grid dd{margin:0;font-size:.88rem;font-weight:750;line-height:1.5;overflow-wrap:anywhere}.recorded-visit-grid small{display:block;font-size:.75rem;font-weight:400;color:var(--muted);margin-top:5px}.client-home:not([data-client-home-section="overview"]) .client-recorded-visits{display:none}@media(max-width:800px){.recorded-visit-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:460px){.client-recorded-visits header{align-items:start;flex-direction:column}.recorded-visit-grid{gap:16px 12px}}`;
module.exports = { visitDate, treatmentLabel, renderCompactRecordedVisits, renderRecordedVisits, recordedVisitStyles };
