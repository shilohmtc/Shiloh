'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('@playwright/test');
const { createMyShilohRouter } = require('../src/routes/myShiloh');

const out = path.join(__dirname, '..', 'artifacts', 'my-shiloh-client-auth-v1');
fs.mkdirSync(out, { recursive: true });

const SESSION_TOKEN = 'S'.repeat(43);
const BROWSER_TOKEN = 'B'.repeat(43);
const WHATSAPP_TOKEN = 'W'.repeat(43);
let verified = false;
let loggedOut = false;

const fakeService = {
  async beginChallenge() {
    return {
      ok: true,
      browserToken: BROWSER_TOKEN,
      whatsappToken: WHATSAPP_TOKEN,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  },
  async exchangeChallenge() {
    if (!verified) return { ok: true, status: 'pending', expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
    return {
      ok: true,
      status: 'authenticated',
      sessionToken: SESSION_TOKEN,
      csrfToken: 'C'.repeat(43),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      client: { id: '912', name: 'Christel Botha', firstName: 'Christel' },
    };
  },
  async validateSessionToken(token) {
    if (loggedOut || token !== SESSION_TOKEN) return { ok: false };
    return {
      ok: true,
      sessionId: 55,
      crmV2ClientId: 912,
      csrfHash: 'hash',
      client: { id: '912', name: 'Christel Botha', firstName: 'Christel' },
    };
  },
  async rotateCsrfToken() {
    return { ok: true, csrfToken: 'C'.repeat(43) };
  },
  validateCsrfToken(_session, supplied) {
    return supplied === 'C'.repeat(43);
  },
  async revokeSession() {
    loggedOut = true;
    return { ok: true };
  },
};

async function runViewport(browser, name, viewport) {
  verified = false;
  loggedOut = false;
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/my-shiloh/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Continue with WhatsApp' }).click();
  await page.waitForURL('**/fake-whatsapp');
  verified = true;
  await page.goto(`${baseUrl}/my-shiloh/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.textContent.includes('Christel'));
  await page.waitForLoadState('networkidle');
  const heading = await page.locator('#home-title').textContent();
  if (!/Christel/.test(heading || '')) throw new Error('authenticated greeting missing');

  const cookies = await context.cookies(baseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === 'shiloh_client_session');
  if (!sessionCookie || sessionCookie.httpOnly !== true || sessionCookie.sameSite !== 'Strict') {
    throw new Error('client session cookie is not hardened');
  }
  if ((await page.evaluate(() => document.cookie)).includes('shiloh_client_session=')) {
    throw new Error('client session cookie is visible to browser JavaScript');
  }

  await page.locator('[data-view-target="profile"]').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Continue with WhatsApp'));
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  await context.close();
}

let server;
let baseUrl;

(async () => {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.get('/fake-whatsapp', (_req, res) => res.type('html').send('<!doctype html><title>WhatsApp verified</title><p>Verified</p>'));
  app.use('/', createMyShilohRouter({
    env: { NODE_ENV: 'test' },
    sessionService: fakeService,
    whatsappResolver: async () => '27830000000',
    catalogueProvider: async () => [],
    authUrlBuilder: () => '/fake-whatsapp',
  }));

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, 'phone', { width: 390, height: 844 });
    await runViewport(browser, 'desktop', { width: 1280, height: 900 });
  } finally {
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.close();
  });
