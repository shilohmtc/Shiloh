const crypto = require("crypto");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function auditReadAuth(req, res, next) {
  res.set("Cache-Control", "no-store");

  const configuredToken = process.env.AUDIT_READ_TOKEN;
  if (!configuredToken) {
    return res.status(503).json({ error: "Audit read API is not configured", requestId: req.id });
  }

  const suppliedToken = req.get("x-audit-read-token");
  if (!safeEqual(suppliedToken, configuredToken)) {
    return res.status(401).json({ error: "Unauthorized", requestId: req.id });
  }

  return next();
}

module.exports = auditReadAuth;
