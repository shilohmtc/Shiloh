#!/usr/bin/env node
// Isolated local PostgreSQL 18 cluster + ephemeral keys. No app, scheduler, messages or payments.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const {
  copyDatabase,
  fixtureSource,
  pgArgs,
  clientEnv,
  databaseEvidence,
} = require('./independent-database-backup');
const { createDriveTransport, OWNER_EMAIL } = require('./database-backup-drive');
const { FOLDER_ID, sha256 } = require('./independent-code-backup');
const {
  encryptSubmissionPayload,
  decryptSubmissionPayload,
} = require('../src/domain/consultationFormEncryption');

function tool(name) {
  return process.env.SHILOH_SYNTHETIC_PG_BIN
    ? path.join(process.env.SHILOH_SYNTHETIC_PG_BIN, name)
    : name;
}
function run(bin, args, options = {}) {
  return execFileSync(bin, args, {
    env: clientEnv(),
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}
function key(home) {
  fs.mkdirSync(home, { mode: 0o700 });
  run('gpg', [
    '--homedir',
    home,
    '--batch',
    '--pinentry-mode',
    'loopback',
    '--passphrase',
    '',
    '--quick-generate-key',
    'Synthetic Backup Fixture <fixture@example.invalid>',
    'rsa2048',
    'encr',
    '1d',
  ]);
  return run('gpg', ['--homedir', home, '--batch', '--with-colons', '--list-keys'])
    .toString()
    .split('\n')
    .find((l) => l.startsWith('fpr:'))
    .split(':')[9];
}
function mockPrivateDrive() {
  const objects = new Map();
  let next = 0,
    redirect = false,
    shared = false,
    truncate = false,
    corrupt = false,
    uploadFails = false,
    wrongOwner = false,
    wrongAccount = false,
    wrongPermission = false,
    missingOwner = false;
  const json = (body) =>
    new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const request = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    options.signal.throwIfAborted();
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'www.googleapis.com');
    if (parsed.pathname === '/drive/v3/about')
      return json({
        user: {
          emailAddress: wrongAccount ? 'wrong@example.invalid' : OWNER_EMAIL,
          permissionId: 'synthetic-owner-id',
        },
      });
    if (options.method === 'POST') {
      const meta = JSON.parse(options.body),
        id = `fixture_${++next}`;
      assert.deepEqual(meta.parents, [FOLDER_ID]);
      objects.set(id, { meta });
      return new Response(null, {
        headers: {
          location: redirect
            ? 'https://example.invalid/upload'
            : `https://www.googleapis.com/upload/drive/v3/files?upload_id=${id}`,
        },
      });
    }
    if (options.method === 'PUT') {
      const obj = objects.get(parsed.searchParams.get('upload_id'));
      const chunks = [];
      for await (const chunk of options.body) chunks.push(chunk);
      obj.bytes = Buffer.concat(chunks);
      if (uploadFails) return new Response(null, { status: 500 });
      return json({ id: parsed.searchParams.get('upload_id') });
    }
    const id = parsed.pathname.split('/').pop(),
      obj = objects.get(id);
    if (parsed.searchParams.get('alt') === 'media') {
      const bytes = Buffer.from(obj.bytes);
      if (corrupt) bytes[bytes.length - 1] ^= 255;
      return new Response(truncate ? bytes.subarray(0, -1) : bytes);
    }
    const emailAddress = wrongOwner ? 'wrong@example.invalid' : OWNER_EMAIL;
    const permissionId = wrongPermission ? 'wrong-permission-id' : 'synthetic-owner-id';
    const owner = {
      shared,
      trashed: false,
      owners: missingOwner ? [] : [{ emailAddress, permissionId }],
      permissions: [{ id: permissionId, emailAddress, type: 'user', role: 'owner' }],
    };
    if (id === FOLDER_ID)
      return json({
        ...owner,
        id,
        mimeType: 'application/vnd.google-apps.folder',
        capabilities: { canAddChildren: true },
      });
    return json({
      ...owner,
      id,
      name: obj.meta.name,
      parents: obj.meta.parents,
      size: String(obj.bytes.length),
    });
  };
  return {
    transport: createDriveTransport({ accessToken: 'synthetic-token', request }),
    objects,
    fault(kind) {
      redirect = kind === 'redirect';
      shared = kind === 'shared';
      truncate = kind === 'truncate';
      corrupt = kind === 'corrupt';
      uploadFails = kind === 'partial';
      wrongOwner = kind === 'wrong-owner';
      wrongAccount = kind === 'wrong-account';
      wrongPermission = kind === 'wrong-permission';
      missingOwner = kind === 'missing-owner';
    },
  };
}

