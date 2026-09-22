'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

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

async function assertAccessible(page, label, selector = 'body') {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  fs.writeFileSync(
    path.join(out, `${label}-accessibility.json`),
    JSON.stringify({ violations: results.violations }, null, 2),
  );
  if (blocking.length) {
    throw new Error(`${label} accessibility violations: ${blocking.map((item) => item.id).join(', ')}`);
  }
}

const SESSION_TOKEN = 'S'.repeat(43);
const BROWSER_TOKEN = 'B'.repeat(43);
const WHATSAPP_TOKEN = 'W'.repeat(43);
const COMPLETION_CODE = '654321';
const ACTION_TOKEN = 'A'.repeat(43);
const RESCHEDULE_TOKEN = 'R'.repeat(43);
let verified = false;
let loggedOut = false;
const assistantCalls = [];
const clearedAssistantSessions = [];
const confirmedActions = [];
const declinedActions = [];
const revokedActionSessions = [];

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
    if (/move|reschedule/i.test(message)) {
      return {
        reply: 'I prepared the new time for you. Please review the confirmation card below — your current appointment is unchanged.',
        contextVersion: 'my_shiloh_client_context_v1',
        action: {
          type: 'reschedule_appointment',
          token: RESCHEDULE_TOKEN,
          title: 'Request this new time?',
          service: 'Hot Stone Massage',
          practitioner: 'Marietjie',
          currentDate: 'Thursday, 24 September 2026',
          currentTime: '10:00',
          proposedDate: 'Friday, 25 September 2026',
          proposedTime: '09:00',
          note: 'Your current appointment stays confirmed until Marietjie approves the new time.',
          confirmLabel: 'Request reschedule',
          declineLabel: 'Keep current time',
        },
      };
    }
    if (/cancel/i.test(message)) {
      return {
        reply: 'I prepared the cancellation for you. Please review the confirmation card below — nothing has changed yet.',
        contextVersion: 'my_shiloh_client_context_v1',
        action: {
          type: 'cancel_appointment',
          token: ACTION_TOKEN,
          title: 'Cancel this appointment?',
          service: 'Hot Stone Massage',
          practitioner: 'Marietjie',
          date: 'Thursday, 24 September 2026',
          time: '10:00',
          policy: "Shiloh's 24-hour cancellation policy applies.",
          paymentNote: 'Cancelling an appointment does not automatically issue a refund.',
          confirmLabel: 'Cancel appointment',
          declineLabel: 'Keep appointment',
        },
      };
    }
    return { reply: 'Your Hot Stone Massage is on Thursday at 10:00 with Marietjie.', contextVersion: 'my_shiloh_client_context_v1' };
  },
  async clearConversation({ sessionId }) {
    clearedAssistantSessions.push(Number(sessionId));
  },
};

