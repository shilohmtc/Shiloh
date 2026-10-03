const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  copySnapshot,
  FOLDER_ID,
  privateOwnerOnly,
  validUploadUrl,
} = require('../scripts/independent-code-backup');
const { independentEvidence } = require('../scripts/system-maintenance-check');

const env = {
  SHILOH_BACKUP_GOOGLE_CLIENT_ID: 'fixture-client',
  SHILOH_BACKUP_GOOGLE_CLIENT_SECRET: 'fixture-secret',
  SHILOH_BACKUP_GOOGLE_REFRESH_TOKEN: 'fixture-refresh',
};
const owner = { shared: false, trashed: false, permissions: [{ type: 'user', role: 'owner' }] };

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-backup-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  fs.writeFileSync(path.join(cwd, 'fixture.txt'), 'Synthetic code, no clinic data.');
  git('add', '.');
  git(
    '-c',
    'user.name=Backup Test',
    '-c',
    'user.email=backup@example.invalid',
    'commit',
    '-m',
    'Synthetic fixture',
  );
  git('branch', 'second-reference');
  const commit = git('rev-parse', 'HEAD');
  const file = 'fixture.bundle';
  git('bundle', 'create', path.join(cwd, file), '--all');
  const bytes = fs.readFileSync(path.join(cwd, file));
  const manifest = {
    commit,
    file,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    restoreVerified: true,
    refsVerified: 2,
    scope: 'Git history only',
  };
  fs.writeFileSync(path.join(cwd, 'code-snapshot.json'), JSON.stringify(manifest));
  return { cwd, directory: cwd, manifest, env };
}

function drive({
  corrupt = false,
  folderShared = false,
  fileShared = false,
  sessionHost = 'www.googleapis.com',
  corruptReceipt = false,
} = {}) {
  const files = new Map();
  const calls = [];
  let pending;
  const request = async (value, options = {}) => {
    const url = new URL(value);
    calls.push({ url: url.href, method: options.method || 'GET' });
    if (url.hostname === 'oauth2.googleapis.com')
      return Response.json({ access_token: 'fixture-access' });
    assert.equal(
      url.hostname,
      'www.googleapis.com',
      'Never forward the bearer token to another host',
    );
    assert.equal(options.headers.Authorization, 'Bearer fixture-access');
    assert.equal(options.redirect, 'error');
    if (options.method === 'POST') {
      pending = JSON.parse(options.body);
      return new Response(null, {
        headers: { location: `https://${sessionHost}/upload/drive/v3/files?upload_id=fixture` },
      });
    }
    if (options.method === 'PUT') {
      const chunks = [];
      if (Buffer.isBuffer(options.body)) chunks.push(options.body);
      else for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const id = `file-${files.size + 1}`;
      files.set(id, {
        bytes,
        metadata: {
          ...owner,
          id,
          name: pending.name,
          parents: pending.parents,
          size: String(bytes.length),
          shared: fileShared,
        },
      });
      return Response.json({ id });
    }
    const id = url.pathname.split('/').pop();
    if (id === FOLDER_ID)
      return Response.json({
        ...owner,
        id,
        shared: folderShared,
        mimeType: 'application/vnd.google-apps.folder',
        capabilities: { canAddChildren: true },
      });
    const file = files.get(id);
    assert.ok(file);
    if (url.searchParams.get('alt') === 'media') {
      if (
        (corrupt && file.metadata.name.endsWith('.bundle')) ||
        (corruptReceipt && file.metadata.name.endsWith('.json'))
      )
        return new Response('corrupt copy');
      return new Response(file.bytes);
    }
    return Response.json(file.metadata);
  };
  return { request, calls, files };
}

