'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APP_HOST,
  PUBLIC_SITE_ORIGIN,
  canonicalHostRedirect,
  requestHostname,
} = require('../src/middleware/canonicalHostRedirect');

function run({ host, forwardedHost = '', method = 'GET', path = '/book', originalUrl = path } = {}) {
  let nextCalled = false;
  let redirect = null;
  const req = {
    headers: { host, ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}) },
    method,
    path,
    originalUrl,
  };
  const res = {
    redirect(status, location) {
      redirect = { status, location };
      return redirect;
    },
  };
  const result = canonicalHostRedirect(req, res, () => { nextCalled = true; });
  return { nextCalled, redirect, result };
}

test('redirects legacy Render booking links to the canonical Shiloh origin', () => {
  const result = run({
    host: 'shiloh-whatsapp-bot.onrender.com',
    path: '/book',
    originalUrl: '/book?service=massage',
  });

  assert.equal(result.nextCalled, false);
  assert.deepEqual(result.redirect, {
    status: 308,
    location: `${PUBLIC_SITE_ORIGIN}/book?service=massage`,
  });
});

test('redirects public website pages from the transitional app host to the root domain', () => {
  const result = run({
    host: APP_HOST,
    path: '/treatments',
    originalUrl: '/treatments?category=massage',
  });

  assert.equal(result.nextCalled, false);
  assert.deepEqual(result.redirect, {
    status: 308,
    location: `${PUBLIC_SITE_ORIGIN}/treatments?category=massage`,
  });

  const trailingSlash = run({ host: APP_HOST, path: '/book/', originalUrl: '/book/' });
  assert.deepEqual(trailingSlash.redirect, {
    status: 308,
    location: `${PUBLIC_SITE_ORIGIN}/book/`,
  });
});

test('keeps app-only sessions, installed apps, forms and provider callbacks on the app host', () => {
  for (const path of [
    '/my-shiloh/',
    '/calendar',
    '/admin',
    '/forms/f/example',
    '/gift-vouchers/example',
    '/payments/providers/ozow/notify',
    '/webhook',
  ]) {
    assert.equal(run({ host: APP_HOST, path, originalUrl: path }).nextCalled, true, path);
  }
});

test('does not redirect non-idempotent app-host requests or unrelated hosts', () => {
  assert.equal(run({ host: APP_HOST, method: 'POST', path: '/', originalUrl: '/' }).nextCalled, true);
  assert.equal(run({ host: 'internal-service:10000' }).nextCalled, true);
});

test('keeps health and webhook paths available on the legacy hostname for rollback safety', () => {
  assert.equal(run({ host: 'shiloh-whatsapp-bot.onrender.com', path: '/health' }).nextCalled, true);
  assert.equal(run({ host: 'shiloh-whatsapp-bot.onrender.com', path: '/webhook' }).nextCalled, true);
});

test('uses the first forwarded hostname and strips a port', () => {
  assert.equal(
    requestHostname({ headers: { host: 'internal:10000', 'x-forwarded-host': 'shiloh-whatsapp-bot.onrender.com:443, proxy.local' } }),
    'shiloh-whatsapp-bot.onrender.com'
  );
});
