'use strict';
// Run existing scenarios once, in failure-priority order. No assertions or
// Playwright defaults change; npm run test:ux still runs the whole catalogue.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'artifacts/ux-ci-phases');
const groups = {
  booking: ['tests/ux-visual-accessibility.spec.js', '--grep', 'My Shiloh multiple bookings review|Home shows the later Swedish deposit|appointment-editor-(?:desktop|phone) visual and accessibility baseline'],
  holiday: ['tests/holiday-planning.spec.js'],
  attended: ['tests/workspace-already-attended.spec.js'],
  directory: ['tests/workspace-client-services.spec.js', 'tests/ux-visual-accessibility.spec.js', '--grep', 'Client Directory management|(?:dashboard|messages|client-history)-(?:desktop|phone) visual and accessibility baseline'],
  couples: ['tests/my-shiloh-couples-ux.spec.js'],
  crm: ['tests/my-shiloh-crm-sign-in-ux.spec.js'],
  notifications: ['tests/notification-clarity.spec.js'],
};
const cli = () => require.resolve('@playwright/test/cli');
const baseArgs = ['test', '--config=playwright.ux.config.js'];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function inventory(report) {
  const entries = [];
  function visit(suites, parents = []) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) for (const test of spec.tests) {
        entries.push({ id: `${spec.id}:${test.projectName}`, file: spec.file, title: [...parents, suite.title, spec.title].join(' > ') });
      }
      visit(suite.suites, [...parents, suite.title]);
    }
  }
  visit(report.suites);
  if (report.errors?.length) throw new Error(JSON.stringify(report.errors));
  return entries;
}
function collect(args) {
  return inventory(JSON.parse(execFileSync(process.execPath, [cli(), ...baseArgs, ...args, '--list', '--reporter=json'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })));
}
function assertPartition(all, phases) {
  const expected = new Set(all.map(t => t.id));
  if (expected.size !== all.length) throw new Error('Duplicate catalogue identities');
  const seen = new Set();
  for (const entries of Object.values(phases)) for (const entry of entries) {
    if (!expected.has(entry.id)) throw new Error(`Unknown scenario: ${entry.id}`);
    if (seen.has(entry.id)) throw new Error(`Repeated scenario: ${entry.id}`);
    seen.add(entry.id);
  }
  if (seen.size !== expected.size) throw new Error('Incomplete catalogue coverage');
}
function plan() {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of [...Object.keys(groups), 'remaining']) {
    fs.rmSync(path.join(directory, `${name}-passed.json`), { force: true });
  }
  const all = collect([]), phases = {}, lists = [];
  for (const [name, args] of Object.entries(groups)) {
    phases[name] = collect(args);
    if (!phases[name].length) throw new Error(`Empty required focus: ${name}`);
    const list = execFileSync(process.execPath, [cli(), ...baseArgs, ...args, '--list', '--reporter=list'], { cwd: root, encoding: 'utf8' });
    const lines = list.split('\n').filter(line => /^\s+\S.*:\d+:\d+ › /.test(line));
    if (lines.length !== phases[name].length) throw new Error(`Unsupported test-list format: ${name}`);
    fs.writeFileSync(path.join(directory, `${name}.txt`), lines.join('\n') + '\n');
    lists.push(...lines);
  }
  const focused = path.join(directory, 'focused.txt');
  fs.writeFileSync(focused, lists.join('\n') + '\n');
  phases.remaining = collect(['--test-list-invert', focused]);
  assertPartition(all, phases);
  const manifest = { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), total: all.length, focused: lists.length, phases };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ total: all.length, phases: Object.fromEntries(Object.entries(phases).map(([key, value]) => [key, value.length])) }));
}
function mergeEvidence(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    // This is runner metadata, not scenario evidence. Keep each phase's own
    // copy in its archive and retain the remainder's metadata at destination.
    if (entry === '.last-run.json') continue;
    fs.cpSync(path.join(source, entry), path.join(destination, entry), { recursive: true, errorOnExist: true, force: false });
  }
}
function run(name) {
  if (name !== 'remaining' && !groups[name]) throw new Error(`Unknown phase: ${name}`);
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.head !== git('rev-parse', 'HEAD') || git('status', '--porcelain', '--untracked-files=no')) throw new Error('Phase plan requires unchanged exact-head source');
  const signature = digest(manifestBytes);
  if (name === 'remaining') for (const focus of Object.keys(groups)) {
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, `${focus}-passed.json`)));
    if (receipt.signature !== signature || receipt.exitCode !== 0) throw new Error(`Unproven focused phase: ${focus}`);
  }
  const filter = name === 'remaining' ? ['--test-list-invert', path.join(directory, 'focused.txt')] : ['--test-list', path.join(directory, `${name}.txt`)];
  const actual = collect(filter);
  if (JSON.stringify(actual.map(t => t.id).sort()) !== JSON.stringify(manifest.phases[name].map(t => t.id).sort())) throw new Error(`Inventory changed: ${name}`);
  const output = name === 'remaining' ? 'artifacts/ux-playwright-results' : `artifacts/ux-ci-phases/${name}-results`;
  fs.rmSync(path.join(directory, `${name}-passed.json`), { force: true });
  const start = Date.now();
  const result = spawnSync(process.execPath, [cli(), ...baseArgs, ...filter, `--output=${output}`], { cwd: root, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(directory, `${name}-report`) } });
  const receipt = { signature, exitCode: result.status, elapsedMs: Date.now() - start, scenarios: actual.length };
  // Preserve existing downstream evidence consumers and filenames. Focused
  // HTML reports, traces and screenshots remain separately inspectable too.
  if (name === 'remaining') for (const focus of Object.keys(groups)) {
    mergeEvidence(path.join(directory, `${focus}-results`), path.join(root, output));
  }
  fs.writeFileSync(path.join(directory, `${name}-${result.status === 0 ? 'passed' : 'failed'}.json`), JSON.stringify(receipt, null, 2));
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`UX phase ${name} failed (${result.status})`);
}
if (require.main === module) {
  try { process.argv[2] === 'plan' ? plan() : run(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { inventory, assertPartition, groups, mergeEvidence };
