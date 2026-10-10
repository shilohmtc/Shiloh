#!/usr/bin/env node
// First draft: synthetic sources only. No dotenv, app bootstrap, production credentials or scheduler.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Pool } = require('pg');
const { OWNER_EMAIL } = require('./database-backup-drive');
const { sha256, FOLDER_ID } = require('./independent-code-backup');

function fixtureSource(source) {
  if (
    !source ||
    !/^shiloh_backup_fixture_[a-f0-9]{16}$/.test(source.database || '') ||
    !['127.0.0.1', 'localhost'].includes(source.host) ||
    !Number.isInteger(source.port) ||
    source.port < 1024 ||
    source.port > 65535 ||
    !/^[a-z_][a-z0-9_]*$/.test(source.user || '') ||
    Object.keys(source).some((k) => !['host', 'port', 'user', 'database'].includes(k))
  )
    throw new Error('Synthetic source required');
  return source;
}

function command(bin, args, { signal, env, input, piped = false } = {}) {
  const child = spawn(bin, args, {
    signal,
    killSignal: 'SIGKILL',
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const done = new Promise((resolve, reject) => {
    let failed = false;
    child.once('error', () => {
      failed = true;
      child.kill('SIGKILL');
    });
    child.once('close', (code) =>
      code === 0 && !failed ? resolve() : reject(new Error('Backup command failed')),
    );
  });
  // Attach immediately: pipeline and process termination may fail together.
  done.catch(() => {});
  if (input) input.pipe(child.stdin);
  else if (!piped) child.stdin.end();
  child.stdin.on('error', () => {});
  return { child, done };
}
function clientEnv() {
  // Never inherit DATABASE_URL, PG*, app keys, OAuth secrets or GnuPG home.
  return { PATH: process.env.PATH, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH, LANG: 'C' };
}
function pgArgs(source) {
  return [
    '--host',
    source.host,
    '--port',
    String(source.port),
    '--username',
    source.user,
    '--dbname',
    source.database,
    '--no-password',
  ];
}

async function copyDatabase({
  enabled = false,
  runId = crypto.randomUUID(),
  source,
  sourceId,
  folderId,
  publicKeyHome,
  recipient,
  transport,
  pgDump = 'pg_dump',
  gpg = 'gpg',
  timeoutMs = 120000,
  signal: callerSignal,
  lockDirectory = os.tmpdir(),
} = {}) {
  if (!enabled) return { status: 'disabled', databaseRecoveryVerified: false };
  fixtureSource(source);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId) ||
    sourceId !== source.database ||
    folderId !== FOLDER_ID ||
    !transport ||
    !/^[A-F0-9]{40}$/.test(recipient || '') ||
    !path.isAbsolute(publicKeyHome || '') ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000
  )
    throw new Error('Backup configuration unavailable');
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const lock = path.join(
    lockDirectory,
    `shiloh-db-backup-${crypto
      .createHash('sha256')
      .update(JSON.stringify([source.port, source.user, source.database]))
      .digest('hex')}.lock`,
  );
  const fd = fs.openSync(lock, 'wx', 0o600);
  let temp, pool, client;
  try {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-db-copy-'));
    pool = new Pool({
      ...source,
      // Never read an ambient PostgreSQL password or SSL configuration.
      password: () => '',
      ssl: false,
      max: 1,
      connectionTimeoutMillis: Math.min(timeoutMs, 10000),
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      idle_in_transaction_session_timeout: timeoutMs,
    });
    const abort = () => {
      client?.connection?.stream.destroy();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      client = await pool.connect();
      signal.throwIfAborted();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const identity = (
        await client.query(
          "SELECT current_database() AS database, current_user AS role, current_setting('server_version_num')::int AS version, host(inet_server_addr()) AS host, inet_server_port() AS port, transaction_timestamp() AS snapshot_time, pg_export_snapshot() AS snapshot",
        )
      ).rows[0];
      if (
        identity.database !== sourceId ||
        identity.role !== source.user ||
        identity.version < 180000 ||
        identity.version >= 190000 ||
        !['127.0.0.1', '::1'].includes(identity.host) ||
        identity.port !== source.port
      )
        throw new Error('Source identity mismatch');
      const version = command(pgDump, ['--version'], { signal, env: clientEnv() });
      let versionText = '';
      version.child.stdout.on('data', (c) => {
        if (versionText.length < 256) versionText += c;
      });
      await version.done;
      if (!/^pg_dump \(PostgreSQL\) 18\./.test(versionText))
        throw new Error('PostgreSQL 18 client required');
      const encrypted = path.join(temp, 'database.dump.gpg');
      const dump = command(
        pgDump,
        [
          ...pgArgs(source),
          '--format=custom',
          '--no-owner',
          '--no-acl',
          '--lock-wait-timeout=10000',
          `--snapshot=${identity.snapshot}`,
        ],
        { signal, env: clientEnv() },
      );
      const encrypt = command(
        gpg,
        [
          '--homedir',
          publicKeyHome,
          '--batch',
          '--no-tty',
          '--trust-model',
          'always',
          '--force-aead',
          '--aead-algo',
          'OCB',
          '--cipher-algo',
          'AES256',
          '--recipient',
          recipient,
          '--output',
          encrypted,
          '--encrypt',
        ],
        { signal, env: clientEnv(), piped: true },
      );
      try {
        await Promise.all([
          pipeline(dump.child.stdout, encrypt.child.stdin, { signal }),
          dump.done,
          encrypt.done,
        ]);
      } catch {
        dump.child.kill('SIGKILL');
        encrypt.child.kill('SIGKILL');
        await Promise.allSettled([dump.done, encrypt.done]);
        throw new Error('Export encryption failed');
      }
      await client.query('COMMIT');
      signal.throwIfAborted();
      const snapshotAt = identity.snapshot_time.toISOString();
      const name = `shiloh-database-${snapshotAt.replace(/[:.]/g, '-')}-${runId}.dump.gpg`;
      const digest = await sha256(encrypted, { signal }),
        size = fs.statSync(encrypted).size;
      signal.throwIfAborted();
      await transport.assertPrivate(folderId, { signal });
      const fileId = await transport.upload({ file: encrypted, name, size, folderId, signal });
      const downloaded = path.join(temp, 'readback.gpg');
      await transport.download({ fileId, file: downloaded, size, signal });
      if (
        fs.statSync(downloaded).size !== size ||
        (await sha256(downloaded, { signal })) !== digest
      )
        throw new Error('Encrypted readback mismatch');
      const owner = await transport.assertPrivate(folderId, { signal });
      const fileOwner = await transport.assertPrivate(fileId, { signal, name, size, folderId });
      if (
        owner?.ownerEmail !== OWNER_EMAIL ||
        !/^[\w-]{1,128}$/.test(owner?.ownerPermissionId || '') ||
        fileOwner?.ownerEmail !== OWNER_EMAIL ||
        fileOwner.ownerPermissionId !== owner.ownerPermissionId
      )
        throw new Error('Approved owner identity required');
      signal.throwIfAborted();
      return {
        schemaVersion: 1,
        runId,
        ownerEmail: OWNER_EMAIL,
        ownerPermissionId: owner.ownerPermissionId,
        status: 'ciphertext-readback-verified',
        scope: 'synthetic-only',
        snapshotAt,
        checkedAt: new Date().toISOString(),
        sourceId,
        postgresMajor: 18,
        archiveFormat: 'pg-custom',
        encryption: 'OpenPGP-AES256-OCB',
        ciphertextSha256: digest,
        ciphertextBytes: size,
        folderId,
        fileId,
        name,
        privateOwnerOnly: true,
        downloadChecksumMatches: true,
        databaseRecoveryVerified: false,
      };
    } finally {
      signal.removeEventListener('abort', abort);
    }
  } finally {
    client?.release(true);
    await pool?.end();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function databaseEvidence(...args) {
  return require('./database-backup-evidence').databaseEvidence(...args);
}
module.exports = { copyDatabase, fixtureSource, databaseEvidence, command, clientEnv, pgArgs };
if (require.main === module)
  console.log(
    JSON.stringify({
      status: 'disabled',
      reason: 'synthetic-library-only-no-live-executor',
      databaseRecoveryVerified: false,
    }),
  );
