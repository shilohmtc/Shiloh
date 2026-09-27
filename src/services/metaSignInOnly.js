'use strict';

function metaSignInOnly(env = process.env) {
  return env.SHILOH_META_SIGNIN_ONLY_ENABLED === 'true';
}

function assertNonAuthMetaAllowed(env = process.env) {
  if (!metaSignInOnly(env)) return;
  const error = new Error('Non-sign-in Meta delivery is paused');
  error.code = 'META_SIGNIN_ONLY';
  throw error;
}

module.exports = { metaSignInOnly, assertNonAuthMetaAllowed };
