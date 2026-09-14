const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function forbiddenTemporaryArtifacts() {
  const found = [];
  for (const directory of ['.shiloh-temp', '.control-temp']) {
    const tempDir = path.join(root, directory);
    if (fs.existsSync(tempDir)) found.push(`${directory}/`);
  }

  for (const [directory, prefix] of [
    ['.github/workflows', 'shiloh-temp-'],
    ['scripts', 'shiloh-temp-'],
    ['.github/workflows', 'control-temp-'],
    ['scripts', 'control-temp-'],
  ]) {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name.startsWith(prefix)) found.push(`${directory}/${entry.name}`);
    }
  }
  return found.sort();
}

test('canonical governance makes Clean Change part of meaningful implementation and completion', () => {
  const rules = read('docs/SHILOH_OPERATING_RULES.md');
  assert.match(rules, /### Clean Change and Complexity Gate/);
  for (const marker of [
    '**Reuse**', '**Smallest change**', '**Permanent vs temporary**',
    '**Authority duplication**', '**One-year test**', '**Retirement**',
    '**REPLACES NOW**', '**COEXISTS FOR A REASON**', '**REPLACES LATER**',
  ]) assert.ok(rules.includes(marker), `missing Clean Change marker: ${marker}`);
  assert.match(rules, /before implementation and again before merge\/release\/reconciliation judgment/);
  assert.match(rules, /Leaving Shiloh no more complex than necessary is part of the definition of complete/);
  assert.match(rules, /compact \*\*Clean Change\*\* record/);
});

test('release tree contains no explicitly temporary Shiloh engineering artifacts', () => {
  assert.deepEqual(forbiddenTemporaryArtifacts(), []);
});

test('retired Control rulebook is only a compatibility pointer to one Shiloh authority', () => {
  const current = read('docs/SHILOH_OPERATING_RULES.md');
  const historical = read('docs/SHILOH_CONTROL_RULES.md');
  assert.equal((current.match(/Shiloh Control/g) || []).length, 1);
  assert.match(current, /“Shiloh Control” is retired as a current operating concept/);
  assert.doesNotMatch(current, /10\/20\/30\/40|00 —/);
  assert.match(historical, /retired as a separate operating concept/);
  assert.match(historical, /SHILOH_OPERATING_RULES\.md/);
});

test('canonical governance makes Storybook and Playwright the interface quality standard', () => {
  const rules = read('docs/SHILOH_OPERATING_RULES.md');
  assert.match(rules, /### Interface quality standard/);
  assert.match(rules, /Storybook coverage/);
  assert.match(rules, /Playwright proof at desktop and phone sizes/);
  assert.match(rules, /keyboard and accessibility behaviour/);
  assert.match(rules, /exact-commit production verification/);
});

test('canonical CI runs the focused Clean Change hygiene gate', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /Run focused Clean Change hygiene test/);
  assert.match(ci, /node --test tests\/shiloh-clean-change-gate\.test\.js/);
});

test('engineering fast path requires impact scanning and coherent multi-file changes', () => {
  const guide = read('docs/SHILOH_ENGINEERING_FAST_PATH.md');
  for (const marker of [
    'Pre-CI contract impact scan',
    'Coherent multi-file changes',
    'CI parallelism rule',
    'Verification cadence',
  ]) assert.ok(guide.includes(marker), `missing Fast Path marker: ${marker}`);
  assert.match(guide, /search the repository for the exact route, symbol, field or selector/);
  assert.match(guide, /update affected assertions\/stubs\/proofs in the same candidate/);
  assert.match(guide, /GitHub tree\/commit primitives/);
  assert.match(guide, /full exact-head CI as the release gate/);
});

test('canonical CI parallelizes isolated proof families without dropping release gates', () => {
  const ci = read('.github/workflows/ci.yml');
  for (const job of ['test', 'calendar_browser_proofs', 'workspace_browser_proofs']) {
    assert.match(ci, new RegExp(`^  ${job}:`, 'm'), `missing CI job ${job}`);
  }
  assert.doesNotMatch(ci, /continue-on-error:\s*true/);

  for (const command of [
    'npm test',
    'calendar-operational-mutations-browser-proof.js',
    'calendar-clean-crm-v2-browser-proof.js',
    'calendar-mobile-staff-overview-browser-proof.js',
    'calendar-desktop-spatial-lanes-browser-proof.js',
    'calendar-view-parity-month-browser-proof.js',
    'calendar-spatial-phone-week-browser-proof.js',
    'calendar-cockpit-visual-proof.js',
    'calendar-retrospective-booking-browser-proof.js',
    'workspace-client-notifications-browser-proof.js',
    'workspace-dashboard-messages-browser-proof.js',
    'workspace-mobile-polish-visual-proof.js',
    'workspace-mobile-viewport-proof.js',
    'workspace-clients-visual-proof.js',
    'workspace-staff-visual-proof.js',
    'workspace-staff-access-readonly-browser-proof.js',
    'workspace-services-visual-proof.js',
  ]) assert.ok(ci.includes(command), `missing release-required CI command: ${command}`);

  const testStart = ci.indexOf('\n  test:');
  const calendarStart = ci.indexOf('\n  calendar_browser_proofs:');
  const workspaceStart = ci.indexOf('\n  workspace_browser_proofs:');
  assert.ok(testStart >= 0 && calendarStart > testStart && workspaceStart > calendarStart);

  const testBlock = ci.slice(testStart, calendarStart);
  const calendarBlock = ci.slice(calendarStart, workspaceStart);
  const workspaceBlock = ci.slice(workspaceStart);
  assert.ok(testBlock.includes('npm test'));
  assert.ok(!testBlock.includes('calendar-operational-mutations-browser-proof.js'));
  assert.ok(calendarBlock.includes('calendar-operational-mutations-browser-proof.js'));
  assert.ok(calendarBlock.includes('calendar-retrospective-booking-browser-proof.js'));
  assert.ok(workspaceBlock.includes('workspace-dashboard-messages-browser-proof.js'));
  assert.ok(workspaceBlock.includes('workspace-services-visual-proof.js'));
});
