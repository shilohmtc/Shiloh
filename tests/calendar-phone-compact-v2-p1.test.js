const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PHONE_GRID_PIXELS_PER_HOUR,
  GRID_END_MINUTES,
  calendarPhoneCompactV2ClientScript,
  decoratePhoneCalendarV2,
  phoneCalendarV2Styles,
  renderPhoneCalendarControls,
  renderPhoneCalendarDock,
} = require('../src/presentation/calendarPhoneCompactV2');

function model(view = 'day') {
  return {
    view,
    dateKey: '2026-09-05',
    activeStaffId: 22,
    permittedStaff: [
      { id: 11, displayName: 'Abigail' },
      { id: 22, displayName: 'Christel' },
    ],
    timeline: {
      staff: [
        { id: 11, displayName: 'Abigail' },
        { id: 22, displayName: 'Christel' },
      ],
    },
    mutationCapability: {
      enabled: true,
      calendarScope: 'all_business',
      operations: ['calendar_block:manage', 'operational_leave:manage'],
    },
  };
}

test('Phone V2 controls collapse Calendar navigation to compact date, view and practitioner menus', () => {
  const html = renderPhoneCalendarControls(model('week'), { basePath: '/calendar/read-only' });
  assert.match(html, /data-phone-calendar-v2-controls/);
  assert.doesNotMatch(html, /data-phone-calendar-view="day"/);
  assert.match(html, /data-phone-calendar-view="week"/);
  assert.match(html, /data-phone-calendar-view="agenda"/);
  assert.match(html, /data-phone-calendar-view="month"/);
  assert.match(html, /data-phone-active-staff="22">Christel/);
  assert.match(html, /view=week&amp;date=2026-09-05&amp;staff=11&amp;staff=22&amp;activeStaff=11/);
  assert.match(html, /phone-date-weekdays[\s\S]*>M<[\s\S]*>S</);
});

test('Phone V2 top launcher binds all approved actions to the explicit active practitioner', () => {
  const html = renderPhoneCalendarDock(model(), {
    basePath: '/calendar/read-only',
    bookingPath: '/calendar/book',
    bookingAllowed: true,
    retrospectiveAllowed: true,
    retrospectiveBookingPath: '/calendar/book/past',
  });
  assert.match(html, /data-phone-calendar-v2-actions/);
  assert.match(html, /phone-today-action/);
  assert.match(html, /aria-label="Booking actions"/);
  assert.match(html, />\+ Booking</);
  assert.match(html, /\/calendar\/book\?date=2026-09-05&amp;staff=22/);
  assert.match(html, /\/calendar\/book\/couples\?date=2026-09-05/);
  assert.match(html, /\/calendar\/book\/past\?date=2026-09-05&amp;staff=22/);
  assert.match(html, />New appointment</);
  assert.match(html, />Couples booking</);
  assert.match(html, />Record past appointment</);
  assert.ok(html.indexOf('>New appointment<') < html.indexOf('>Couples booking<'));
  assert.ok(html.indexOf('>Couples booking<') < html.indexOf('>Record past appointment<'));
  assert.ok(html.indexOf('>Record past appointment<') < html.indexOf('phone-plus-divider'));
  assert.match(html, /data-calendar-operation="add-block"[^>]*data-staff-id="22"/);
  assert.match(html, /data-calendar-operation="add-leave"[^>]*data-staff-id="22"/);
  assert.match(html, />Leave</);
});

test('Phone V2 action launcher fails closed when mutation and booking authority are absent', () => {
  const restricted = model();
  restricted.mutationCapability = { enabled: false };
  const html = renderPhoneCalendarDock(restricted, { bookingAllowed: false });
  assert.match(html, /phone-today-action/);
  assert.doesNotMatch(html, /add-leave|add-block|Appointment/);
  assert.doesNotMatch(html, /phone-plus-menu/);
});

