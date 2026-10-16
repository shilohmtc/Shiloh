// Presentation context only: never authorizes a form, session or client read.
const crypto = require('node:crypto');
const { parseDataKey, normalizeAccessToken } = require('./clientConsultationForms');

function myShilohFormReturnProof(token, env = process.env) {
  return crypto.createHmac('sha256', parseDataKey(env))
    .update(`my-shiloh-form-return-v1\n${normalizeAccessToken(token)}`)
    .digest('base64url');
}

function validMyShilohFormReturn(token, proof, env = process.env) {
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(proof), Buffer.from(myShilohFormReturnProof(token, env)));
  } catch (_error) { return false; }
}

module.exports = { myShilohFormReturnProof, validMyShilohFormReturn };
