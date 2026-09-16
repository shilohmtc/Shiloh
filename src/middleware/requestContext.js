const { randomUUID } = require("crypto");
const logger = require("../lib/logger");
const { runWithRequestLog } = require("../lib/requestLogContext");

function sanitizeRequestPath(value) {
  const path = String(value || "");
  return /^\/forms(?:\/|$)/i.test(path) ? "/forms/[private]" : path;
}

function requestContext(req, res, next) {
  const requestId = req.get("x-request-id") || randomUUID();
  const startedAt = Date.now();
  const requestPath = sanitizeRequestPath(req.path);

  req.id = requestId;
  req.log = logger.child({ requestId });
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    req.log.info(
      {
        method: req.method,
        path: requestPath,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      "request completed"
    );
  });

  return runWithRequestLog(req.log, next);
}

module.exports = requestContext;
module.exports.sanitizeRequestPath = sanitizeRequestPath;