test('Phone V2 decoration is presentation-only and adds Week practitioner context without deleting canonical markup', () => {
  const source = '<!doctype html><html><head></head><body data-calendar-view="week"><div class="shell"><main class="calendar-view week-view"><div class="time-grid week-time-grid"></div></main><div class="footer-note">canonical footer</div></div></body></html>';
  const html = decoratePhoneCalendarV2(source, {
    model: model('week'),
    basePath: '/calendar/read-only',
    bookingPath: '/calendar/book',
    bookingAllowed: true,
  });
  assert.match(html, /data-phone-calendar-v2="true"/);
  assert.match(html, /data-phone-active-staff-id="22"/);
  assert.match(html, /data-phone-booking-path="\/calendar\/book"/);
  assert.match(html, /data-phone-week-planner/);
  assert.match(html, /data-phone-week-staff-id="22"/);
  assert.match(html, /\/calendar\/read-only\/phone-v2\.js/);
  assert.match(html, /canonical footer/);
});

test('Phone V2 uses a 30-minute visual grid and a clean 44px touch contract while retaining duration-derived events', () => {
  assert.equal(PHONE_GRID_PIXELS_PER_HOUR, 60);
  assert.equal(GRID_END_MINUTES, 18 * 60);
  const css = phoneCalendarV2Styles();
  assert.match(css, /repeating-linear-gradient\(to bottom,transparent 0,transparent 29px,var\(--line\) 29px,var\(--line\) 30px\)/);
  assert.match(css, /--phone-event-top/);
  assert.match(css, /--phone-event-height/);
  assert.match(css, /calendar-booking-slots\{pointer-events:none!important\}/);
  assert.match(css, /\.workspace-main \.day-view \.day-time-grid \.lanes\{display:block!important;min-width:0!important;width:100%!important\}/);
  assert.match(css, /\.workspace-main \.day-view \.day-time-grid \.lane\{display:none!important;min-width:0!important;width:100%!important/);
  assert.match(css, /\.workspace-main \.day-view \.day-time-grid \.lane\[data-phone-active-practitioner="true"\]\{display:block!important\}/);
  assert.match(css, /\.day-view \.lane-actions\{display:none!important\}/);
  assert.match(css, /\.workspace-main \.lane-actions,body\[data-phone-calendar-v2="true"\] \.workspace-main \.availability-menu\{display:none!important\}/);
  assert.match(css, /\.phone-calendar-v2-controls summary\{[^}]*min-height:44px/);
  assert.match(css, /\.phone-date-popover header a\{[^}]*min-height:44px/);
  assert.match(css, /\.phone-date-cell,\.phone-date-blank\{[^}]*min-height:44px/);
  assert.match(css, /\.phone-today-action,.phone-plus-menu>summary\{[^}]*min-height:44px/);
  assert.match(css, /\.time-rail\{height:660px!important\}/);
  assert.doesNotMatch(css, /phone-calendar-v2-dock/);
  assert.match(css, /\.week-time-grid\{margin:0!important;max-height:calc\(100dvh - 137px\)!important/);
  assert.match(css, /\.day-view \.positioned-event\{left:2px!important;right:2px!important;width:auto!important\}/);
  const genericPositionedRule = css.match(/body\[data-phone-calendar-v2="true"\] \.workspace-main \.positioned-event\{([^}]*)\}/);
  assert.ok(genericPositionedRule, 'generic Phone event geometry rule must remain present');
  assert.doesNotMatch(genericPositionedRule[1], /left:2px!important|right:2px!important|width:auto!important/);
  const mediaStart = css.indexOf('@media(max-width:700px){');
  const containerStart = css.indexOf('@container (max-height:44px){');
  const mediaEnd = css.lastIndexOf('\n}\n');
  assert.ok(mediaStart >= 0 && containerStart > mediaStart && mediaEnd > containerStart, 'short-card container rule must remain inside the Phone media gate');
});

test('Phone V2 client maps existing canonical event geometry to compact Phone density and snaps empty taps to 30 minutes', () => {
  const script = calendarPhoneCompactV2ClientScript();
  assert.match(script, /scale=0\.8333333333333334/);
  assert.match(script, /--phone-grid-top/);
  assert.match(script, /--phone-event-top/);
  assert.match(script, /--phone-event-height/);
  assert.match(script, /Math\.round\(raw\/30\)\*30/);
  assert.match(script, /new URLSearchParams\(\{date:context\.date,time:formatTime\(snapped\),staff:String\(context\.staffId\)\}\)/);
  assert.match(script, /node\.dataset\.bookingStaffId=activeStaff/);
  assert.match(script, /data-phone-week-staff-id/);
  assert.doesNotMatch(script, /fetch\(|\/calendar\/operations/);
});