test('Drive download is checksum-checked and really restored, with a private read-back receipt', async (t) => {
  const source = fixture(t);
  const remote = drive();
  const receipt = await copySnapshot({ ...source, request: remote.request });
  assert.equal(receipt.status, 'download-restore-verified');
  assert.equal(receipt.refsVerified, 2);
  assert.equal(receipt.commit, source.manifest.commit);
  assert.equal(receipt.databaseRecoveryVerified, false);
  assert.equal(receipt.uploadedFileRecoveryVerified, false);
  assert.equal(independentEvidence(receipt, receipt.commit).status, 'download-restore-verified');
  assert.equal(remote.files.size, 2);
  assert.equal(remote.calls.filter((c) => c.method === 'DELETE' || c.method === 'PATCH').length, 0);
});

test('a corrupt downloaded bundle or corrupt saved receipt cannot establish backup success', async (t) => {
  const source = fixture(t);
  await assert.rejects(
    copySnapshot({ ...source, request: drive({ corrupt: true }).request }),
    /checksum mismatch/,
  );
  await assert.rejects(
    copySnapshot({ ...source, request: drive({ corruptReceipt: true }).request }),
    /receipt mismatch/,
  );
});

test('matching checksums alone do not prove a valid restorable Git archive', async (t) => {
  const source = fixture(t);
  const bytes = Buffer.from('not a git bundle');
  fs.writeFileSync(path.join(source.cwd, source.manifest.file), bytes);
  source.manifest.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(source.cwd, 'code-snapshot.json'), JSON.stringify(source.manifest));
  await assert.rejects(copySnapshot({ ...source, request: drive().request }));
});

test('shared or ambiguous access is rejected before upload and after uploaded-copy inspection', async (t) => {
  const source = fixture(t);
  const remote = drive({ folderShared: true });
  await assert.rejects(copySnapshot({ ...source, request: remote.request }), /Private destination/);
  assert.equal(remote.files.size, 0);
  await assert.rejects(
    copySnapshot({ ...source, request: drive({ fileShared: true }).request }),
    /metadata mismatch/,
  );
  assert.equal(
    privateOwnerOnly({
      ...owner,
      permissions: [...owner.permissions, { type: 'user', role: 'reader' }],
    }),
    false,
  );
  assert.equal(privateOwnerOnly({ permissions: owner.permissions }), false);
});

test('credentials and current checkpoint are required before any transfer', async (t) => {
  const source = fixture(t);
  const never = () => {
    throw new Error('Remote access must not occur');
  };
  assert.equal((await copySnapshot({ ...source, env: {}, request: never })).status, 'unconfigured');
  await assert.rejects(
    copySnapshot({ ...source, env: { SHILOH_BACKUP_GOOGLE_CLIENT_ID: 'partial' }, request: never }),
    /Incomplete/,
  );
  source.manifest.commit = 'unrelated';
  fs.writeFileSync(path.join(source.cwd, 'code-snapshot.json'), JSON.stringify(source.manifest));
  await assert.rejects(copySnapshot({ ...source, request: never }), /checkpoint required/);
});

test('upload redirects cannot exfiltrate authorization to another origin', async (t) => {
  const source = fixture(t);
  await assert.rejects(
    copySnapshot({ ...source, request: drive({ sessionHost: 'attacker.invalid' }).request }),
    /Invalid upload/,
  );
  for (const url of [
    'http://www.googleapis.com/upload/drive/v3/files',
    'https://www.googleapis.com:444/upload/drive/v3/files',
    'https://attacker.invalid/upload/drive/v3/files',
    'https://user@www.googleapis.com/upload/drive/v3/files',
  ])
    assert.throws(() => validUploadUrl(url));
});

test('stale, unrelated, partial or future evidence never becomes a verified backup', async (t) => {
  const source = fixture(t);
  const receipt = await copySnapshot({ ...source, request: drive().request });
  const now = Date.parse(receipt.checkedAt);
  for (const patch of [
    { commit: 'other' },
    { privateOwnerOnly: false },
    { receiptId: null },
    { isolatedRestoreVerified: false },
    { checkedAt: new Date(now - 37 * 60 * 60 * 1000).toISOString() },
    { checkedAt: new Date(now + 1).toISOString() },
  ])
    assert.equal(
      independentEvidence({ ...receipt, ...patch }, receipt.commit, now).status,
      'unverified',
    );
});
