'use strict';

// Compatibility name for callers that already select the My Shiloh path.
// Client and staff sign-in now use passkeys and SMS; no Meta send is authorized.
function metaSignInOnly(env = process.env) {
  // Production stays retired even if an old Render flag is removed or changed.
  // Explicitly injected environments retain historical outcome fixtures.
  return env === process.env || env.SHILOH_META_SIGNIN_ONLY_ENABLED === 'true';
}

function assertNonAuthMetaAllowed() {
  const error = new Error('Automated WhatsApp delivery is retired');
  error.code = 'META_SIGNIN_ONLY';
  throw error;
}

module.exports = { metaSignInOnly, assertNonAuthMetaAllowed };
