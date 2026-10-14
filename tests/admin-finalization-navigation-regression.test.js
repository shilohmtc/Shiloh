const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bookingUpdatePath = path.join(__dirname, '..', 'src', 'services', 'adminBookingUpdate.js');

const bookingUpdateSource = fs.readFileSync(bookingUpdatePath, 'utf8');

test('Admin/Menu/Hi escape clears a stale Manage booking session before numeric prompting', () => {
  const escapeMatch = bookingUpdateSource.match(/if\s*\(\s*\['menu',\s*'admin menu',\s*'home',\s*'admin'\]\.includes\(n\)/);
  const numericPromptIndex = bookingUpdateSource.indexOf('Please send the numeric Shiloh appointment number.');
  assert.ok(escapeMatch && Number.isInteger(escapeMatch.index), 'stale Manage booking escape is missing');
  assert.ok(numericPromptIndex >= 0, 'numeric appointment prompt is missing');
  assert.ok(escapeMatch.index < numericPromptIndex, 'stale Manage booking can still intercept Admin/Menu/Hi before escape');
});
