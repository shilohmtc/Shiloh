const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deploymentStatus,
  dependencyReport,
  snapshotEvidence,
  markdown,
} = require('../scripts/system-maintenance-check');

test('an in-progress or failed deploy does not replace the running live commit', () => {
  const entries = [
    { deploy: { status: 'build_failed', commit: { id: 'new' } } },
    { deploy: { status: 'live', commit: { id: 'old' }, id: 'dep-live' } },
  ];
  assert.equal(deploymentStatus(entries, 'new').status, 'different');
  assert.equal(deploymentStatus(entries, 'old').status, 'current');
  assert.equal(deploymentStatus(entries, 'old').latestStatus, 'build_failed');
});

test('missing live deployment or GitHub authority remains unknown', () => {
  assert.equal(deploymentStatus([], 'main').status, 'unknown');
  assert.equal(
    deploymentStatus([{ status: 'live', commit: { id: 'main' } }], undefined).status,
    'unknown',
  );
});

test('registry failure does not become no updates and declared ranges are not installed versions', () => {
  const pkg = { dependencies: { lucide: '^1.0.0' } };
  const lock = { packages: { 'node_modules/lucide': { version: '1.1.0' } } };
  assert.equal(dependencyReport(pkg, lock, null)[0].updateAvailable, null);
  const update = dependencyReport(pkg, lock, { lucide: { wanted: '1.2.0', latest: '2.0.0' } })[0];
  assert.equal(update.locked, '1.1.0');
  assert.equal(update.latest, '2.0.0');
  assert.equal(update.wanted, '1.2.0');
});

test('a restored code checkpoint does not claim independent or data backups', () => {
  const summary = markdown({
    repository: {},
    runtime: {},
    dependencies: { packages: [] },
    audit: {},
    github: {},
    render: {},
    health: {},
    backups: { codeSnapshot: { status: 'restore-verified-github-checkpoint' } },
  });
  assert.match(summary, /Independent code backup: unverified/);
  assert.match(summary, /Database recovery: unverified/);
  assert.match(summary, /Uploaded-file recovery: unverified/);
});

test('missing, corrupt, unrelated or path-escaping snapshots remain unverified', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
  try {
    const snapshot = {
      commit: 'main',
      restoreVerified: true,
      file: 'code.bundle',
      status: 'verified',
      sha256: crypto.createHash('sha256').update('bundle').digest('hex'),
    };
    assert.equal(snapshotEvidence(snapshot, dir, 'main').status, 'unverified');
    fs.writeFileSync(path.join(dir, snapshot.file), 'bundle');
    assert.equal(snapshotEvidence(snapshot, dir, 'main').status, 'verified');
    assert.equal(snapshotEvidence(snapshot, dir, 'another').status, 'unverified');
    assert.equal(
      snapshotEvidence({ ...snapshot, file: '../code.bundle' }, dir, 'main').status,
      'unverified',
    );
    fs.writeFileSync(path.join(dir, snapshot.file), 'corrupt');
    assert.equal(snapshotEvidence(snapshot, dir, 'main').status, 'unverified');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