const fakeActionService = {
  async confirmAction({ sessionId, crmV2ClientId, actionToken }) {
    confirmedActions.push({ sessionId, crmV2ClientId, actionToken });
    if (Number(sessionId) !== 55 || Number(crmV2ClientId) !== 912) {
      return { ok: false, status: 'ownership_changed' };
    }
    if (actionToken === RESCHEDULE_TOKEN) {
      return {
        ok: true,
        status: 'pending_approval',
        reply: 'Reschedule request sent for practitioner approval.',
        appointment: {
          service: 'Hot Stone Massage',
          practitioner: 'Marietjie',
          proposedDate: 'Friday, 25 September 2026',
          proposedTime: '09:00',
        },
      };
    }
    if (actionToken !== ACTION_TOKEN) return { ok: false, status: 'ownership_changed' };
    return {
      ok: true,
      status: 'cancelled',
      appointment: {
        service: 'Hot Stone Massage',
        practitioner: 'Marietjie',
        date: 'Thursday, 24 September 2026',
        time: '10:00',
      },
    };
  },
  async declineAction({ sessionId, crmV2ClientId, actionToken }) {
    declinedActions.push({ sessionId, crmV2ClientId, actionToken });
    return { ok: true };
  },
  async revokeSessionActions({ sessionId, crmV2ClientId }) {
    revokedActionSessions.push({ sessionId, crmV2ClientId });
    return { ok: true };
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
  async completeVerifiedChallenge() {
    if (!verified) return { ok: false, code: 'CLIENT_AUTH_NOT_VERIFIED' };
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

async function runInstallGateViewport(browser, name, viewport, userAgent, expectedCopy, { simulateInstallPrompt = false } = {}) {
  const privateRequests = [];
  const context = await browser.newContext({ viewport, userAgent });
  await context.addCookies([{
    name: 'shiloh_client_session',
    value: SESSION_TOKEN,
    url: baseUrl,
    httpOnly: true,
    sameSite: 'Strict',
  }]);
  const page = await context.newPage();
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/my-shiloh/auth/') || pathname.startsWith('/my-shiloh/api/')) {
      privateRequests.push(pathname);
    }
  });

  await page.goto(`${baseUrl}/my-shiloh/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Install My Shiloh to continue.' }).waitFor();
  if (!(await page.locator('[data-install-gate]').isVisible())) throw new Error(`${name} install gate is not visible`);
  if (await page.locator('[data-app-frame]').isVisible()) throw new Error(`${name} exposed the client app in browser mode`);
  const browserText = await page.locator('body').textContent();
  if (/Christel Botha|Good (morning|afternoon|evening), Christel/.test(browserText || '')) {
    throw new Error(`${name} browser doorway rendered private signed-in client content`);
  }
  const intro = await page.locator('[data-install-platform-intro]').textContent();
  if (!String(intro || '').includes(expectedCopy)) throw new Error(`${name} platform guidance was not selected`);

  if (simulateInstallPrompt) {
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(event, 'prompt', { value: async () => undefined });
      Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome: 'accepted', platform: 'web' }) });
      window.dispatchEvent(event);
    });
    const install = page.getByRole('button', { name: 'Install My Shiloh' });
    await install.waitFor();
    await install.click();
    await page.waitForFunction(() => document.body.textContent.includes('My Shiloh is installed. Open the new My Shiloh icon to continue.'));
  }

  await assertAccessible(page, `${name}-install-gate`, '[data-install-gate]');
  await page.screenshot({ path: path.join(out, `${name}-install-gate.png`), fullPage: true });
  await page.waitForTimeout(100);
  if (privateRequests.length) {
    throw new Error(`${name} browser install gate started private My Shiloh requests: ${privateRequests.join(', ')}`);
  }
  await context.close();
}

async function runViewport(browser, name, viewport) {
  verified = false;
  loggedOut = false;
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      get: () => true,
    });
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/my-shiloh/`, { waitUntil: 'networkidle' });
  if (await page.locator('[data-install-gate]').isVisible()) throw new Error('install gate remained visible in standalone mode');
  if (!(await page.locator('[data-app-frame]').isVisible())) throw new Error('client app did not open in standalone mode');
  await assertAccessible(page, `${name}-guest-home`, '[data-app-frame]');
  await page.getByRole('button', { name: 'Continue with WhatsApp' }).click();
  await page.waitForURL('**/fake-whatsapp');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.textContent.includes('Checking your WhatsApp verification'));
  await page.screenshot({ path: path.join(out, `${name}-auth-return.png`), fullPage: true });
  verified = true;
  await page.waitForFunction(() => document.body.textContent.includes('Christel'));
  await page.waitForLoadState('networkidle');
  const heading = await page.locator('#home-title').textContent();
  if (!/Christel/.test(heading || '')) throw new Error('authenticated greeting missing');
  await page.waitForFunction(() => document.body.textContent.includes('Hot Stone Massage'));
  const experienceText = await page.locator('[data-client-experience-home]').textContent();
  if (!/Paid/.test(experienceText || '') || !/Complete/.test(experienceText || '')) {
    throw new Error('authenticated client experience missing');
  }

  await page.locator('[data-view-target="profile"]').click();
  const profileGeometry = await page.evaluate(() => {
    const card = document.querySelector('.profile-editor');
    const date = document.querySelector('#profile-date-of-birth');
    const cardBox = card?.getBoundingClientRect();
    const dateBox = date?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      contained: Boolean(cardBox && dateBox && dateBox.left >= cardBox.left && dateBox.right <= cardBox.right),
    };
  });
  if (profileGeometry.document > profileGeometry.viewport || !profileGeometry.contained) {
    throw new Error('personal details fields overflowed the profile card');
  }
  await assertAccessible(page, `${name}-profile`, '[data-app-frame]');
  await page.screenshot({ path: path.join(out, `${name}-profile.png`), fullPage: true });

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

  await page.locator('[data-shiloh-chat-input]').fill('Move my appointment to Friday at 09:00');
  await page.locator('[data-shiloh-chat-form]').getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Request this new time?'));
  const rescheduleCardText = await page.locator('[data-client-action-card]').textContent();
  if (!/Current:.*10:00/.test(rescheduleCardText || '') || !/Requested:.*09:00/.test(rescheduleCardText || '')) {
    throw new Error('reschedule confirmation card did not show current and requested times');
  }
  await page.getByRole('button', { name: 'Request reschedule' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('practitioner approval'));
  const chatScroll = await page.locator('[data-shiloh-messages]').evaluate((node) => ({
    overflowY: getComputedStyle(node).overflowY,
    maxHeight: getComputedStyle(node).maxHeight,
    hasInnerScroll: node.scrollHeight > node.clientHeight + 1,
  }));
  if (chatScroll.overflowY !== 'visible' || chatScroll.maxHeight !== 'none' || chatScroll.hasInnerScroll) {
    throw new Error(`Shiloh conversation must use the page's single scroll: ${JSON.stringify(chatScroll)}`);
  }
  if (!confirmedActions.some((call) => call.sessionId === 55 && call.crmV2ClientId === 912 && call.actionToken === RESCHEDULE_TOKEN)) {
    throw new Error('reschedule confirmation was not bound to the authenticated session');
  }
  const pageTextAfterRequest = await page.locator('body').textContent();
  if (/Your appointment has been rescheduled/i.test(pageTextAfterRequest || '')) {
    throw new Error('My Shiloh claimed a reschedule before practitioner approval');
  }

  await page.locator('[data-shiloh-chat-input]').fill('Cancel my appointment');
  await page.locator('[data-shiloh-chat-form]').getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Cancel this appointment?'));
  await page.getByRole('button', { name: 'Keep appointment' }).click();
  await page.locator('[data-client-action-card]').waitFor({ state: 'detached' });
  if (!declinedActions.some((call) => call.sessionId === 55 && call.crmV2ClientId === 912 && call.actionToken === ACTION_TOKEN)) {
    throw new Error('cancellation decline was not bound to the authenticated session');
  }

  await page.locator('[data-shiloh-chat-input]').fill('Cancel my appointment');
  await page.locator('[data-shiloh-chat-form]').getByRole('button', { name: 'Send' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Cancel this appointment?'));
  await page.getByRole('button', { name: 'Cancel appointment' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Your appointment has been cancelled'));
  if (!confirmedActions.some((call) => call.sessionId === 55 && call.crmV2ClientId === 912 && call.actionToken === ACTION_TOKEN)) {
    throw new Error('cancellation confirmation was not bound to the authenticated session');
  }

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
  if (!revokedActionSessions.some((call) => call.sessionId === 55 && call.crmV2ClientId === 912)) {
    throw new Error('outstanding client actions were not revoked on logout');
  }
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
    actionService: fakeActionService,
  }));

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() || undefined });
  try {
    await runInstallGateViewport(
      browser,
      'iphone-browser',
      { width: 390, height: 844 },
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
      'On iPhone',
    );
    await runInstallGateViewport(
      browser,
      'android-browser',
      { width: 412, height: 915 },
      'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
      'On Android',
      { simulateInstallPrompt: true },
    );
    await runInstallGateViewport(
      browser,
      'desktop-browser',
      { width: 1280, height: 900 },
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      'designed to be installed on your phone',
    );
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
