const path = require("path");
const Sentry = require("@sentry/node");
const logger = require("./logger");

const SAFE_INTEGRATIONS = new Set([
  "InboundFilters",
  "FunctionToString",
  "LinkedErrors",
  "OnUncaughtException",
  "OnUnhandledRejection",
]);
const SAFE_TAGS = new Set([
  "error.code",
  "error.kind",
  "http.method",
  "http.route",
  "runtime.phase",
]);

function safeIdentifier(value, fallback, maxLength = 80) {
  const normalized = String(value || "").trim();
  if (!normalized || !/^[A-Za-z0-9_.:/-]+$/.test(normalized)) return fallback;
  return normalized.slice(0, maxLength);
}

function safeFrameFilename(value) {
  if (!value) return undefined;
  const normalized = String(value).replace(/\\/g, "/");
  const projectPath = normalized.match(/(?:^|\/)(app\.js|src\/[^?]+|scripts\/[^?]+)$/);
  if (projectPath) return projectPath[1].slice(0, 240);
  return path.basename(normalized).slice(0, 120) || undefined;
}

function sanitizeFrame(frame = {}) {
  return {
    filename: safeFrameFilename(frame.filename),
    function: safeIdentifier(frame.function, undefined, 160),
    module: safeIdentifier(frame.module, undefined, 160),
    lineno: Number.isInteger(frame.lineno) ? frame.lineno : undefined,
    colno: Number.isInteger(frame.colno) ? frame.colno : undefined,
    in_app: typeof frame.in_app === "boolean" ? frame.in_app : undefined,
  };
}

function sanitizeException(exception = {}) {
  const values = Array.isArray(exception.values) ? exception.values : [];
  return {
    values: values.map((value = {}) => ({
      type: safeIdentifier(value.type, "Error", 120),
      value: "Unhandled application error",
      mechanism: value.mechanism
        ? {
            type: safeIdentifier(value.mechanism.type, undefined, 80),
            handled: typeof value.mechanism.handled === "boolean" ? value.mechanism.handled : undefined,
          }
        : undefined,
      stacktrace: value.stacktrace && Array.isArray(value.stacktrace.frames)
        ? { frames: value.stacktrace.frames.map(sanitizeFrame) }
        : undefined,
    })),
  };
}

function sanitizeTags(tags = {}) {
  const output = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!SAFE_TAGS.has(key)) continue;
    const sanitized = safeIdentifier(value, undefined, 120);
    if (sanitized) output[key] = sanitized;
  }
  return output;
}

function sanitizeSentryEvent(event = {}) {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: "node",
    level: event.level || "error",
    environment: safeIdentifier(event.environment, undefined, 80),
    release: safeIdentifier(event.release, undefined, 120),
    exception: sanitizeException(event.exception),
    tags: sanitizeTags(event.tags),
  };
}

function sentryConfig(env) {
  return {
    dsn: env.SENTRY_DSN,
    environment: safeIdentifier(env.SENTRY_ENVIRONMENT || env.NODE_ENV, "production", 80),
    release: safeIdentifier(env.SENTRY_RELEASE || env.RENDER_GIT_COMMIT, undefined, 120),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    integrations(defaultIntegrations) {
      return defaultIntegrations.filter((integration) => SAFE_INTEGRATIONS.has(integration.name));
    },
    beforeSend: sanitizeSentryEvent,
  };
}

function createObservability({ sentry = Sentry, log = logger } = {}) {
  let enabled = false;

  function initialize(env = process.env) {
    if (!String(env.SENTRY_DSN || "").trim()) return false;
    if (enabled) return true;

    try {
      sentry.init(sentryConfig(env));
      enabled = true;
  log.info("Privacy-safe Sentry monitoring initialized");
      return true;
    } catch (_error) {
      log.warn("Sentry disabled because initialization failed");
      return false;
    }
  }

  function captureException(error, context = {}) {
    if (!enabled) return false;

    try {
      sentry.withScope((scope) => {
        scope.clearBreadcrumbs?.();
        scope.setUser?.(null);
        for (const [key, value] of Object.entries(sanitizeTags(context))) {
          scope.setTag(key, value);
        }
        sentry.captureException(error);
      });
      return true;
    } catch (_error) {
      log.warn("Sentry error capture failed safely");
      return false;
    }
  }

  async function flush(timeoutMs = 2000) {
    if (!enabled) return true;
    try {
      return await sentry.flush(timeoutMs);
    } catch (_error) {
      return false;
    }
  }

  return { initialize, captureException, flush, isEnabled: () => enabled };
}

const observability = createObservability();

module.exports = {
  ...observability,
  createObservability,
  sanitizeSentryEvent,
  sentryConfig,
};
