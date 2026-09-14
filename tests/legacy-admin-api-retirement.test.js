const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const adminRoutes = require('../src/routes/admin');

function request(server, pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: pathname, method, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(work) {
  const app = express();
  app.use((req, _res, next) => { req.id = 'synthetic-request'; next(); });
  app.use('/admin', adminRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try { await work(server); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function javascriptSources(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptSources(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
  }
  return files;
}

test('every former admin operation returns the same fail-closed retirement response', async () => {
  await withServer(async server => {
    for (const [method, pathname] of [
      ['GET', '/admin/database/status'],
      ['POST', '/admin/sync/goldie'],
      ['GET', '/admin/privacy/clients/42/preview'],
      ['POST', '/admin/privacy/requests/42/authorize'],
    ]) {
      const response = await request(server, pathname, {
        method,
        headers: { 'x-admin-key': 'former-master-key', 'x-privacy-owner-key': 'former-owner-key' },
      });
      assert.equal(response.status, 410);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(JSON.parse(response.body), {
        error: 'Legacy admin API retired',
        code: 'SHILOH_LEGACY_ADMIN_API_RETIRED',
        requestId: 'synthetic-request',
      });
    }
  });
});

test('runtime source contains no retired shared-key admin authority', () => {
  const sourceRoot = path.join(__dirname, '..', 'src');
  const sources = javascriptSources(sourceRoot).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(sources, /ADMIN_API_KEY|x-admin-key|PRIVACY_OWNER_APPROVAL_KEY|x-privacy-owner-key/i);
});

test('application exposes only the explicit retired admin router', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /app\.use\("\/admin", adminRoutes\)/);
  assert.doesNotMatch(app, /privacyRoutes|\/admin\/privacy/);
});

test('current runtime and privacy contracts record retirement instead of stale key instructions', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'docs/RUNTIME_ENVIRONMENT_CONTRACT.md'), 'utf8');
  const privacy = fs.readFileSync(path.join(__dirname, '..', 'docs/PRIVACY-DATA-SUBJECT-RIGHTS.md'), 'utf8');
  assert.match(runtime, /Retired runtime authority — external secret removal pending/);
  assert.match(runtime, /generic `\/admin\/\*` HTTP authority was retired/);
  assert.match(privacy, /former shared-key `\/admin\/privacy\/\*` HTTP surface was retired/);
  assert.match(privacy, /future explicitly authorized, capability-scoped Shiloh Workspace unit/);
});
