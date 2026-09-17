'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  IOS_APPLE_TOUCH_ICON_HREF,
  preferIosAppleTouchIcon,
} = require('../src/routes/workspacePwa');

test('iOS Home Screen advertises a dedicated 180px Apple touch icon', () => {
  const legacy = '<head><link rel="apple-touch-icon" sizes="192x192" href="/calendar/pwa/icon-192.png?v=960-v1"></head>';
  const html = preferIosAppleTouchIcon(legacy);

  assert.match(html, /rel="apple-touch-icon" sizes="180x180"/);
  assert.match(html, /\/calendar\/pwa\/apple-touch-icon-180\.png\?v=ios-optical-v2/);
  assert.doesNotMatch(html, /apple-touch-icon" sizes="192x192"/);
  assert.equal(IOS_APPLE_TOUCH_ICON_HREF, '/calendar/pwa/apple-touch-icon-180.png?v=ios-optical-v2');
});

test('dedicated Apple touch asset is an exact 180x180 PNG', () => {
  const file = path.join(__dirname, '../public/assets/pwa/shiloh-apple-touch-180.png');
  const png = fs.readFileSync(file);

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
  assert.ok(png.length > 500);
});
