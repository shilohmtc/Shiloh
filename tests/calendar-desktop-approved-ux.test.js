const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DESKTOP_GRID_END_MINUTES,
  compactWeekLabel,
  desktopTimeLabels,
  canonicalLaneStaffId,
  desktopFirstPaintStyles,
  desktopApprovedStyles,
  calendarDesktopApprovedClientScript,
} = require('../src/presentation/calendarDesktopApprovedUx');
const { workspaceIconClientScript } = require('../src/presentation/workspaceIconClient');
const { calendarEventToneCss } = require('../src/presentation/calendarEventVisuals');

const WEEK = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];

test('approved Desktop Calendar uses compact 7–12 Sep 2026 week label', () => {
  assert.equal(compactWeekLabel(WEEK), '7–12 Sep 2026');
});

test('approved Desktop Calendar display boundary ends at 18:00 only', () => {
  assert.equal(DESKTOP_GRID_END_MINUTES, 18 * 60);
  assert.deepEqual(desktopTimeLabels(), [
    '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
    '13:00', '14:00', '15:00', '16:00', '17:00', '18:00',
  ]);
  assert.equal(desktopTimeLabels().includes('19:00'), false);
  assert.equal(desktopTimeLabels().includes('20:00'), false);
});

test('shared appointment maps to one canonical visible practitioner lane', () => {
  assert.equal(canonicalLaneStaffId([22, 11], [11, 22, 33]), 11);
  assert.equal(canonicalLaneStaffId([22, 11], [33, 22, 11]), 22);
  assert.equal(canonicalLaneStaffId([22], [11, 22, 33]), 22);
});

test('Desktop Week withholds the canonical first paint until the approved planner is ready', () => {
  const css = desktopFirstPaintStyles();
  const script = calendarDesktopApprovedClientScript();
  assert.match(css, /data-calendar-desktop-pending="true"/);
  assert.match(css, /opacity:0;visibility:hidden/);
  assert.match(css, /1500ms forwards/);
  assert.match(script, /body\.removeAttribute\('data-calendar-desktop-pending'\)/);
});

test('Desktop enhancer preserves Phone by gating all planner changes above 700px', () => {
  const script = calendarDesktopApprovedClientScript();
  assert.match(script, /matchMedia\('\(min-width:701px\)'\)/);
  assert.doesNotMatch(desktopApprovedStyles(), /@media\(max-width:700px\)/);
  assert.doesNotMatch(script, /phone-calendar-v2/);
});

test('Desktop Week becomes selected-day practitioner columns with a Mon-Sat context strip', () => {
  const script = calendarDesktopApprovedClientScript();
  assert.match(script, /teamDay\.textContent='Team day'/);
  assert.match(script, /<span>Book<\/span>/);
  assert.match(script, /desktop-week-strip/);
  assert.match(script, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(script, /desktop-practitioner-grid/);
  assert.match(script, /--desktop-practitioner-count/);
  assert.match(script, /data-desktop-source-week/);
  assert.match(script, /\.view-practitioner\[data-staff-id\]/);
  assert.match(script, /CSS\.escape\(selected\)/);
});

test('Today navigation targets current Week and selected/today date states are textual and visual', () => {
  const script = calendarDesktopApprovedClientScript();
  assert.match(script, /today\.href=calendarHref\('week',businessToday\(\)\)/);
  assert.match(script, /' selected'/);
  assert.match(script, /' today'/);
  assert.match(script, /<small>Today<\/small>/);
  assert.match(script, /aria-current/);
});

test('one Book menu exposes single, couples, retrospective, block and leave controls', () => {
  const script = calendarDesktopApprovedClientScript();
  assert.match(script, /desktop-create-menu/);
  assert.match(script, /New appointment/);
  assert.match(script, /Couples massage/);
  assert.match(script, /\/calendar\/book\/couples\?/);
  assert.match(script, /calendarBookingKind='couples'/);
  assert.match(script, /desktop-create-divider/);
  assert.match(script, /Record past appointment/);
  assert.match(script, /data-calendar-operation="add-block"/);
  assert.match(script, /data-calendar-operation="add-leave"/);
  assert.match(script, /one\('\[data-calendar-operation="add-block"\], \[data-calendar-operation="add-leave"\]'\)/);
  assert.match(script, /fetch\(url\.pathname/);
  assert.match(script, /credentials:'same-origin'/);
  assert.match(script, /all\('\.operational-actions'\)\.forEach\(node=>node\.remove\(\)\)/);
  assert.match(script, /calendar-booking-slots/);
  assert.match(script, /cloneBookingSlots/);
  assert.match(script, /url\.searchParams\.set\('staff',String\(person\.id\)\)/);
  assert.match(script, />='18:00'/);
  assert.match(desktopApprovedStyles(), /desktop-practitioner-lane \.calendar-booking-slots\{display:block!important\}/);
});

test('appointment, block and leave presentation follows approved accessible treatments', () => {
  const css = desktopApprovedStyles();
  const semanticCss = calendarEventToneCss();
  const script = calendarDesktopApprovedClientScript();
  assert.match(css, /background-color:var\(--calendar-event-surface,#eef6f0\)/);
  assert.match(semanticCss, /data-event-tone="blocked"/);
  assert.match(semanticCss, /repeating-linear-gradient/);
  assert.match(semanticCss, /data-event-tone="leave"/);
  assert.match(semanticCss, /data-event-tone="no_show"/);
  assert.match(script, /node\.textContent='Block time'/);
  assert.match(script, /node\.textContent='Leave'/);
  assert.match(css, /-webkit-line-clamp:2/);
});

test('Desktop planner delegates vertical scrolling to page and avoids structural horizontal scrolling', () => {
  const css = desktopApprovedStyles();
  assert.match(css, /week-time-grid\{[^}]*overflow:visible!important;[^}]*max-height:none!important/);
  assert.match(css, /desktop-practitioner-grid\{[^}]*grid-template-columns:repeat\(var\(--desktop-practitioner-count\),minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css, /overflow-y:auto/);
});

test('#823 canonical appointment card remains the management target without inline Manage clutter', () => {
  const css = desktopApprovedStyles();
  assert.match(css, /event-card\[data-appointment-management-target="true"\]\{cursor:pointer\}/);
  assert.match(css, /event-card\[data-appointment-management-target="true"\] \.event-operation\{display:none!important\}/);
  const script = calendarDesktopApprovedClientScript();
  assert.doesNotMatch(script, /Adjust end time/);
});

test('Workspace iconography covers approved sidebar destinations and sign-out through the shared Lucide source', () => {
  const script = workspaceIconClientScript();
  for (const key of ['dashboard', 'calendar', 'clients', 'messages', 'staff', 'services', 'reports', 'clinicHours', 'logout']) {
    assert.match(script, new RegExp(`\"${key}\":`));
  }
  assert.match(script, /workspace-nav-icon/);
  assert.match(script, /data-shiloh-logout/);
  assert.match(script, /MutationObserver/);
});

test('generated browser scripts are syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(calendarDesktopApprovedClientScript()));
  assert.doesNotThrow(() => new Function(workspaceIconClientScript()));
});
