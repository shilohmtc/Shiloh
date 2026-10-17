// Prepared transport only: not wired to credentials, runtime, CLI or any recurring job.
const fs = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { FOLDER_ID, privateOwnerOnly, validUploadUrl } = require('./independent-code-backup');
const OWNER_EMAIL = 'shilohmtc@gmail.com';
const API = 'https://www.googleapis.com/drive/v3/files';
const FIELDS =
  'id,name,mimeType,parents,size,shared,trashed,owners(emailAddress,permissionId),permissions(id,type,role,emailAddress),capabilities(canAddChildren)';
function createDriveTransport({ accessToken, request = fetch }) {
  if (typeof accessToken !== 'string' || !accessToken || /[\r\n]/.test(accessToken))
    throw new Error('Dedicated authorization required');
  async function authorized(url, options, signal) {
    signal?.throwIfAborted();
    const response = await request(url, {
      ...options,
      headers: { ...options?.headers, Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error('Backup transfer unavailable');
    return response;
  }
  async function assertPrivate(id, { signal, name, size, folderId } = {}) {
    if (!/^[\w-]+$/.test(id || '')) throw new Error('Invalid backup object');
    const identity = await (
      await authorized(
        'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId)',
        {},
        signal,
      )
    ).json();
    const user = identity.user;
    if (
      typeof user?.emailAddress !== 'string' ||
      user.emailAddress.toLowerCase() !== OWNER_EMAIL ||
      typeof user.permissionId !== 'string' ||
      !/^[\w-]{1,128}$/.test(user?.permissionId || '')
    )
      throw new Error('Approved owner authorization required');
    const file = await (
      await authorized(`${API}/${id}?fields=${encodeURIComponent(FIELDS)}`, {}, signal)
    ).json();
    if (
      file.id !== id ||
      !privateOwnerOnly(file) ||
      file.owners?.length !== 1 ||
      file.owners[0].emailAddress?.toLowerCase() !== OWNER_EMAIL ||
      file.owners[0].permissionId !== user.permissionId ||
      file.permissions[0].emailAddress?.toLowerCase() !== OWNER_EMAIL ||
      file.permissions[0].id !== user.permissionId
    )
      throw new Error('Private destination unavailable');
    if (id === FOLDER_ID) {
      if (
        file.mimeType !== 'application/vnd.google-apps.folder' ||
        file.capabilities?.canAddChildren !== true
      )
        throw new Error('Private folder unavailable');
    } else if (
      folderId !== FOLDER_ID ||
      file.name !== name ||
      Number(file.size) !== size ||
      file.parents?.length !== 1 ||
      file.parents[0] !== folderId
    )
      throw new Error('Uploaded object mismatch');
    return { ownerEmail: OWNER_EMAIL, ownerPermissionId: user.permissionId };
  }
  return {
    assertPrivate,
    async upload({ file, name, size, folderId, signal }) {
      if (
        folderId !== FOLDER_ID ||
        !/^shiloh-database-[\w.-]+\.dump\.gpg$/.test(name) ||
        !Number.isSafeInteger(size) ||
        size < 1
      )
        throw new Error('Allowlisted destination required');
      await assertPrivate(folderId, { signal });
      const session = await authorized(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'application/octet-stream',
            'X-Upload-Content-Length': String(size),
          },
          body: JSON.stringify({
            name,
            parents: [folderId],
            appProperties: { shilohBackup: 'synthetic-database-v1' },
          }),
        },
        signal,
      );
      const url = validUploadUrl(session.headers.get('location'));
      const body = fs.createReadStream(file);
      try {
        const result = await authorized(
          url,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
            body,
            duplex: 'half',
          },
          signal,
        );
        const id = (await result.json()).id;
        await assertPrivate(id, { signal, name, size, folderId });
        return id;
      } finally {
        body.destroy();
      }
    },
    async download({ fileId, file, size, signal }) {
      if (!/^[\w-]+$/.test(fileId || '') || !Number.isSafeInteger(size) || size < 1)
        throw new Error('Invalid readback');
      const response = await authorized(`${API}/${fileId}?alt=media`, {}, signal);
      let bytes = 0;
      const bounded = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          callback(bytes > size ? new Error('Readback oversized') : null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        bounded,
        fs.createWriteStream(file, { mode: 0o600, flags: 'wx' }),
        { signal },
      );
      if (bytes !== size) throw new Error('Readback truncated');
    },
  };
}
module.exports = { createDriveTransport, OWNER_EMAIL };
