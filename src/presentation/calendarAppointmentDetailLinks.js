'use strict';

const BUSINESS_TIMEZONE = 'Africa/Johannesburg';

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function businessDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function appointmentDetailHref({ appointmentId, startsAt, dateKey, allStaff = true } = {}) {
  const id = positiveId(appointmentId);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))
    ? String(dateKey)
    : businessDateKey(startsAt);
  if (!id || !day) return null;
  const params = new URLSearchParams({ view: 'week', date: day, appointment: String(id) });
  if (allStaff) params.set('staff', 'all');
  return `/calendar/read-only?${params.toString()}`;
}

function decorateClientAppointmentHistory(html, appointments = []) {
  const rows = Array.isArray(appointments) ? appointments : [];
  let index = 0;
  return String(html || '').replace(
    /<article class="history-row([^"]*)">([\s\S]*?)<\/article>/g,
    (match, tone, body) => {
      const appointment = rows[index++];
      const href = appointmentDetailHref({
        appointmentId: appointment?.id,
        startsAt: appointment?.starts_at,
        allStaff: true,
      });
      if (!href) return match;
      return `<a class="history-row history-row-link${tone}" data-appointment-detail-link="${positiveId(appointment.id)}" href="${escapeAttribute(href)}" title="Open appointment details" style="text-decoration:none;min-height:44px">${body}<span class="history-open"><span>Open</span><span aria-hidden="true">›</span></span></a>`;
    },
  );
}

function decorateWorkspaceAppointmentLinks(html) {
  return String(html || '').replace(
    /<article class="appointment([^"]*)"([\s\S]*?)<\/article>/g,
    (match) => {
      const idMatch = match.match(/data-(?:dashboard-appointment|dashboard-attention-appointment)="(\d+)"/);
      if (!idMatch) return match;
      const id = positiveId(idMatch[1]);
      if (!id) return match;
      return match.replace(
        /href="(\/calendar\/read-only\?[^\"]*)"/,
        (_hrefMatch, href) => {
          if (/(?:&amp;|&)appointment=/.test(href)) return _hrefMatch;
          const separator = href.includes('?') ? '&amp;' : '?';
          return `href="${href}${separator}appointment=${id}" data-appointment-detail-link="${id}"`;
        },
      );
    },
  );
}

module.exports = {
  BUSINESS_TIMEZONE,
  businessDateKey,
  appointmentDetailHref,
  decorateClientAppointmentHistory,
  decorateWorkspaceAppointmentLinks,
};
