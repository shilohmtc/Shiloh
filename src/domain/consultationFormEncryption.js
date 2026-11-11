// Existing clinical encryption authority, independent of the app/database/bootstrap.
const crypto = require('node:crypto');
const CLIENT_FORM_DATA_KEY = 'CONSULTATION_FORM_DATA_KEY';

class ClientConsultationFormError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'ClientConsultationFormError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function parseDataKey(env = process.env) {
  const encoded = String(env[CLIENT_FORM_DATA_KEY] || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new ClientConsultationFormError(
      'CONSULTATION_FORM_DATA_KEY_UNAVAILABLE',
      'Consultation form submission is temporarily unavailable.',
      503,
    );
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) {
    throw new ClientConsultationFormError(
      'CONSULTATION_FORM_DATA_KEY_INVALID',
      'Consultation form submission is temporarily unavailable.',
      503,
    );
  }
  return key;
}

function encryptSubmissionPayload(
  payload,
  { env = process.env, randomBytes = crypto.randomBytes } = {},
) {
  const key = parseDataKey(env);
  const iv = randomBytes(12);
  if (!Buffer.isBuffer(iv) || iv.length !== 12)
    throw new Error('Consultation form encryption IV must be 12 bytes');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: authTag.toString('base64url'),
  };
}

function decryptSubmissionPayload(record, { env = process.env } = {}) {
  const key = parseDataKey(env);
  const iv = Buffer.from(String(record?.iv || ''), 'base64url');
  const authTag = Buffer.from(String(record?.authTag || ''), 'base64url');
  const ciphertext = Buffer.from(String(record?.ciphertext || ''), 'base64url');
  if (iv.length !== 12 || authTag.length !== 16 || !ciphertext.length)
    throw new Error('Invalid consultation form ciphertext envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
  );
}

module.exports = {
  CLIENT_FORM_DATA_KEY,
  ClientConsultationFormError,
  parseDataKey,
  encryptSubmissionPayload,
  decryptSubmissionPayload,
};
