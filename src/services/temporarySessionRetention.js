const { pool } = require("../db/pool");
const logger = require("../lib/logger");

const DEFAULT_TEMPORARY_SESSION_TTL_HOURS = 2;
const MIN_TEMPORARY_SESSION_TTL_HOURS = 1;
const MAX_TEMPORARY_SESSION_TTL_HOURS = 24;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let cleanupTimer = null;

function temporarySessionTtlHours(value = process.env.TEMPORARY_WORKFLOW_TTL_HOURS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TEMPORARY_SESSION_TTL_HOURS;
  return Math.max(MIN_TEMPORARY_SESSION_TTL_HOURS, Math.min(MAX_TEMPORARY_SESSION_TTL_HOURS, Math.floor(parsed)));
}

async function cleanupTemporarySessions() {
  const ttlHours = temporarySessionTtlHours();
  // Independent support-link expiry shares this existing hourly timer.
  void cleanupSupportLinks();
  try {
    const [onboarding, walkin] = await Promise.all([
      pool.query(
        `DELETE FROM client_onboarding_sessions
          WHERE updated_at < NOW() - make_interval(hours => $1::int)`,
        [ttlHours]
      ),
      pool.query(
        `DELETE FROM walkin_registration_sessions
          WHERE updated_at < NOW() - make_interval(hours => $1::int)`,
        [ttlHours]
      ),
    ]);

    const expiredOnboarding = onboarding.rowCount || 0;
    const expiredWalkins = walkin.rowCount || 0;
    if (expiredOnboarding || expiredWalkins) {
      logger.info(
        { ttlHours, expiredOnboarding, expiredWalkins },
        "Expired temporary registration workflow sessions"
      );
    }
    return { expiredOnboarding, expiredWalkins };
  } catch (error) {
    logger.error({ err: error }, "failed to expire temporary registration workflow sessions");
    return { expiredOnboarding: 0, expiredWalkins: 0 };
  }
}

async function cleanupSupportLinks() {
  try { await require('./bookingSubmissionIncidents').service.expire(); }
  catch (_) { logger.warn('Booking support link expiry temporarily unavailable'); }
}
function startTemporarySessionCleanupScheduler() {
  if (cleanupTimer) return cleanupTimer;
  cleanupTemporarySessions();
  cleanupTimer = setInterval(cleanupTemporarySessions, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  return cleanupTimer;
}

module.exports = {
  temporarySessionTtlHours,
  cleanupTemporarySessions,
  startTemporarySessionCleanupScheduler,
  DEFAULT_TEMPORARY_SESSION_TTL_HOURS,
  MAX_TEMPORARY_SESSION_TTL_HOURS,
};
