#!/usr/bin/env node
// Code history only. Never loads application configuration, the database or client records.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFileSync } = require('node:child_process');
const { verifyBundle } = require('./verify-code-snapshot');
const { snapshotEvidence } = require('./system-maintenance-check');

const FOLDER_ID = '1xP2cvE3sgR7I1PBT0hrAnGFG3WbcVLWh';
const API = 'https://www.googleapis.com/drive/v3/files';
const CREDENTIALS = [
  'SHILOH_BACKUP_GOOGLE_CLIENT_ID',
  'SHILOH_BACKUP_GOOGLE_CLIENT_SECRET',
  'SHILOH_BACKUP_GOOGLE_REFRESH_TOKEN',
];
const FIELDS =
  'id,name,mimeType,parents,size,shared,trashed,permissions(type,role),capabilities(canAddChildren)';

function privateOwnerOnly(file) {
  return (
    file.shared === false &&
    file.trashed === false &&
    Array.isArray(file.permissions) &&
    file.permissions.length === 1 &&
    file.permissions[0].type === 'user' &&
    file.permissions[0].role === 'owner'
  );
}

function validUploadUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.googleapis.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/upload/drive/v3/files'
  )
    throw new Error('Invalid upload endpoint');
  return url.href;
}

async function sha256(file, { signal } = {}) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

async function copySnapshot({
  env = process.env,
  directory = path.resolve('artifacts/system-maintenance'),
  cwd = process.cwd(),
  request = fetch,
} = {}) {
  const configured = CREDENTIALS.filter((name) => String(env[name] || '').trim()).length;
  if (configured === 0)
    return { status: 'unconfigured', reason: 'dedicated-drive-credentials-required' };
  if (configured !== CREDENTIALS.length) throw new Error('Incomplete backup credentials');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const snapshot = JSON.parse(fs.readFileSync(path.join(directory, 'code-snapshot.json'), 'utf8'));
  if (
    !snapshotEvidence(snapshot, directory, commit).restoreVerified ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256)
  )
    throw new Error('Current code checkpoint required');

  const response = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({
      client_id: env[CREDENTIALS[0]],
      client_secret: env[CREDENTIALS[1]],
      refresh_token: env[CREDENTIALS[2]],
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error('Backup authorization unavailable');
  const token = (await response.json()).access_token;
  if (typeof token !== 'string' || !token) throw new Error('Backup authorization unavailable');
  const authorized = async (url, options = {}) => {
    const result = await request(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    });
    if (!result.ok) throw new Error('Backup transfer unavailable');
    return result;
  };
  const metadata = async (id) => {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid Drive file');
    return (await authorized(`${API}/${id}?fields=${encodeURIComponent(FIELDS)}`)).json();
  };
  const folder = await metadata(FOLDER_ID);
  if (
    folder.id !== FOLDER_ID ||
    !privateOwnerOnly(folder) ||
    folder.mimeType !== 'application/vnd.google-apps.folder' ||
    folder.capabilities?.canAddChildren !== true
  )
    throw new Error('Private destination unavailable');

  const upload = async (name, getBody, size, mimeType) => {
    const session = await authorized(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify({
          name,
          parents: [FOLDER_ID],
          appProperties: { shilohBackup: 'code-v1', commit },
        }),
      },
    );
    const url = validUploadUrl(session.headers.get('location'));
    const body = getBody();
    let result;
    try {
      result = await authorized(url, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType, 'Content-Length': String(size) },
        body,
        duplex: 'half',
      });
    } finally {
      body.destroy?.();
    }
    const created = await result.json();
    const file = await metadata(created.id);
    if (
      !privateOwnerOnly(file) ||
      file.name !== name ||
      file.parents?.length !== 1 ||
      file.parents[0] !== FOLDER_ID ||
      Number(file.size) !== size
    )
      throw new Error('Uploaded copy metadata mismatch');
    return file.id;
  };
  const bundle = path.join(directory, snapshot.file);
  // Every run gets a new name. No overwrite, retention deletion or public sharing.
  const name = `${path.basename(snapshot.file, '.bundle')}-${crypto.randomUUID()}.bundle`;
  const fileId = await upload(
    name,
    () => fs.createReadStream(bundle),
    fs.statSync(bundle).size,
    'application/octet-stream',
  );
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-drive-restore-'));
  let receipt;
  try {
    const downloaded = path.join(temp, 'download.bundle');
    const media = await authorized(`${API}/${fileId}?alt=media`);
    await pipeline(Readable.fromWeb(media.body), fs.createWriteStream(downloaded, { mode: 0o600 }));
    if ((await sha256(downloaded)) !== snapshot.sha256)
      throw new Error('Downloaded copy checksum mismatch');
    const refsVerified = verifyBundle(downloaded, commit);
    if (refsVerified !== snapshot.refsVerified)
      throw new Error('Downloaded copy reference mismatch');
    // Check access again after restoration, before publishing success evidence.
    if (!privateOwnerOnly(await metadata(FOLDER_ID)) || !privateOwnerOnly(await metadata(fileId)))
      throw new Error('Backup access changed');
    receipt = {
      schemaVersion: 1,
      status: 'download-restore-verified',
      checkedAt: new Date().toISOString(),
      commit,
      folderId: FOLDER_ID,
      fileId,
      file: name,
      sha256: snapshot.sha256,
      refsVerified,
      downloadChecksumMatches: true,
      isolatedRestoreVerified: true,
      privateOwnerOnly: true,
      scope: snapshot.scope,
      databaseRecoveryVerified: false,
      uploadedFileRecoveryVerified: false,
    };
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const receiptId = await upload(
      `${name}-restore-verification.json`,
      () => bytes,
      bytes.length,
      'application/json',
    );
    const saved = await authorized(`${API}/${receiptId}?alt=media`);
    if (!Buffer.from(await saved.arrayBuffer()).equals(bytes))
      throw new Error('Saved receipt mismatch');
    return { ...receipt, receiptId };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  const directory = path.resolve('artifacts/system-maintenance');
  fs.mkdirSync(directory, { recursive: true });
  let evidence;
  let failed = false;
  try {
    evidence = await copySnapshot({ directory });
  } catch {
    failed = true;
    evidence = {
      status: 'failed',
      reason: 'backup-transfer-or-restore-not-verified',
      checkedAt: new Date().toISOString(),
    };
  }
  fs.writeFileSync(
    path.join(directory, 'independent-code-backup.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify(evidence));
  if (failed) process.exitCode = 1;
}

module.exports = { copySnapshot, privateOwnerOnly, validUploadUrl, sha256, FOLDER_ID };
if (require.main === module) main();
