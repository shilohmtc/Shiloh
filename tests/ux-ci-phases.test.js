const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { assertPartition, inventory, groups } = require('../scripts/ux-ci-phases');
const entries = ids => ids.map(id => ({ id }));
test('UX partition preserves every identity exactly once and rejects omissions or overlaps', () => {
  assert.doesNotThrow(() => assertPartition(entries(['a', 'b']), { focused: entries(['a']), remaining: entries(['b']) }));
  assert.throws(() => assertPartition(entries(['a', 'b']), { focused: entries(['a']) }), /Incomplete/);
  assert.throws(() => assertPartition(entries(['a']), { focused: entries(['a']), remaining: entries(['a']) }), /Repeated/);
  assert.throws(() => assertPartition(entries(['a']), { remaining: entries(['b']) }), /Unknown/);
  assert.throws(() => assertPartition(entries(['a', 'a']), {}), /Duplicate/);
});
test('inventory distinguishes projects and nested scenarios without title-only deduplication', () => {
  const report = { suites: [{ title: 'file', suites: [{ title: 'group', specs: [{ id: 'abc', file: 'a.js', title: 'same', tests: [{ projectName: 'phone' }, { projectName: 'desktop' }] }] }] }] };
  assert.deepEqual(inventory(report).map(t => t.id), ['abc:phone', 'abc:desktop']);
  assert.throws(() => inventory({ errors: [{ message: 'collection failed' }] }), /collection failed/);
});
test('workflow catches original Rebook guard and focused screen checks before long remainder', () => {
  const workflow = fs.readFileSync('.github/workflows/ux-quality.yml', 'utf8');
  const remainder = workflow.indexOf('node scripts/ux-ci-phases.js remaining');
  assert.ok(remainder >= 0);
  const rebook = workflow.indexOf('node scripts/rebook-action-evidence.js');
  assert.ok(rebook >= 0 && rebook < remainder);
  assert.equal(workflow.split('node scripts/rebook-action-evidence.js').length - 1, 1);
  for (const name of Object.keys(groups)) {
    const index = workflow.indexOf(`node scripts/ux-ci-phases.js ${name}`);
    assert.ok(index >= 0 && index < remainder);
  }
  assert.match(workflow, /CRM_AUTH_EVIDENCE_SOURCE: artifacts\/ux-ci-phases\/crm-results/);
  assert.match(workflow, /artifacts\/ux-ci-phases\n/);
  assert.match(workflow, /npm run test:ux -- --update-snapshots/);
  assert.match(fs.readFileSync('playwright.ux.config.js', 'utf8'), /workers: 1/);
});
test('evidence merge retains runner metadata per phase and refuses screenshot collisions', () => {
  const os = require('node:os');
  const path = require('node:path');
  const { mergeEvidence } = require('../scripts/ux-ci-phases');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-evidence-'));
  try {
    const source = path.join(root, 'focus'), destination = path.join(root, 'remaining');
    fs.mkdirSync(source); fs.mkdirSync(destination);
    fs.writeFileSync(path.join(source, '.last-run.json'), 'focus');
    fs.writeFileSync(path.join(destination, '.last-run.json'), 'remaining');
    fs.mkdirSync(path.join(source, 'scenario'));
    fs.writeFileSync(path.join(source, 'scenario', 'screen.png'), 'evidence');
    mergeEvidence(source, destination);
    assert.equal(fs.readFileSync(path.join(destination, '.last-run.json'), 'utf8'), 'remaining');
    assert.equal(fs.readFileSync(path.join(destination, 'scenario', 'screen.png'), 'utf8'), 'evidence');
    assert.throws(() => mergeEvidence(source, destination), /exist/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
