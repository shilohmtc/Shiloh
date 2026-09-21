const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ICONS, renderLucideIcon } = require('../src/presentation/lucideIcons');
const { workspaceIconClientScript } = require('../src/presentation/workspaceIconClient');
const { iconSvg, desktopApprovedStyles, DESKTOP_GRID_END_MINUTES } = require('../src/presentation/calendarDesktopApprovedUx');

test('#835 pins official Lucide and npm lockfile at one exact version', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.dependencies.lucide, '1.43.0');
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].dependencies.lucide, '1.43.0');
  assert.equal(lock.packages['node_modules/lucide'].version, '1.43.0');
});

test('#835 shared renderer consumes upstream Lucide node data and emits accessible currentColor SVG', () => {
  assert.ok(Array.isArray(ICONS.dashboard));
  assert.ok(Array.isArray(ICONS.problemReports));
  const svg = renderLucideIcon('dashboard', { className: 'workspace-nav-icon', size: 18 });
  assert.match(svg, /^<svg class="workspace-nav-icon"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /focusable="false"/);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /<rect width="7" height="9" x="3" y="3" rx="1"><\/rect>/);
  assert.throws(() => renderLucideIcon('not-a-shiloh-icon'), /Unknown Shiloh Lucide icon/);
});

test('#835 Workspace and Calendar icons come from the shared renderer, not handwritten path registries', () => {
  const workspaceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'presentation', 'workspaceIconClient.js'), 'utf8');
  const calendarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'presentation', 'calendarDesktopApprovedUx.js'), 'utf8');
  assert.doesNotMatch(workspaceSource, /const PATHS=/);
  assert.doesNotMatch(calendarSource, /function lucidePath/);
  assert.match(workspaceSource, /renderLucideIcon/);
  assert.match(calendarSource, /renderLucideIcon/);
  assert.match(workspaceIconClientScript(), /workspace-nav-icon/);
  assert.match(workspaceIconClientScript(), /"problemReports":/);
  assert.match(iconSvg('calendarPlus'), /calendar-action-icon/);
});

test('#835 polish strengthens selected-day and appointment-card hierarchy without changing #832 geometry', () => {
  const css = desktopApprovedStyles();
  assert.match(css, /desktop-week-day\.selected\{background:#234f3b/);
  assert.match(css, /box-shadow:0 2px 8px rgba\(35,79,59,.18\)/);
  assert.match(css, /event-card\{[^}]*padding:7px 8px[^}]*box-shadow:0 2px 8px rgba\(32,50,43,.08\)/);
  assert.match(css, /event-card h4\{[^}]*font-size:.78rem/);
  assert.equal(DESKTOP_GRID_END_MINUTES, 18 * 60);
  assert.doesNotMatch(css, /overflow-y:auto/);
});
