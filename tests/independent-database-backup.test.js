const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  copyDatabase,
  fixtureSource,
  databaseEvidence,
} = require('../scripts/independent-database-backup');
const { createDriveTransport, OWNER_EMAIL } = require('../scripts/database-backup-drive');
const { FOLDER_ID } = require('../scripts/independent-code-backup');
const { mockPrivateDrive } = require('../scripts/synthetic-database-backup-proof');
const source = {
  host: '127.0.0.1',
  port: 5434,
  user: 'fixture',
  database: 'shiloh_backup_fixture_0123456789abcdef',
};
function receipt(now = Date.now()) {
  return {
    schemaVersion: 1,
    runId: '01234567-89ab-4cde-8fab-0123456789ab',
    ownerEmail: OWNER_EMAIL,
    ownerPermissionId: 'synthetic-owner-id',
    status: 'ciphertext-readback-verified',
    scope: 'synthetic-only',
    sourceId: source.database,
    name: `shiloh-database-${new Date(now - 60000).toISOString().replace(/[:.]/g, '-')}-01234567-89ab-4cde-8fab-0123456789ab.dump.gpg`,
    snapshotAt: new Date(now - 60000).toISOString(),
    checkedAt: new Date(now).toISOString(),
    folderId: FOLDER_ID,
    fileId: 'fixture_copy',
    ciphertextSha256: 'a'.repeat(64),
    ciphertextBytes: 4096,
    postgresMajor: 18,
    archiveFormat: 'pg-custom',
    encryption: 'OpenPGP-AES256-OCB',
    privateOwnerOnly: true,
    downloadChecksumMatches: true,
    databaseRecoveryVerified: false,
  };
}
test('disabled default does not inspect credentials, database or transport', async () => {
  assert.deepEqual(
    await copyDatabase({
      transport: new Proxy(
        {},
        {
          get() {
            throw new Error('must not touch');
          },
        },
      ),
    }),
    { status: 'disabled', databaseRecoveryVerified: false },
  );
});
test('production and ambiguous sources fail closed before connecting', async () => {
  for (const override of [
    { host: 'dpg-production.render.com' },
    { database: 'shiloh-memory' },
    { host: '/tmp/socket' },
    { port: 543 },
    { connectionString: 'secret' },
  ]) {
    assert.throws(() => fixtureSource({ ...source, ...override }));
    await assert.rejects(copyDatabase({ enabled: true, source: { ...source, ...override } }));
  }
  assert.throws(() => fixtureSource());
});
test('only signed exact metadata with independently pinned trust, source, run and owner can establish ciphertext evidence', () => {
  const now = Date.now(),
    good = receipt(now);
  const keys = crypto.generateKeyPairSync('ed25519');
  const attacker = crypto.generateKeyPairSync('ed25519');
  const signed = (r, privateKey = keys.privateKey) => {
    const payload = JSON.stringify(r);
    return {
      schemaVersion: 1,
      payload,
      signature: crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url'),
    };
  };
  const context = {
    trustedPublicKey: keys.publicKey,
    expectedSourceId: source.database,
    expectedRunId: good.runId,
    expectedOwnerPermissionId: 'synthetic-owner-id',
    now,
  };
  assert.equal(databaseEvidence(signed(good), context).status, 'ciphertext-readback-verified');
  assert.equal(
    databaseEvidence(signed(good), { ...context, gitSha: 'different' }).status,
    'ciphertext-readback-verified',
  );
  for (const forged of [
    good,
    signed(good, attacker.privateKey),
    { ...signed(good), trustedPublicKey: attacker.publicKey },
    { ...signed(good), payload: JSON.stringify({ ...good, ciphertextBytes: 1 }) },
    { ...signed(good), signature: 'invalid' },
  ])
    assert.equal(databaseEvidence(forged, context).status, 'unverified');
  assert.equal(databaseEvidence(signed(good)).status, 'unverified');
  for (const delta of [
    { expectedSourceId: 'wrong' },
    { expectedRunId: crypto.randomUUID() },
    { expectedOwnerPermissionId: 'wrong' },
    { trustedPublicKey: keys.privateKey },
  ])
    assert.equal(databaseEvidence(signed(good), { ...context, ...delta }).status, 'unverified');
  for (const delta of [
    { snapshotAt: new Date(now - 37 * 3600000).toISOString() },
    { snapshotAt: new Date(now + 1).toISOString() },
    { checkedAt: new Date(now + 1).toISOString() },
    { checkedAt: 'invalid' },
    { sourceId: 'wrong' },
    { scope: 'production' },
    { downloadChecksumMatches: false },
    { privateOwnerOnly: false },
    { databaseRecoveryVerified: true },
    { ciphertextBytes: 0 },
    { fileId: 'https://redirect.invalid' },
    { folderId: 'shared-folder' },
    { ownerEmail: 'wrong@example.invalid' },
    { ownerPermissionId: 'wrong' },
    { ciphertextSha256: 'invalid' },
    { postgresMajor: 17 },
    { status: 'uploaded' },
    { secret: 'SYNTHETIC SECRET MUST NOT LEAK' },
    { name: 'SYNTHETIC SECRET MUST NOT LEAK' },
    { __proto__: null, extra: 'SYNTHETIC SECRET MUST NOT LEAK' },
  ]) {
    const result = databaseEvidence(signed({ ...good, ...delta }), context);
    assert.equal(result.status, 'unverified');
    assert.equal(JSON.stringify(result).includes('MUST NOT LEAK'), false);
  }
});
test('prepared Drive adapter rejects sharing, foreign redirects, partial uploads and truncated readback', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-drive-test-'));
  try {
    const file = path.join(temp, 'ciphertext.gpg');
    fs.writeFileSync(file, 'SYNTHETIC ENCRYPTED PLACEHOLDER');
    const size = fs.statSync(file).size;
    for (const fault of [
      'shared',
      'wrong-owner',
      'wrong-account',
      'wrong-permission',
      'missing-owner',
      'redirect',
      'partial',
    ]) {
      const drive = mockPrivateDrive();
      drive.fault(fault);
      await assert.rejects(
        drive.transport.upload({
          file,
          name: 'shiloh-database-fixture.dump.gpg',
          size,
          folderId: FOLDER_ID,
        }),
      );
    }
    const drive = mockPrivateDrive();
    const fileId = await drive.transport.upload({
      file,
      name: 'shiloh-database-fixture.dump.gpg',
      size,
      folderId: FOLDER_ID,
    });
    drive.fault('truncate');
    await assert.rejects(
      drive.transport.download({ fileId, file: path.join(temp, 'readback'), size }),
    );
    await assert.rejects(
      drive.transport.upload({
        file,
        name: 'shiloh-database-fixture.dump.gpg',
        size,
        folderId: 'other',
      }),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
test('transport forwards cancellation and never follows a credential redirect', async () => {
  const abort = new AbortController();
  abort.abort();
  let called = false;
  const transport = createDriveTransport({
    accessToken: 'synthetic',
    request: async () => {
      called = true;
      throw new Error('unexpected');
    },
  });
  await assert.rejects(transport.assertPrivate(FOLDER_ID, { signal: abort.signal }));
  assert.equal(called, false);
  assert.throws(() => createDriveTransport({ accessToken: '' }));
});

test('maintenance neither reads raw database receipt files nor publishes the raw artifact directory', () => {
  const report = fs.readFileSync(
    path.join(__dirname, '../scripts/system-maintenance-check.js'),
    'utf8',
  );
  const workflow = fs.readFileSync(
    path.join(__dirname, '../.github/workflows/system-maintenance.yml'),
    'utf8',
  );
  assert.equal(report.includes('independent-database-backup.json'), false);
  assert.equal(report.includes('SHILOH_BACKUP_EXPECTED_SOURCE_ID'), false);
  const uploadPaths = workflow
    .split('          path: |')[1]
    .split('          retention-days:')[0]
    .trim()
    .split('\n')
    .map((v) => v.trim());
  assert.deepEqual(uploadPaths, [
    'artifacts/system-maintenance/report.json',
    'artifacts/system-maintenance/report.md',
    'artifacts/system-maintenance/code-snapshot.json',
    'artifacts/system-maintenance/shiloh-*.bundle',
  ]);
  for (const malicious of [
    'independent-database-backup.json',
    'forged-receipt.json',
    'database.dump.gpg',
    'private-key.asc',
    'clinical-key.txt',
  ])
    assert.equal(
      uploadPaths.some((p) => p.endsWith('/' + malicious) || p === 'artifacts/system-maintenance/'),
      false,
    );
});
