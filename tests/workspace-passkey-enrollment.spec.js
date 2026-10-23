// Production presentation with synthetic responses; never sends a real code.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { workspaceWhatsAppPage, workspaceWhatsAppScript } = require('../src/presentation/workspaceWhatsAppUx');
const BASE = '/calendar/staff-auth/whatsapp';

async function enrollment(page, { expired = false, unavailable = false, delayed = false } = {}) {
  const calls = { proofs: [], starts: 0, finishes: 0 };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.addInitScript(() => {
    window.__credentialMode = 'cancel'; window.__creates = 0;
    window.PublicKeyCredential = window.PublicKeyCredential || function () {};
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      create: async ({ publicKey }) => {
        window.__creates++;
        if (!(publicKey.challenge instanceof Uint8Array)) throw Error('Challenge not decoded');
        if (window.__credentialMode === 'cancel') throw new DOMException('Cancelled', 'NotAllowedError');
        const bytes = () => new Uint8Array([1, 2, 3]).buffer;
        return { id: 'AQID', rawId: bytes(), type: 'public-key', response: {
          clientDataJSON: bytes(), attestationObject: bytes(), getTransports: () => ['internal'],
        } };
      },
    } });
  });
  await page.route('**/calendar/staff-auth/csrf', r => r.fulfill({ json: { csrfToken: 'synthetic' } }));
  await page.route(`**${BASE}/app.js`, r => r.fulfill({ contentType: 'application/javascript', body: workspaceWhatsAppScript() }));
  await page.route(`**${BASE}/enroll`, r => r.fulfill({ contentType: 'text/html', body: workspaceWhatsAppPage({ enrollment: true, recoveryEnabled: false }) }));
  await page.route(`**${BASE}/enrollment/own`, async r => {
    expect(r.request().headers()['x-shiloh-csrf-token']).toBe('synthetic');
    const proof = r.request().postDataJSON().proof; calls.proofs.push(proof);
    if (delayed) await gate;
    if (unavailable) return r.fulfill({ status: 503, json: { error: 'Please try again shortly.' } });
    if (expired && proof === 'session') return r.fulfill({ status: 401, json: { error: 'Not verified' } });
    return r.fulfill({ json: proof === 'code' ? { ok: true, request: 'synthetic-request' } : { ok: true, grant: 'synthetic-grant' } });
  });
  await page.route(`**${BASE}/verify`, r => {
    expect(r.request().postDataJSON()).toEqual({ request: 'synthetic-request', code: '123456', purpose: 'enroll' });
    return r.fulfill({ json: { ok: true, grant: 'synthetic-grant' } });
  });
  await page.route(`**${BASE}/passkey/start`, r => {
    calls.starts++;
    return r.fulfill({ json: { ok: true, options: { challenge: 'AQID', user: { id: 'AQID', name: 'Synthetic' }, excludeCredentials: [] } } });
  });
  await page.route(`**${BASE}/passkey/finish`, r => {
    calls.finishes++;
    expect(r.request().postDataJSON().response.response.transports).toEqual(['internal']);
    return r.fulfill({ json: { authenticated: true } });
  });
  await page.route('**/calendar/workspace', r => r.fulfill({ contentType: 'text/html', body: '<html lang="en"><title>Workspace</title><main><h1>Synthetic Workspace</h1></main></html>' }));
  await page.goto(BASE + '/enroll');
  return { calls, release };
}

async function readable(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
}

