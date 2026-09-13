const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditReadAuth = require('../src/middleware/auditReadAuth');
const {
  requestIsHttps,
  securityHeaders,
} = require('../src/middleware/securityHeaders');

function responseDouble(initialHeaders = {}) {
  const headers = new Map(
    Object.entries(initialHeaders).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    statusCode: 200,
    body: null,
    set(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return this;
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('#979 audit read authentication accepts only the dedicated request header', () => {
  const original = process.env.AUDIT_READ_TOKEN;
  process.env.AUDIT_READ_TOKEN = 'header-only-secret';
  try {
    let continued = false;
    const queryOnlyResponse = responseDouble();
    auditReadAuth(
      {
        id: 'query-only',
        query: { access: 'header-only-secret' },
        get: () => undefined,
      },
      queryOnlyResponse,
      () => {
        continued = true;
      },
    );
    assert.equal(continued, false);
    assert.equal(queryOnlyResponse.statusCode, 401);
    assert.deepEqual(queryOnlyResponse.body, {
      error: 'Unauthorized',
      requestId: 'query-only',
    });
    assert.equal(queryOnlyResponse.getHeader('Cache-Control'), 'no-store');

    const headerResponse = responseDouble();
    auditReadAuth(
      {
        id: 'header',
        query: { access: 'wrong-value' },
        get: (name) => (name === 'x-audit-read-token' ? 'header-only-secret' : undefined),
      },
      headerResponse,
      () => {
        continued = true;
      },
    );
    assert.equal(continued, true);
    assert.equal(headerResponse.statusCode, 200);
    assert.equal(headerResponse.getHeader('Cache-Control'), 'no-store');
  } finally {
    if (original === undefined) delete process.env.AUDIT_READ_TOKEN;
    else process.env.AUDIT_READ_TOKEN = original;
  }
});

test('#979 audit read authentication remains fail closed when unconfigured', () => {
  const original = process.env.AUDIT_READ_TOKEN;
  delete process.env.AUDIT_READ_TOKEN;
  try {
    let continued = false;
    const res = responseDouble();
    auditReadAuth(
      { id: 'missing-config', query: {}, get: () => undefined },
      res,
      () => {
        continued = true;
      },
    );
    assert.equal(continued, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.getHeader('Cache-Control'), 'no-store');
  } finally {
    if (original !== undefined) process.env.AUDIT_READ_TOKEN = original;
  }
});

test('#979 global headers establish conservative defaults and HSTS only for HTTPS', () => {
  const secure = responseDouble();
  let continued = false;
  securityHeaders(
    {
      secure: false,
      get: (name) => (name === 'x-forwarded-proto' ? 'https,http' : undefined),
    },
    secure,
    () => {
      continued = true;
    },
  );

  assert.equal(continued, true);
  assert.equal(secure.getHeader('X-Content-Type-Options'), 'nosniff');
  assert.equal(secure.getHeader('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(secure.getHeader('X-Frame-Options'), 'SAMEORIGIN');
  assert.equal(secure.getHeader('Strict-Transport-Security'), 'max-age=15552000');
  assert.equal(requestIsHttps({ secure: true }), true);
  assert.equal(requestIsHttps({ secure: false, headers: {} }), false);

  const http = responseDouble();
  securityHeaders({ secure: false, headers: {} }, http, () => {});
  assert.equal(http.getHeader('Strict-Transport-Security'), undefined);
});

test('#979 stronger route-specific response headers are preserved', () => {
  const res = responseDouble({
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  securityHeaders({ secure: true }, res, () => {});
  assert.equal(res.getHeader('Referrer-Policy'), 'no-referrer');
  assert.equal(res.getHeader('X-Frame-Options'), 'DENY');
});

test('#979 application installs the header baseline before redirects and routes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(source, /require\("\.\/src\/middleware\/securityHeaders"\)/);
  assert.ok(source.indexOf('app.use(securityHeaders)') < source.indexOf('app.use(canonicalHostRedirect)'));
  assert.ok(source.indexOf('app.use(securityHeaders)') < source.indexOf('app.use("/audit-read"'));
});