async function restoreSynthetic({ source, target, file, digest, keyHome, recipient, workspace }) {
  fixtureSource(target);
  if (
    target.database === source.database ||
    target.host !== source.host ||
    target.port !== source.port ||
    target.user !== source.user
  )
    throw new Error('Distinct isolated fixture target required');
  if ((await sha256(file)) !== digest) throw new Error('Encrypted archive checksum mismatch');
  const db = new Pool({
    ...target,
    password: () => '',
    ssl: false,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  const plain = path.join(workspace, `restore-${crypto.randomUUID()}.dump`);
  try {
    const empty = (
      await db.query(
        "SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','S','v','m','f')",
      )
    ).rows[0].count;
    if (empty !== 0) throw new Error('Empty fixture target required');
    // Exit status includes OpenPGP integrity authentication. Never restore streamed unauthenticated plaintext.
    run('gpg', ['--homedir', keyHome, '--batch', '--no-tty', '--output', plain, '--decrypt', file]);
    fs.chmodSync(plain, 0o600);
    run(tool('pg_restore'), [
      ...pgArgs(target),
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-acl',
      plain,
    ]);
    return db;
  } catch {
    await db.end();
    throw new Error('Synthetic recovery failed');
  } finally {
    fs.rmSync(plain, { force: true });
  }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shiloh-backup-proof-'));
  const data = path.join(temp, 'pgdata'),
    sockets = path.join(temp, 'socket');
  fs.mkdirSync(sockets);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const user = os.userInfo().username;
  const source = {
    host: '127.0.0.1',
    port,
    user,
    database: `shiloh_backup_fixture_${crypto.randomBytes(8).toString('hex')}`,
  };
  const target = {
    ...source,
    database: `shiloh_backup_fixture_${crypto.randomBytes(8).toString('hex')}`,
  };
  let started = false,
    admin,
    db,
    recovered;
  const home = path.join(temp, 'keys'),
    wrongHome = path.join(temp, 'wrong-keys'),
    publicHome = path.join(temp, 'public-only');
  try {
    run(tool('initdb'), ['-D', data, '--auth=trust', '--no-locale', '--encoding=UTF8']);
    run(tool('pg_ctl'), [
      '-D',
      data,
      '-l',
      path.join(temp, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port} -k ${sockets}`,
      '-w',
      'start',
    ]);
    started = true;
    admin = new Pool({ ...source, database: 'postgres', password: () => '', ssl: false });
    await admin.query(`CREATE DATABASE ${source.database}`);
    await admin.query(`CREATE DATABASE ${target.database}`);
    db = new Pool({ ...source, password: () => '', ssl: false });
    const clinicalEnv = {
      CONSULTATION_FORM_DATA_KEY: crypto.randomBytes(32).toString('base64url'),
    };
    const payload = { fixture: true, answer: 'SYNTHETIC ONLY' },
      envelope = encryptSubmissionPayload(payload, { env: clinicalEnv });
    await db.query(`CREATE TABLE schema_migrations(filename text PRIMARY KEY,checksum text NOT NULL);
      CREATE TABLE synthetic_clients(id bigserial PRIMARY KEY,fixture_name text NOT NULL UNIQUE);
      CREATE TABLE synthetic_clinical(id bigserial PRIMARY KEY,client_id bigint NOT NULL REFERENCES synthetic_clients(id),ciphertext text NOT NULL,iv text NOT NULL,auth_tag text NOT NULL);
      INSERT INTO schema_migrations VALUES('synthetic_001.sql','synthetic-checksum');
      INSERT INTO synthetic_clients(fixture_name) VALUES('SYNTHETIC ONLY');`);
    await db.query(
      'INSERT INTO synthetic_clinical(client_id,ciphertext,iv,auth_tag) VALUES(1,$1,$2,$3)',
      [envelope.ciphertext, envelope.iv, envelope.authTag],
    );
    const recipient = key(home);
    key(wrongHome);
    fs.mkdirSync(publicHome, { mode: 0o700 });
    run('gpg', ['--homedir', publicHome, '--batch', '--import'], {
      input: run('gpg', ['--homedir', home, '--batch', '--export', recipient]),
    });
    const drive = mockPrivateDrive();
    const options = {
      enabled: true,
      source,
      sourceId: source.database,
      folderId: FOLDER_ID,
      publicKeyHome: publicHome,
      recipient,
      transport: drive.transport,
      pgDump: tool('pg_dump'),
      lockDirectory: temp,
    };
    const receipt = await copyDatabase(options);
    assert.equal(receipt.databaseRecoveryVerified, false);
    assert.equal(receipt.status, 'ciphertext-readback-verified');
    const metadataKeys = crypto.generateKeyPairSync('ed25519');
    const payloadBytes = JSON.stringify(receipt);
    const authenticated = databaseEvidence(
      {
        schemaVersion: 1,
        payload: payloadBytes,
        signature: crypto
          .sign(null, Buffer.from(payloadBytes), metadataKeys.privateKey)
          .toString('base64url'),
      },
      {
        trustedPublicKey: metadataKeys.publicKey,
        expectedSourceId: source.database,
        expectedRunId: receipt.runId,
        expectedOwnerPermissionId: 'synthetic-owner-id',
      },
    );
    assert.equal(authenticated.metadataAuthenticated, true);
    assert.equal(authenticated.databaseRecoveryVerified, false);
    assert.equal(databaseEvidence(receipt).status, 'unverified');
    const ciphertext = path.join(temp, 'download.gpg');
    fs.writeFileSync(ciphertext, drive.objects.get(receipt.fileId).bytes, { mode: 0o600 });
    assert.equal(await sha256(ciphertext), receipt.ciphertextSha256);
    recovered = await restoreSynthetic({
      source,
      target,
      file: ciphertext,
      digest: receipt.ciphertextSha256,
      keyHome: home,
      workspace: temp,
    });
    assert.equal(
      (await recovered.query('SELECT count(*)::int AS n FROM synthetic_clients')).rows[0].n,
      1,
    );
    assert.deepEqual(
      (await recovered.query('SELECT * FROM schema_migrations')).rows,
      (await db.query('SELECT * FROM schema_migrations')).rows,
    );
    const row = (
      await recovered.query('SELECT ciphertext,iv,auth_tag AS "authTag" FROM synthetic_clinical')
    ).rows[0];
    assert.deepEqual(decryptSubmissionPayload(row, { env: clinicalEnv }), payload);
    assert.throws(() => decryptSubmissionPayload(row, { env: {} }));
    assert.throws(() =>
      decryptSubmissionPayload(row, {
        env: { CONSULTATION_FORM_DATA_KEY: crypto.randomBytes(32).toString('base64url') },
      }),
    );
    assert.equal(
      (
        await recovered.query(
          "INSERT INTO synthetic_clients(fixture_name) VALUES('SYNTHETIC SECOND') RETURNING id",
        )
      ).rows[0].id,
      '2',
    );
    await assert.rejects(
      recovered.query("INSERT INTO synthetic_clients(fixture_name) VALUES('SYNTHETIC SECOND')"),
    );
    await assert.rejects(
      recovered.query(
        "INSERT INTO synthetic_clinical(client_id,ciphertext,iv,auth_tag) VALUES(999,'x','x','x')",
      ),
    );
    for (const sql of [
      "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
      "SELECT conrelid::regclass::text AS table_name,conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY table_name,conname",
    ])
      assert.deepEqual((await recovered.query(sql)).rows, (await db.query(sql)).rows);
    await recovered.end();
    recovered = null;
    const failedRecovery = {
      source,
      target: { ...target, database: source.database },
      file: ciphertext,
      digest: receipt.ciphertextSha256,
      keyHome: home,
      workspace: temp,
    };
    await assert.rejects(restoreSynthetic(failedRecovery));
    await assert.rejects(
      restoreSynthetic({ ...failedRecovery, target: { ...target, database: 'shiloh-memory' } }),
    );
    await assert.rejects(restoreSynthetic({ ...failedRecovery, target })); // populated target refused
    const emptyTarget = {
      ...source,
      database: `shiloh_backup_fixture_${crypto.randomBytes(8).toString('hex')}`,
    };
    await admin.query(`CREATE DATABASE ${emptyTarget.database}`);
    await assert.rejects(
      restoreSynthetic({ ...failedRecovery, target: emptyTarget, keyHome: wrongHome }),
    );
    for (const kind of ['corrupt', 'truncated']) {
      const bytes = Buffer.from(fs.readFileSync(ciphertext));
      if (kind === 'corrupt') bytes[bytes.length - 25] ^= 255;
      const bad = path.join(temp, kind + '.gpg');
      fs.writeFileSync(bad, kind === 'truncated' ? bytes.subarray(0, -12) : bytes);
      await assert.rejects(
        restoreSynthetic({
          ...failedRecovery,
          target: emptyTarget,
          file: bad,
          digest: await sha256(bad),
        }),
      );
    }
    const malformed = path.join(temp, 'malformed.gpg');
    run(
      'gpg',
      [
        '--homedir',
        publicHome,
        '--batch',
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
        malformed,
        '--encrypt',
      ],
      { input: Buffer.from('NOT A POSTGRES ARCHIVE') },
    );
    await assert.rejects(
      restoreSynthetic({
        ...failedRecovery,
        target: emptyTarget,
        file: malformed,
        digest: await sha256(malformed),
      }),
    );
    for (const fault of [
      'shared',
      'wrong-owner',
      'wrong-account',
      'wrong-permission',
      'missing-owner',
      'redirect',
      'truncate',
      'corrupt',
      'partial',
    ]) {
      drive.fault(fault);
      await assert.rejects(copyDatabase(options));
    }
    drive.fault('');
    const interrupted = new AbortController();
    await assert.rejects(
      copyDatabase({
        ...options,
        signal: interrupted.signal,
        transport: {
          ...drive.transport,
          upload: async (args) => {
            const id = await drive.transport.upload(args);
            interrupted.abort();
            return id;
          },
        },
      }),
    );
    await assert.rejects(copyDatabase({ ...options, sourceId: 'wrong-source' }));
    await assert.rejects(copyDatabase({ ...options, recipient: '0'.repeat(40) }));
    await assert.rejects(copyDatabase({ ...options, recipient: '' }));
    await assert.rejects(copyDatabase({ ...options, timeoutMs: 1 }));
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(copyDatabase({ ...options, signal: abort.signal }));
    const lock = path.join(
      temp,
      `shiloh-db-backup-${crypto
        .createHash('sha256')
        .update(JSON.stringify([source.port, source.user, source.database]))
        .digest('hex')}.lock`,
    );
    fs.writeFileSync(lock, 'synthetic-held-lock');
    await assert.rejects(copyDatabase(options));
    fs.unlinkSync(lock);
    const second = await copyDatabase(options);
    assert.notEqual(second.name, receipt.name);
    assert.notEqual(second.fileId, receipt.fileId);
    assert.equal(
      fs.readdirSync(temp).some((n) => n.endsWith('.lock')),
      false,
    );
    console.log(
      JSON.stringify({
        scope: 'synthetic-only',
        postgresMajor: 18,
        exportEncryptPrivateMockReadback: true,
        isolatedRestore: true,
        schemaSequencesConstraintsMigrationInventory: true,
        clinicalDecryption: true,
        ownerIdentityAndMetadataAuthentication: true,
        failureCases:
          'keys-integrity-archive-access-redirect-partial-source-timeout-cancellation-lock',
        productionActivated: false,
      }),
    );
  } finally {
    await recovered?.end();
    await db?.end();
    await admin?.end();
    if (started) run(tool('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
    for (const h of [home, wrongHome, publicHome])
      if (fs.existsSync(h)) run('gpgconf', ['--homedir', h, '--kill', 'all']);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
module.exports = { restoreSynthetic, mockPrivateDrive, main };
if (require.main === module)
  main().catch(() => {
    console.error('Synthetic database backup proof failed; no recovery or activation claim.');
    process.exitCode = 1;
  });
