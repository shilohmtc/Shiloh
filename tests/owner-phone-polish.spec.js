// All identities, API responses and credential attempts are synthetic.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { buildClientExperience } = require('../src/services/myShilohExperienceOrchestrator');

async function story(page, id) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' });
  await expect(page.locator(id.startsWith('public-') ? '#storybook-root #main-content' : '#storybook-root [data-app-frame]')).toBeVisible();
  const surface = await page.locator('#storybook-root').innerHTML();
  await page.setContent(surface);
}
async function readable(page, selector) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  // Axe exercises focus; leave the screenshot in its ordinary unfocused state.
  await page.evaluate(() => document.activeElement?.blur());
}

for (const width of [320, 390, 1440]) {
  test(`passkey before details, optional reminder and actionable contact at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await story(page, 'client-crm-detail-sign-in--sign-in');
    const home = page.locator('[data-view="home"]');
    const passkey = home.getByRole('button', { name: 'Sign in with a passkey', exact: true });
    await expect(passkey).toBeVisible();
    expect(await passkey.evaluate(e => e.compareDocumentPosition(document.querySelector('[data-view="home"] [data-client-crm-form]')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    const passkeyBounds = await passkey.boundingBox();
    expect(passkeyBounds.y + passkeyBounds.height).toBeLessThan(600);
    await readable(page, '[data-view="home"]');
    await page.screenshot({ path: testInfo.outputPath(`passkey-${width}.png`), fullPage: true });
    await page.evaluate(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    await page.route('**/my-shiloh/auth/passkeys/**', route => route.fulfill({ status: 503, json: { error: 'Synthetic passkey unavailable. Use your Shiloh details.' } }));
    await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
    await passkey.click();
    await expect(home.locator('[data-auth-status]')).toContainText('Synthetic passkey unavailable');
    await expect(home.getByLabel('First name', { exact: true })).toBeEnabled();
    await expect(passkey).toBeEnabled();
    await story(page, 'client-my-shiloh-pwa--first-sign-in-notification-setup');
    const setup = page.locator('[data-client-setup]');
    await expect(setup.getByRole('heading', { name: 'Appointment reminders' })).toBeVisible();
    await expect(setup.getByRole('button', { name: 'Not now', exact: true })).toBeVisible();
    await readable(page, '[data-view="home"]');
    await page.screenshot({ path: testInfo.outputPath(`reminders-${width}.png`), fullPage: true });
    await story(page, 'public-website-production-pages--contact');
    const contact = page.locator('.contact-panel');
    await expect(contact).toContainText('066 239 9138');
    await expect(contact.getByRole('link', { name: 'Call Reception', exact: true })).toHaveAttribute('href', 'tel:+27662399138');
    await expect(contact.getByRole('link', { name: 'WhatsApp Reception', exact: true })).toHaveAttribute('href', 'https://wa.me/27662399138');
    await expect(contact.getByRole('link', { name: 'info@shilohmtc.co.za', exact: true })).toHaveAttribute('href', 'mailto:info@shilohmtc.co.za');
    await readable(page, 'main');
    await contact.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`contact-${width}.png`), fullPage: true });
  });

  test(`assistant reads as paragraphs and lists without executing markup at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/my-shiloh/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/my-shiloh/api/experience', route => route.fulfill({ json: buildClientExperience({ client: { name: 'Synthetic' }, forms: [], rescheduleHistory: [] }) }));
    const reply = '## Treatment options\n\n**Massage:** Here are two options from this synthetic catalogue.\n\n- **Full Body Swedish** — 60 min · R720\n- **Hot Stone Massage** — 75 min · R850\n\nWhich would you like to explore?';
    let requests = 0;
    await page.route('**/my-shiloh/api/shiloh/message', route => {
      requests++;
      return route.fulfill({ json: { reply: requests === 1 ? reply : '**Note:** <img src=x onerror="window.syntheticExecuted=true">\n\n1. Review your booking\n2. Confirm only when ready' } });
    });
    await story(page, 'client-my-shiloh-pwa--authenticated-assistant-composer');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      location.hash = '#shiloh';
    });
    await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
    const input = page.getByRole('textbox', { name: 'Message Shiloh', exact: true });
    await input.fill('What massage options are there?');
    await page.locator('[data-shiloh-chat-send]').click();
    const bubble = page.locator('.chat-bubble--shiloh').last();
    await expect(bubble).toContainText('Which would you like to explore?');
    await expect(bubble.locator('strong').first()).toHaveText('Massage:');
    await expect(bubble.locator('ul li')).toHaveCount(2);
    await expect(bubble).not.toContainText('**');
    await expect(bubble).not.toContainText('##');
    await readable(page, '[data-view="shiloh"]');
    await page.screenshot({ path: testInfo.outputPath(`assistant-${width}.png`), fullPage: true });
    await input.fill('**Keep my message literal**');
    await page.locator('[data-shiloh-chat-send]').click();
    await expect(bubble.locator('ol li')).toHaveCount(2);
    await expect(bubble.locator('img,script,a')).toHaveCount(0);
    await expect(bubble).toContainText('<img src=x');
    expect(await page.evaluate(() => window.syntheticExecuted)).toBeUndefined();
    await expect(page.locator('.chat-bubble--user').last()).toHaveText('**Keep my message literal**');
    expect(requests).toBe(2);
  });
}
