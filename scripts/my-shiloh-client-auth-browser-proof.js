'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('@playwright/test');

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}
const { createMyShilohRouter } = require('../src/routes/myShiloh');

const out = path.join(__dirname, '..', 'artifacts', 'my-shiloh-client-auth-v1');
fs.mkdirSync(out, { recursive: true });

const SESSION_TOKEN = 'S'.repeat(43);
const BROWSER_TOKEN = 'B'.repeat(43);
const WHATSAPP_TOKEN = 'W'.repeat(43);
const COMPLETION_CODE = '654321';
let verified = false;
let loggedOut = false;
const assistantCalls = [];
const clearedAssistantSessions = [];

const fakeExperienceService = {
  async getExperience({ crmV2ClientId }) {
    if (Number(crmV2ClientId) !== 912) throw new Error('unexpected client');
    return {
      version: 'my_shiloh_client_experience_v1',
      generatedAt: new Date().toISOString(),
      client: { firstName: 'Christel' },
      home: {
        eyebrow: 'Next visit',
        headline: "You're set for Thu, 24 Sep.",
        summary: 'Hot Stone Massage at 10:00 with Marietjie.',
        status: 'Upcoming',
        primaryAction: { kind: 'navigate', label: 'View booking', href: '#bookings' },
        facts: [
          { label: 'Appointment', value: 'Thu, 24 Sep · 10:00' },
          { label: 'Forms', value: 'Complete' },
          { label: 'Payment', value: 'Paid' },
        ],
      },
      bookings: {
        upcoming: [{
          id: 901,
          service: 'Hot Stone Massage',
          practitioner: 'Marietjie',
          date: 'Thu, 24 Sep',
          time: '10:00',
          status: 'confirmed',
          forms: 'Complete',
          payment: 'Paid',
        }],
      },
      assistant: {
        prompts: [
          'What do I need before my appointment?',
          'Can I move my appointment?',
          'What is my appointment status?',
          'Has my payment been received?',
        ],
        contextReady: true,
      },
    };
  },
};

const fakeAssistantService = {
  async reply({ sessionId, crmV2ClientId, message }) {
    assistantCalls.push({ sessionId, crmV2ClientId, message });
    if (Number(sessionId) !== 55 || Number(crmV2ClientId) !== 912) {
      throw new Error('assistant did not receive server-owned client session identity');
    }
    if (/payment/i.test(message)) {
      return { reply: 'Yes — your payment is recorded as paid for this booking.', contextVersion: 'my_shiloh_client_context_v1' };
    }
    return { reply: 'Your Hot Stone Massage is on Thursday at 10:00 with Marietjie.', contextVersion: 'my_shiloh_client_context_v1' };
  },
  async clearConversation({ sessionId }) {
    clearedAssistantSessions.push(Number(sessionId));
  },
};

const fakeService = {
  async beginChallenge() {
    return {
      ok: true,
      browserToken: BROWSER_TOKEN,
      whatsappToken: WHATSAPP_TOKEN,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  },
  async completeChallenge({ completionCode }) {
    if (!verified || completionCode !== COMPLETION_CODE) return { ok: false, code: 'CLIENT_AUTH_INVALID_COMPLETION' };
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
  await page.goto(`${baseUrl}/my-shiloh/#verify=${COMPLETION_CODE}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.textContent.includes('Christel'));
  await page.waitForLoadState('networkidle');
  const heading = await page.locator('#home-title').textContent();
  if (!/Christel/.test(heading || '')) throw new Error('authenticated greeting missing');
  await page.waitForFunction(() => document.body.textContent.includes('Hot Stone Massage'));
  const experienceText = await page.locator('[data-client-experience-home]').textContent();
  if (!/Paid/.test(experienceText || '') || !/Complete/.test(experienceText || '')) {
    throw new Error('authenticated client experience missing');
  }

  const cookies = await context.cookies(baseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === 'shiloh_client_session');
  if (!sessionCookie || sessionCookie.httpOnly !== true || sessionCookie.sameSite !== 'Strict') {
    throw new Error('client session cookie is not hardened');
  }
  if ((await page.evaluate(() => document.cookie)).includes('shiloh_client_session=')) {
    throw new Error('client session cookie is visible to browser JavaScript');
  }

  await page.locator('[data-view-target="shiloh"]').click();
  await page.locator('[data-shiloh-prompt]').first().click();
  await page.waitForFunction(() => document.body.textContent.includes('Thursday at 10:00 with Marietjie'));
  await page.locator('[data-shiloh-chat-input]').fill('Has my payment been received?');
  await page.locator('[data-shiloh-chat-form]').getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('payment is recorded as paid'));
  const browserStorage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  if (browserStorage.local !== 0 || browserStorage.session !== 0) {
    throw new Error('in-app Shiloh conversation persisted to browser storage');
  }
  if (!assistantCalls.some((call) => call.sessionId === 55 && call.crmV2ClientId === 912)) {
    throw new Error('in-app Shiloh did not use server-owned identity');
  }
  await page.screenshot({ path: path.join(out, `${name}-chat.png`), fullPage: true });

  await page.locator('[data-view-target="profile"]').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Continue with WhatsApp'));
  if (!clearedAssistantSessions.includes(55)) throw new Error('assistant conversation was not cleared on logout');
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
    experienceService: fakeExperienceService,
    assistantService: fakeAssistantService,
  }));

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() || undefined });
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
