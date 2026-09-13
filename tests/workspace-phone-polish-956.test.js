'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PWA_VERSION,
  workspacePwaHeadMarkup,
  workspacePwaIconSvg,
} = require('../src/presentation/workspacePwa');
const {
  dateTimeLabel,
  initialCredentialList,
  manageScript,
} = require('../src/presentation/staffPasskeyUx');
const {
  renderCalendarCreateBookingPage,
  calendarCreateBookingClientScript,
} = require('../src/presentation/calendarCreateBookingUx');

test('#956 installed icon has balanced optical proportions and an explicit Apple touch asset', () => {
  const svg = workspacePwaIconSvg(192);
  assert.equal(PWA_VERSION, '956-v1');
  assert.match(svg, /<rect x="12" y="12" width="168" height="168"/);
  assert.match(svg, /<circle cx="96" cy="67" r="38"/);
  assert.match(workspacePwaHeadMarkup(), /rel="apple-touch-icon" sizes="192x192"/);
});

test('#956 phone booking controls defeat native intrinsic width and neutral match guidance clears', () => {
  const html = renderCalendarCreateBookingPage();
  assert.match(html, /input\[type=date\],\.field input\[type=time\]\{-webkit-appearance:none;appearance:none/);
  assert.match(html, /min-inline-size:0/);
  assert.match(html, /font-size:16px/);
  const client = calendarCreateBookingClientScript();
  assert.match(client, /if\(!message\)\{node\.hidden=true/);
  assert.match(client, /button\.addEventListener\('click',function\(\)\{selectClient\(client\);setStatus\(''\);\}\)/);
  assert.doesNotMatch(client, /Multiple clients matched\. Explicitly select one/);
  assert.match(client, /That booking cannot be prepared/);
  assert.match(client, /Shiloh could not complete the booking/);
});

test('#956 passkey metadata includes Johannesburg date and 24-hour time', () => {
  assert.equal(dateTimeLabel('2026-09-13T15:05:00.000Z'), '13/09/2026 17:05');
  const html = initialCredentialList([
    { createdAt: '2026-09-13T15:05:00.000Z', lastUsedAt: '2026-09-13T15:42:00.000Z', backedUp: true },
  ]);
  assert.match(html, /Added 13\/09\/2026 17:05 · last used 13\/09\/2026 17:42/);
  assert.match(manageScript(), /timeZone:'Africa\/Johannesburg'/);
});
