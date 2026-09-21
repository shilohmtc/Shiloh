const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { calendarPhoneAllStaffClientScript } = require('../src/presentation/calendarPhoneAllStaffUx');

test('#895 Phone Week defaults to all permitted staff columns', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /data-phone-week-staff-id/);
  assert.match(script, /phoneWeekStaffRendered/);
  assert.match(script, /selectedIds=parseMode\(\)/);
  assert.match(script, /if\(!raw\|\|raw==='all'\)return \[\.\.\.permittedIds\]/);
  assert.match(script, /permittedIds\.forEach\(id=>url\.searchParams\.append\('staff',id\)\)/);
  assert.doesNotMatch(script, /permittedStaff|calendarScope|all_business/);
});

test('#895 staff chips toggle persistent named columns instead of mutually-exclusive focus', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /phone-staff-column-header/);
  assert.match(script, /phone-staff-column-name/);
  assert.match(script, /planner\?\.parentNode\?\.insertBefore\(columnHeader,planner\.nextSibling\)/);
  assert.match(script, /selectedIds=selectedIds\.includes\(id\)\?selectedIds\.filter/);
  assert.match(script, /staffButtons\.forEach\(button=>button\.addEventListener\('click'/);
  assert.match(script, /event\.stopImmediatePropagation\(\)/);
  assert.match(script, /selectedIds=\[\.\.\.permittedIds\]/);
  assert.match(script, /allButton\.addEventListener/);
});

test('#895 visible events are laid out inside their selected practitioner column with overlap sublanes', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /function eventOwner\(node\)/);
  assert.match(script, /function layoutStaffGroup\(nodes,columnIndex,columnCount\)/);
  assert.match(script, /base=columnIndex\*100\/columnCount/);
  assert.match(script, /laneWidth=\(100\/columnCount\)\/laneCount/);
  assert.match(script, /node\.dataset\.phoneColumnVisible=String\(visible\)/);
  assert.match(script, /phone-staff-column-dividers/);
  assert.match(script, /--phone-staff-column-tints/);
  assert.match(script, /applyStaffTone\(node,id\)/);
  assert.match(script, /week-time-grid\{overflow:hidden!important/);
  assert.doesNotMatch(script, /scrollLeft/);
});

test('#895 client behavior consumes the server-rendered week strip without rebuilding navigation', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.doesNotMatch(script, /function addMonthContext\(\)|function addWeekNavigation\(\)/);
  assert.match(script, /\[data-phone-week-nav\]/);
  assert.doesNotMatch(script, /phone-calendar-day-context/);
  assert.doesNotMatch(script, /formatActiveDate/);
});

test('#895 Phone Calendar enhancement no longer constructs or relocates the primary toolbar', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.doesNotMatch(script, /function buildUtilityBar\(\)/);
  assert.doesNotMatch(script, /appendChild\(plus\)|insertBefore\(bar/);
  assert.doesNotMatch(script, /document\.createElement\('nav'\)/);
  assert.match(script, /\[data-phone-calendar-direct-view\]/);
});

test('#895 server-owned Today links remain part of persisted multi-staff navigation state', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /\[data-phone-calendar-today\]/);
  assert.match(script, /function syncModeLinks\(\)/);
  assert.doesNotMatch(script, /function todayWeekHref\(\)|createElement\('a'\)/);
});

test('#895 Week fits 07:00 to 18:00 into the dynamic phone viewport without vertical panning', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /function fitCalendarViewport\(\)/);
  assert.match(script, /window\.visualViewport\?\.height\|\|innerHeight/);
  assert.match(script, /function fitWeekGrid\(\)/);
  assert.match(script, /const baseHeight=660/);
  assert.match(script, /--phone-week-grid-height/);
  assert.match(script, /week-time-grid\{overflow:hidden!important/);
  assert.match(script, /phoneAfterClose=String\(hour>18\)/);
  assert.match(script, /if\(hour===18\)node\.style\.transform='translateY\(-100%\)'/);
  assert.match(script, /Math\.max\(30,eventHeight\*ratio\)/);
});

test('#895 Phone Week polish keeps opening time visible with subtle hourly structure', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /phoneOpenLabel=String\(hour===7\)/);
  assert.match(script, /data-phone-open-label="true"\]\{transform:translateY\(3px\)!important\}/);
  assert.match(script, /time-rail span\{color:var\(--ink\)!important;font-size:clamp\(\.5rem,2vw,\.62rem\)!important;font-weight:850!important/);
  assert.match(script, /phone-staff-column-name\{[^}]*color:var\(--leaf-deep\)[^}]*font-weight:900/);
  assert.match(script, /phone-staff-column-name\[data-phone-staff-toned="true"\]\{[^}]*background:var\(--phone-staff-soft\)[^}]*box-shadow:inset 0 3px 0 var\(--phone-staff-accent\)/);
  assert.match(script, /time-column\{[^}]*background:var\(--phone-staff-column-tints,#fff\)!important[^}]*border-right:1px solid var\(--line-strong\)!important/);
  assert.match(script, /time-column:before\{[^}]*repeating-linear-gradient\(to bottom[^}]*var\(--line\)[^}]*calc\(100% \/ 11\)[^}]*!important/);
  assert.doesNotMatch(script, /time-column:before\{[^}]*background:none!important/);
  assert.match(script, /phone-staff-column-dividers/);
  assert.match(script, /phone-staff-column-header\{[^}]*border-top:1px solid var\(--line-strong\)[^}]*border-bottom:1px solid var\(--line-strong\)/);
});

test('#895 fitted Week preserves empty-slot booking time and practitioner semantics', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /function installFittedBookingTap\(\)/);
  assert.match(script, /rawMinutes=7\*60\+\(y\/rect\.height\)\*\(11\*60\)/);
  assert.match(script, /Math\.min\(18\*60-30/);
  assert.match(script, /Math\.floor\(\(x\/rect\.width\)\*selectedIds\.length\)/);
  assert.match(script, /location\.assign\(bookingPath\+'\?'\+params\.toString\(\)\)/);
});

test('#895 full-height Month and 18:00 operating boundary remain', () => {
  const script = calendarPhoneAllStaffClientScript();
  assert.match(script, /--phone-calendar-surface-height/);
  assert.match(script, /calendar-view\.month-view\{display:flex!important;flex-direction:column!important/);
  assert.match(script, /month-days\{min-height:0!important;height:100%!important;grid-auto-rows:1fr!important/);
  assert.match(script, /phoneAfterClose=String\(hour>18\)/);
  assert.match(script, /data-phone-after-close/);
});

test('#895 production Calendar phone-v2 asset still composes canonical V2 with bounded column-toggle enhancement', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/calendar.js'), 'utf8');
  assert.match(routeSource, /calendarPhoneCompactV2ClientScript/);
  assert.match(routeSource, /calendarPhoneAllStaffClientScript/);
  assert.match(routeSource, /router\.get\('\/read-only\/phone-v2\.js'/);
});