for (const width of [320, 390, 1440]) {
  test(`fresh WhatsApp proof, cancellation, retry and return at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const { calls } = await enrollment(page);
    expect(calls.proofs).toEqual([]);
    expect(await page.evaluate(() => window.__creates)).toBe(0);
    await expect(page.getByText('sign in first', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send WhatsApp code', exact: true })).toHaveCount(0);
    await readable(page);
    await page.screenshot({ path: info.outputPath(`passkey-ready-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Save a passkey', exact: true }).click();
    await expect(page.locator('#status')).toContainText('No passkey was saved.');
    await expect(page.getByRole('button', { name: 'Save a passkey', exact: true })).toBeFocused();
    expect(calls.proofs).toEqual(['session']); expect(calls.starts).toBe(1);
    await readable(page);
    await page.screenshot({ path: info.outputPath(`passkey-cancel-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Save a passkey', exact: true }).click();
    await expect.poll(() => calls.starts).toBe(2);
    await expect(page.getByRole('button', { name: 'Save a passkey', exact: true })).toBeEnabled();
    expect(calls.proofs).toEqual(['session']);
    await page.getByRole('link', { name: 'Back to Workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/calendar\/workspace$/);
    await page.goto(BASE + '/enroll');
    await page.evaluate(() => { window.__credentialMode = 'success'; });
    await page.getByRole('button', { name: 'Save a passkey', exact: true }).click();
    await expect(page).toHaveURL(/\/calendar\/workspace$/);
    expect(calls.proofs).toEqual(['session', 'session']); expect(calls.finishes).toBe(1);
  });

  test(`expired proof asks before requesting another code at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const { calls } = await enrollment(page, { expired: true });
    await page.getByRole('button', { name: 'Save a passkey', exact: true }).click();
    await expect(page.locator('#status')).toContainText('recent verification is no longer available');
    expect(calls.proofs).toEqual(['session']); expect(calls.starts).toBe(0);
    const send = page.getByRole('button', { name: 'Send WhatsApp code', exact: true });
    await expect(send).toBeFocused(); await readable(page);
    await page.screenshot({ path: info.outputPath(`passkey-verification-needed-${width}.png`), fullPage: true });
    await send.click(); await expect(page.getByLabel('Verification code', { exact: true })).toBeFocused();
    expect(calls.proofs).toEqual(['session', 'code']);
    await page.getByLabel('Verification code', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Verify code', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save a passkey', exact: true })).toBeFocused();
    await page.evaluate(() => { window.__credentialMode = 'success'; });
    await page.getByRole('button', { name: 'Save a passkey', exact: true }).click();
    await expect(page).toHaveURL(/\/calendar\/workspace$/);
    expect(calls.proofs).toEqual(['session', 'code']); expect(calls.finishes).toBe(1);
  });

  test(`Storybook enrollment states use the compact brand layout at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    for (const state of ['own-account-passkey-setup', 'own-account-verification-needed']) {
      await page.goto('/iframe.html?id=workspace-whatsapp-authentication-draft--' + state + '&viewMode=story', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Save a passkey', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to Workspace', exact: true })).toHaveAttribute('href', '/calendar/workspace');
      await readable(page);
      await page.screenshot({ path: info.outputPath(`${state}-${width}.png`), fullPage: true });
    }
  });
}

test('slow and failed proof checks never request a code or open the device prompt', async ({ page }, info) => {
  const { calls, release } = await enrollment(page, { unavailable: true, delayed: true });
  await page.getByRole('button', { name: 'Save a passkey', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Preparing your passkey…');
  await expect(page.getByRole('button', { name: 'Save a passkey', exact: true })).toBeDisabled();
  await page.locator('#start').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true })));
  expect(calls.proofs).toEqual(['session']);
  await page.screenshot({ path: info.outputPath('passkey-loading.png'), fullPage: true });
  release(); await expect(page.locator('#status')).toHaveText('Please try again shortly.');
  await expect(page.getByRole('button', { name: 'Save a passkey', exact: true })).toBeEnabled();
  expect(calls.proofs).toEqual(['session']); expect(calls.starts).toBe(0);
  expect(await page.evaluate(() => window.__creates)).toBe(0);
  await readable(page); await page.screenshot({ path: info.outputPath('passkey-service-error.png'), fullPage: true });
});

test('grant expiry offers explicit verification and large text remains usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { calls } = await enrollment(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await readable(page);
  await page.screenshot({ path: info.outputPath('passkey-large-text.png'), fullPage: true });
  await page.route(`**${BASE}/passkey/start`, r => r.fulfill({ status: 401, json: { error: 'Expired' } }));
  await page.getByRole('button', { name: 'Save a passkey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send WhatsApp code', exact: true })).toBeFocused();
  expect(calls.proofs).toEqual(['session']);
  expect(await page.evaluate(() => window.__creates)).toBe(0);
  await readable(page);
});
