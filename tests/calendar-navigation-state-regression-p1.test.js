const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderWorkspaceNavigation,
} = require('../src/presentation/workspaceShell');
const {
  desktopApprovedStyles,
  calendarDesktopApprovedClientScript,
} = require('../src/presentation/calendarDesktopApprovedUx');
const {
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
} = require('../src/presentation/calendarCreateBookingUx');
const { DESTINATIONS } = require('../src/services/workspaceNavigation');
const { dashboardCalendarHref } = require('../src/routes/workspaceOperational');

test('#895 ordinary Workspace Calendar navigation opens Week with canonical All staff selection', () => {
  const html = renderWorkspaceNavigation({
    active: 'dashboard',
    dashboardHref: '/calendar/dashboard',
    clientsHref: '/calendar/clients',
    calendarHref: DESTINATIONS.calendar,
  });
  assert.equal(DESTINATIONS.calendar, '/calendar/read-only?view=week&staff=all');
  assert.match(html, /data-workspace-destination="calendar" href="\/calendar\/read-only\?view=week&amp;staff=all"/);
  assert.doesNotMatch(html, /data-workspace-destination="calendar"[^>]*href="[^"]*date=/);
});

test('#895 Dashboard Calendar entry binds the exact operational date into Week All staff', () => {
  assert.equal(
    dashboardCalendarHref({ operationalDateKey: '2026-09-11', mode: 'business_overview' }),
    '/calendar/read-only?view=week&date=2026-09-11&staff=all',
  );
  assert.equal(
    dashboardCalendarHref({ operationalDateKey: '2026-09-11', mode: 'personal' }),
    '/calendar/read-only?view=week&date=2026-09-11&staff=all',
  );
  assert.notEqual(dashboardCalendarHref({ operationalDateKey: '2026-09-11', mode: 'business_overview' }), '/calendar/read-only');
});

test('#858 Desktop Day lanes fill available middle workspace while preserving the 300px readability floor', () => {
  const css = desktopApprovedStyles();
  assert.match(css, /\.day-time-grid \.lanes\{grid-template-columns:repeat\(var\(--lane-count\),minmax\(300px,1fr\)\)!important;min-width:max-content!important;width:100%!important\}/);
  assert.match(css, /\.day-time-grid \.lane\{min-width:300px!important;width:auto!important\}/);
});

test('#977 Desktop create launcher is a concise Book menu with linked bookings', () => {
  const script = calendarDesktopApprovedClientScript();
  assert.match(script, /<summary[^>]*>.*<span>Book<\/span><\/summary>/);
  assert.match(script, /Record past appointment/);
  assert.match(script, /New appointment/);
  assert.match(script, /Couples massage/);
  assert.match(script, /Book a Couples Massage for two guests/);
  assert.match(script, /Group booking/);
  assert.doesNotMatch(script, /<summary>.*<span>New appointment<\/span><\/summary>/);
});

test('#948 booking return preserves safe history and otherwise restores canonical Week All staff', () => {
  const html = renderCalendarCreateBookingPage({
    options: { staff: [], services: [] },
    prefill: { date: '2026-09-11', staffId: 42 },
  });
  assert.match(html, /data-back-calendar href="\/calendar\/read-only\?view=week&amp;date=2026-09-11&amp;staff=all"/);

  const script = calendarCreateBookingClientScript();
  assert.match(script, /calendarHistoryReturnAvailable/);
  assert.match(script, /ref\.pathname==='\/calendar\/workspace'/);
  assert.match(script, /ref\.pathname==='\/calendar\/read-only'/);
  assert.match(script, /history\.back\(\)/);
  assert.match(script, /var params=new URLSearchParams\(\{view:'week',date:[^}]+staff:'all'\}\)/);
  assert.doesNotMatch(script, /var params=new URLSearchParams\(\{view:'day'/);
  assert.match(script, /window\.location\.assign\('\/calendar\/read-only\?'/);
});
