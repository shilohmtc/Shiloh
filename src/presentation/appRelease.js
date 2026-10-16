'use strict';

// One public release identity for the two apps delivered by this service.
// Render changes the build on every deployment, including presentation-only releases.
const APP_VERSION = '2.1.0';
function appRelease(env = (typeof process !== 'undefined' && process.env) || {}) {
  const commit = String(env.RENDER_GIT_COMMIT || '');
  const build = /^[a-f0-9]{40}$/i.test(commit) ? commit.slice(0, 7).toLowerCase() : 'local';
  return `${APP_VERSION}-${build}`;
}

module.exports = { APP_VERSION, appRelease };
