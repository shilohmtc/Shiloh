// Fixture-tested authentication boundary only. No filesystem ingestion or configured production trust.
const crypto = require('node:crypto');
const { FOLDER_ID } = require('./independent-code-backup');
const { OWNER_EMAIL } = require('./database-backup-drive');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FIELDS = [
  'schemaVersion',
  'runId',
  'ownerEmail',
  'ownerPermissionId',
  'status',
  'scope',
  'snapshotAt',
  'checkedAt',
  'sourceId',
  'postgresMajor',
  'archiveFormat',
  'encryption',
  'ciphertextSha256',
  'ciphertextBytes',
  'folderId',
  'fileId',
  'name',
  'privateOwnerOnly',
  'downloadChecksumMatches',
  'databaseRecoveryVerified',
];
function exactFields(value, fields) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((k) => Object.hasOwn(value, k))
  );
}
function databaseEvidence(
  envelope,
  {
    trustedPublicKey,
    expectedSourceId,
    expectedRunId,
    expectedOwnerPermissionId,
    now = Date.now(),
  } = {},
) {
  const failed = { status: 'unverified', databaseRecoveryVerified: false };
  if (!envelope) return { status: 'disabled', databaseRecoveryVerified: false };
  try {
    // The pinned verification key must come from independent trusted configuration, never the envelope.
    if (
      trustedPublicKey?.type !== 'public' ||
      trustedPublicKey.asymmetricKeyType !== 'ed25519' ||
      !exactFields(envelope, ['schemaVersion', 'payload', 'signature']) ||
      envelope.schemaVersion !== 1 ||
      typeof envelope.payload !== 'string' ||
      Buffer.byteLength(envelope.payload) > 8192 ||
      !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature || '') ||
      !crypto.verify(
        null,
        Buffer.from(envelope.payload),
        trustedPublicKey,
        Buffer.from(envelope.signature, 'base64url'),
      )
    )
      return failed;
    const r = JSON.parse(envelope.payload);
    const snapshot = Date.parse(r.snapshotAt),
      checked = Date.parse(r.checkedAt),
      age = now - snapshot;
    if (
      !exactFields(r, FIELDS) ||
      JSON.stringify(r) !== envelope.payload ||
      r.schemaVersion !== 1 ||
      r.status !== 'ciphertext-readback-verified' ||
      r.scope !== 'synthetic-only' ||
      r.sourceId !== expectedSourceId ||
      !/^shiloh_backup_fixture_[a-f0-9]{16}$/.test(expectedSourceId || '') ||
      r.runId !== expectedRunId ||
      !UUID.test(expectedRunId || '') ||
      r.ownerEmail !== OWNER_EMAIL ||
      r.ownerPermissionId !== expectedOwnerPermissionId ||
      !/^[\w-]{1,128}$/.test(expectedOwnerPermissionId || '') ||
      r.folderId !== FOLDER_ID ||
      !/^[\w-]{1,128}$/.test(r.fileId || '') ||
      !/^[a-f0-9]{64}$/.test(r.ciphertextSha256 || '') ||
      !Number.isSafeInteger(r.ciphertextBytes) ||
      r.ciphertextBytes < 1 ||
      r.postgresMajor !== 18 ||
      r.archiveFormat !== 'pg-custom' ||
      r.encryption !== 'OpenPGP-AES256-OCB' ||
      r.privateOwnerOnly !== true ||
      r.downloadChecksumMatches !== true ||
      r.databaseRecoveryVerified !== false ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 36 * 60 * 60 * 1000 ||
      !Number.isFinite(checked) ||
      checked > now ||
      checked < snapshot ||
      new Date(snapshot).toISOString() !== r.snapshotAt ||
      new Date(checked).toISOString() !== r.checkedAt ||
      r.name !== `shiloh-database-${r.snapshotAt.replace(/[:.]/g, '-')}-${r.runId}.dump.gpg`
    )
      return failed;
    return { ...r, metadataAuthenticated: true };
  } catch {
    return failed;
  }
}
module.exports = { databaseEvidence };
