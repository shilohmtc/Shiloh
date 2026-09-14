const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test('Couples booking supports separate canonical treatments and discretionary discount on Phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--couples-booking-treatments-and-discount&viewMode=story', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: 'Couples booking' })).toBeVisible();
  await expect(page.locator('[data-guest]')).toHaveCount(2);
  await page.route('**/calendar/book/couples/client-search', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ clients: [{ id: '91', displayName: 'Alex Adams', name: 'Alex Adams', mobile: '+27821234567', dateOfBirth: '1990-01-02', gender: 'female', profileStatus: 'registered', contactHint: 'ending in 4567' }] }),
  }));
  await page.locator('#guest-1-search').fill('Alex');
  await page.locator('[data-search-guest="1"]').click();
  await page.locator('[data-client-results="1"] .client-result').click();
  await expect(page.locator('[data-client-id="1"]')).toHaveValue('91');
  await expect(page.locator('[data-dob="1"]')).toHaveValue('1990-01-02');
  await expect(page.locator('[data-dob="2"]')).not.toHaveAttribute('required', '');
  await expect(page.locator('[data-gender="2"]')).not.toHaveAttribute('required', '');

  const values = [
    ['Alex Adams', '082 123 4567'],
    ['Sam Adams', '082 987 6543'],
  ];
  for (let index = 1; index <= 2; index += 1) {
    await page.locator('[data-name="' + index + '"]').fill(values[index - 1][0]);
    await page.locator('[data-mobile="' + index + '"]').fill(values[index - 1][1]);
  }
  await expect(page.locator('[data-dob="2"]')).toHaveValue('');
  await expect(page.locator('[data-gender="2"]')).toHaveValue('');
  await page.locator('[data-service="1"]').selectOption('81');
  await expect(page.locator('[data-staff="1"] option')).toHaveText(['Choose', 'Abigail', 'Christel']);
  await page.locator('[data-staff="1"]').selectOption('11');
  await page.locator('[data-service="2"]').selectOption('82');
  await expect(page.locator('[data-staff="2"] option')).toHaveText(['Choose', 'Christel', 'Marietjie']);
  await page.locator('[data-staff="2"]').selectOption('13');

  await page.locator('[data-discount-type]').selectOption('percent');
  await page.locator('[data-discount-value]').fill('10');
  await page.locator('[data-discount-reason]').fill('Returning clients');
  await page.locator('[data-discount-reason]').blur();
  await expect(page.locator('[data-discount-preview]')).toContainText('Canonical subtotal');
  await expect(page.locator('[data-discount-preview]')).toContainText('Estimated total');

  await page.locator('[data-mobile="2"]').fill('082 123 4567');
  await page.locator('[data-review-couples]').click();
  await expect(page.locator('[data-couples-status]')).toContainText('different mobile numbers');
  await page.locator('[data-mobile="2"]').fill('082 987 6543');
  await page.route('**/calendar/staff-auth/csrf', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ csrfToken: 'storybook-csrf' }),
  }));
  await page.route('**/calendar/book/couples/prepare', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      review: {
        guests: [{ name: 'Alex Adams' }, { name: 'Sam Adams' }],
        assignments: [
          { service: { name: 'Quick Relief: Back & Neck', price: 520 }, practitioner: { displayName: 'Abigail' } },
          { service: { name: 'Full Body Swedish', price: 720 }, practitioner: { displayName: 'Marietjie' } },
        ],
        startsAt: '2026-09-14T08:30:00.000Z',
        pricing: { subtotal: 1240, discountAmount: 124, discountReason: 'Returning clients', total: 1116 },
      },
    }),
  }));
  await page.locator('[data-review-couples]').click();
  await expect(page.locator('[data-couples-status]')).toContainText('Review ready');
  await expect(page.locator('[data-couples-review]')).toBeVisible();

  const metrics = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    shortTargets: [...document.querySelectorAll('button,input,select,textarea,a')]
      .filter(node => node.getClientRects().length)
      .filter(node => node.getBoundingClientRect().height < 44)
      .map(node => node.textContent.trim() || node.getAttribute('data-name') || node.id),
    overflowing: [...document.querySelectorAll('input,select,textarea,button')]
      .filter(node => node.getClientRects().length)
      .filter(node => node.getBoundingClientRect().right > innerWidth + 1)
      .map(node => node.outerHTML.slice(0, 80)),
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.shortTargets).toEqual([]);
  expect(metrics.overflowing).toEqual([]);
  const accessibility = await new AxeBuilder({ page }).include('.workspace-surface-story').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('couples-booking-pricing-phone.png'), fullPage: true });
});

test('Couples booking remains scannable with separate treatments on Desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--couples-booking-treatments-and-discount&viewMode=story', { waitUntil: 'networkidle' });
  const cards = page.locator('[data-guest]');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('[data-service]')).toHaveCount(2);
  await expect(page.locator('[data-discount-controls]')).toBeVisible();
  const geometry = await cards.evaluateAll(nodes => ({
    firstTop: nodes[0].getBoundingClientRect().top,
    secondTop: nodes[1].getBoundingClientRect().top,
    firstRight: nodes[0].getBoundingClientRect().right,
    secondLeft: nodes[1].getBoundingClientRect().left,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }));
  expect(Math.abs(geometry.firstTop - geometry.secondTop)).toBeLessThanOrEqual(1);
  expect(geometry.firstRight).toBeLessThan(geometry.secondLeft);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  await page.screenshot({ path: testInfo.outputPath('couples-booking-pricing-desktop.png'), fullPage: true });
});

test('Group booking adds multiple guests and reviews an optional-note discount on Phone', async ({ page }, testInfo) => {
  const guests = [
    ['Alex Adams', '082 111 1111', '81', '11'],
    ['Sam Adams', '082 222 2222', '84', '12'],
    ['Taylor Adams', '082 333 3333', '82', '13'],
  ];
  await page.addInitScript(({ guestNames }) => {
    const nativeFetch = window.fetch.bind(window);
    const jsonResponse = body => ({ ok: true, status: 200, json: async () => body });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
      if (url.pathname === '/calendar/staff-auth/csrf') {
        return jsonResponse({ csrfToken: 'storybook-csrf' });
      }
      if (url.pathname === '/calendar/book/group/prepare') {
        return jsonResponse({ review: {
          guests: guestNames.map(name => ({ name })),
          assignments: [
            { startsAt: '2026-09-14T08:30:00.000Z', service: { name: 'Quick Relief: Back & Neck', price: 520 }, practitioner: { displayName: 'Abigail' } },
            { startsAt: '2026-09-14T08:30:00.000Z', service: { name: 'Hot Stone Massage', price: 850 }, practitioner: { displayName: 'Christel' } },
            { startsAt: '2026-09-14T08:30:00.000Z', service: { name: 'Full Body Swedish', price: 720 }, practitioner: { displayName: 'Marietjie' } },
          ],
          startsAt: '2026-09-14T08:30:00.000Z',
          pricing: { subtotal: 2090, discountAmount: 209, discountReason: null, total: 1881 },
        } });
      }
      return nativeFetch(input, init);
    };
  }, { guestNames: guests.map(item => item[0]) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--group-booking-multiple-guests-and-discount&viewMode=story', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Group booking' })).toBeVisible();
  await expect(page.locator('[data-guest]')).toHaveCount(3);
  await page.locator('[data-add-guest]').click();
  await expect(page.locator('[data-guest]')).toHaveCount(4);
  await page.locator('[data-guest="4"] [data-remove-guest]').click();
  await expect(page.locator('[data-guest]')).toHaveCount(3);

  for (let index = 0; index < guests.length; index += 1) {
    const card = page.locator('[data-guest]').nth(index);
    await card.locator('[data-name]').fill(guests[index][0]);
    await card.locator('[data-mobile]').fill(guests[index][1]);
    await card.locator('[data-service]').selectOption(guests[index][2]);
    await card.locator('[data-staff]').selectOption(guests[index][3]);
    await expect(card.locator('[data-dob]')).not.toHaveAttribute('required', '');
    await expect(card.locator('[data-gender]')).not.toHaveAttribute('required', '');
  }
  await page.locator('[data-discount-type]').selectOption('percent');
  await page.locator('[data-discount-value]').fill('10');
  await expect(page.locator('[data-discount-reason]')).toHaveValue('');
  await page.locator('[data-review-group]').click();
  await expect(page.locator('[data-group-status]')).toContainText('Review ready');
  await expect(page.locator('[data-group-review]')).toBeVisible();
  await expect(page.locator('[data-review-rows]')).not.toContainText('null');

  const metrics = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    shortTargets: [...document.querySelectorAll('button,input,select,textarea,a')].filter(node => node.getClientRects().length).filter(node => node.getBoundingClientRect().height < 44).map(node => node.textContent.trim() || node.getAttribute('aria-label')),
    overflowing: [...document.querySelectorAll('input,select,textarea,button')].filter(node => node.getClientRects().length).filter(node => node.getBoundingClientRect().right > innerWidth + 1).map(node => node.outerHTML.slice(0, 80)),
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.shortTargets).toEqual([]);
  expect(metrics.overflowing).toEqual([]);
  const accessibility = await new AxeBuilder({ page }).include('.workspace-surface-story').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('group-booking-phone.png'), fullPage: true });
});

test('Group booking remains scannable with three guest cards on Desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--group-booking-multiple-guests-and-discount&viewMode=story', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-guest]')).toHaveCount(3);
  await expect(page.locator('[data-service]')).toHaveCount(3);
  await expect(page.locator('[data-add-guest]')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.workspace-surface-story').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('group-booking-desktop.png'), fullPage: true });
});

test('Couples discount controls do not render without canonical pricing authority', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--couples-booking-without-discount-authority&viewMode=story', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-discount-controls]')).toHaveCount(0);
  await expect(page.locator('[data-service]')).toHaveCount(2);
});

test('linked Couples appointments share one distinctive labelled Calendar treatment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=calendar-reference-implementation--couples-linked-calendar&viewMode=story', { waitUntil: 'networkidle' });
  const linked = page.locator('.event-card.event-couples');
  await expect(linked).toHaveCount(2);
  await expect(linked.locator('.kind-pill')).toHaveText(['Couples', 'Couples']);
  const treatment = await linked.evaluateAll(nodes => nodes.map(node => ({
    border: getComputedStyle(node).borderLeftColor,
    background: getComputedStyle(node).backgroundColor,
  })));
  expect(treatment[0]).toEqual(treatment[1]);
});

test('phone Create booking restores canonical Week context and fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--create-booking&viewMode=story', { waitUntil: 'networkidle' });

  const surface = page.locator('.workspace-surface-story');
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-back-calendar]')).toHaveAttribute(
    'href',
    '/calendar/read-only?view=week&date=2026-09-14&staff=all',
  );

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('.panel');
    const panelRect = panel.getBoundingClientRect();
    const visibleControls = [...panel.querySelectorAll('button, input, select')]
      .filter((node) => !node.hidden && node.getClientRects().length > 0);
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      shortTargets: [...document.querySelectorAll('[data-back-calendar], button, input, select')]
        .filter((node) => !node.hidden && node.getClientRects().length > 0)
        .map((node) => ({ label: node.textContent || node.getAttribute('aria-label') || node.id, height: node.getBoundingClientRect().height }))
        .filter((target) => target.height < 44),
      overflowingControls: visibleControls
        .map((node) => ({ id: node.id || node.textContent.trim(), rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1)
        .map(({ id }) => id),
      dateRight: document.querySelector('#booking-date').getBoundingClientRect().right,
      timeRight: document.querySelector('#booking-time').getBoundingClientRect().right,
      panelRight: panelRect.right,
      reviewPosition: getComputedStyle(document.querySelector('.review-action')).position,
      dateAppearance: getComputedStyle(document.querySelector('#booking-date')).webkitAppearance,
      timeAppearance: getComputedStyle(document.querySelector('#booking-time')).webkitAppearance,
    };
  });
  expect(metrics.documentWidth, 'Create booking must not overflow the Phone viewport').toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.shortTargets, 'Phone controls must retain 44px touch targets').toEqual([]);
  expect(metrics.overflowingControls, 'Phone booking controls must remain inside the booking panel').toEqual([]);
  expect(metrics.dateRight).toBeLessThanOrEqual(metrics.panelRight);
  expect(metrics.timeRight).toBeLessThanOrEqual(metrics.panelRight);
  expect(metrics.reviewPosition).toBe('sticky');
  expect(metrics.dateAppearance).toBe('none');
  expect(metrics.timeAppearance).toBe('none');

  await page.route('**/calendar/book/client-search', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ambiguous: true,
      clients: [
        { id: 1, displayName: 'Alex Adams', contactHint: '••41', profileStatus: 'registered' },
        { id: 2, displayName: 'Alex Andrews', contactHint: '••92', profileStatus: 'registered' },
      ],
    }),
  }));
  await page.locator('#client-search').fill('Alex');
  await page.locator('[data-client-search]').click();
  await expect(page.locator('.client-result')).toHaveCount(2);
  await expect(page.locator('[data-booking-status]')).toBeHidden();

  const accessibility = await new AxeBuilder({ page })
    .include('.workspace-surface-story')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(serious, `Serious accessibility violations in phone Create booking: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
});

test('receptionist chooses practitioner first and sees only mapped treatments on Phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--receptionist-practitioner-first-booking&viewMode=story', { waitUntil: 'networkidle' });

  const picker = page.locator('[data-practitioner-picker]');
  const treatment = page.locator('#service-select');
  await expect(picker).toBeVisible();
  await expect(treatment).toBeDisabled();

  await picker.getByRole('button', { name: /Marietjie/ }).click();
  await expect(treatment.locator('option')).toHaveText([
    'Choose treatment',
    'Full Body Swedish',
    'Medi-Heel Pedicure & Foot Massage',
  ]);
  await expect(treatment.locator('option', { hasText: 'Quick Relief' })).toHaveCount(0);

  await treatment.selectOption('82');
  await picker.getByRole('button', { name: /Christel/ }).click();
  await expect(treatment).toHaveValue('82');

  await picker.getByRole('button', { name: /Marietjie/ }).click();
  await treatment.selectOption('83');
  await picker.getByRole('button', { name: /Abigail/ }).click();
  await expect(treatment).toHaveValue('');
  await expect(page.locator('[data-booking-status]')).toContainText('previous treatment is not offered');

  await picker.getByRole('button', { name: /Any available/ }).click();
  await expect(treatment.locator('option')).toHaveCount(5);
  await treatment.selectOption('81');
  await expect(page.locator('[data-eligible-practitioner-field]')).toBeVisible();
  await expect(page.locator('#staff-select').locator('option')).toHaveText(['Choose practitioner', 'Abigail', 'Christel']);

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    shortChoices: [...document.querySelectorAll('[data-practitioner-choice]')]
      .filter((button) => button.getBoundingClientRect().height < 44)
      .map((button) => button.textContent.trim()),
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.shortChoices).toEqual([]);

  const accessibility = await new AxeBuilder({ page })
    .include('.workspace-surface-story')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(serious, `Serious accessibility violations in receptionist booking: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
});

test('normal business admin account receives the same practitioner-first Phone booking flow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--normal-admin-practitioner-first-booking&viewMode=story', { waitUntil: 'networkidle' });

  const picker = page.locator('[data-practitioner-picker]');
  const treatment = page.locator('#service-select');
  await expect(picker).toBeVisible();
  await expect(treatment).toBeDisabled();

  await picker.getByRole('button', { name: /Marietjie/ }).click();
  await expect(treatment.locator('option')).toHaveText([
    'Choose treatment',
    'Full Body Swedish',
    'Medi-Heel Pedicure & Foot Massage',
  ]);
  await expect(treatment.locator('option', { hasText: 'Quick Relief' })).toHaveCount(0);

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    shortChoices: [...document.querySelectorAll('[data-practitioner-choice]')]
      .filter((button) => button.getBoundingClientRect().height < 44)
      .map((button) => button.textContent.trim()),
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.shortChoices).toEqual([]);

  const accessibility = await new AxeBuilder({ page })
    .include('.workspace-surface-story')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(serious, `Serious accessibility violations in normal admin booking: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
});

test('phone passkey cards show South African date and time without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 310, height: 659 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--phone-passkey-devices&viewMode=story', { waitUntil: 'networkidle' });

  const surface = page.locator('.workspace-surface-story');
  await expect(surface).toBeVisible();
  await expect(surface.locator('.credential').first()).toContainText('Added 13/09/2026 17:05');
  await expect(surface.locator('.credential').first()).toContainText('last used 13/09/2026 17:42');
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    cards: [...document.querySelectorAll('.credential')].map(node => node.getBoundingClientRect().right),
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.cards.every(right => right <= widths.viewport)).toBe(true);
});

test('device management confirmations use accessible Shiloh dialogs on Desktop and Phone', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=workspace-production-surfaces--device-management-dialogs&viewMode=story', { waitUntil: 'networkidle' });

    const surface = page.locator('.workspace-surface-story');
    const dialog = page.locator('[data-device-dialog]');
    const remove = surface.getByRole('button', { name: 'Remove' }).first();
    await remove.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /Remove Jean-Pierre\u2019s Windows PC/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Remove device' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.screenshot({ path: `artifacts/device-dialog-${viewport.width <= 560 ? 'phone' : 'desktop'}.png` });

    const metrics = await dialog.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        left: rect.left,
        right: rect.right,
        bottomGap: window.innerHeight - rect.bottom,
        shortButtons: [...node.querySelectorAll('button')]
          .filter((button) => button.getBoundingClientRect().height < 44)
          .map((button) => button.textContent.trim()),
      };
    });
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.shortButtons).toEqual([]);
    if (viewport.width <= 560) expect(metrics.bottomGap).toBeLessThanOrEqual(1);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-device-dialog]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in device dialog: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(remove).toBeFocused();

    await surface.getByRole('button', { name: 'Rename' }).first().click();
    await expect(dialog.getByRole('heading', { name: 'Rename this device' })).toBeVisible();
    const name = dialog.getByLabel('Device name');
    await expect(name).toBeFocused();
    await name.fill('');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a name for this device.');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await surface.getByRole('button', { name: 'Replace a lost device' }).click();
    await expect(dialog.getByRole('heading', { name: 'Replace a lost device?' })).toBeVisible();
    await expect(dialog).toContainText('Only after that succeeds');
    await page.keyboard.press('Escape');
  }
});

test('PWA icon uses balanced optical proportions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--pwa-icon-optical-scale&viewMode=story', { waitUntil: 'networkidle' });

  const proportions = await page.locator('.pwa-icon').evaluate((svg) => {
    const inner = svg.querySelectorAll('rect')[1];
    const circle = svg.querySelector('circle');
    return {
      innerRatio: Number(inner.getAttribute('width')) / 192,
      markRatio: Number(circle.getAttribute('r')) * 2 / 192,
    };
  });
  expect(proportions.innerRatio).toBeGreaterThanOrEqual(0.87);
  expect(proportions.markRatio).toBeGreaterThanOrEqual(0.39);
});

test('iPhone install invitation opens an accessible three-step guide without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--ios-install-guidance&viewMode=story', { waitUntil: 'networkidle' });

  const host = page.locator('[data-shiloh-ios-install]');
  const opener = host.getByRole('button', { name: 'Show me how' });
  const dialog = host.getByRole('dialog', { name: 'Install Shiloh on iPhone' });
  await expect(host).toBeVisible();
  await expect(dialog).toBeHidden();
  await opener.click();
  await expect(dialog).toBeVisible();
  for (const step of ['Tap Share', 'Choose Add to Home Screen', 'Tap Add']) {
    await expect(dialog.getByText(step, { exact: true })).toBeVisible();
  }

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    shortButtons: [...document.querySelectorAll('[data-shiloh-ios-install] button')]
      .filter((button) => button.getClientRects().length > 0 && button.getBoundingClientRect().height < 44)
      .map((button) => button.textContent.trim() || button.getAttribute('aria-label')),
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.shortButtons).toEqual([]);

  const accessibility = await new AxeBuilder({ page })
    .include('.ios-install-story')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(serious, `Serious accessibility violations in iPhone install guide: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

  await dialog.getByRole('button', { name: 'Close installation guide' }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await host.getByRole('button', { name: 'Not now' }).click();
  await expect(host).toHaveCount(0);
});

test('Desktop Book menu exposes every authorized booking and availability action', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/iframe.html?id=calendar-reference-implementation--desktop-complete-new-menu&viewMode=story', { waitUntil: 'networkidle' });

  const menu = page.locator('[data-storybook-desktop-new-menu]');
  await page.getByLabel('Book or add calendar item').click();
  await expect(menu).toBeVisible();
  for (const label of ['New appointment', 'Couples massage', 'Record past appointment', 'Block time', 'Leave']) {
    await expect(menu.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(menu.getByRole('link', { name: /Book a Couples Massage/ })).toHaveAttribute('href', '/calendar/book/couples?date=2026-09-14');
  await expect(menu.getByRole('separator', { name: 'Availability controls' })).toBeVisible();
  const metrics = await menu.locator('a,button').evaluateAll((nodes) => ({
    labels: nodes.map(node => node.textContent.trim()),
    shortTargets: nodes.filter(node => node.getBoundingClientRect().height < 44).map(node => node.textContent.trim()),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.labels).toEqual(['New appointment', 'Couples massage 2 guests', 'Record past appointment', 'Block time', 'Leave']);
  expect(metrics.shortTargets).toEqual([]);
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);

  const accessibility = await new AxeBuilder({ page })
    .include('.calendar-reference')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(serious, `Serious accessibility violations in desktop Book menu: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
});

test('Month exposes full-cell navigation, appointment details and South African holidays on phone and desktop', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=calendar-reference-implementation--month-appointments-and-south-african-holiday&viewMode=story', { waitUntil: 'networkidle' });

    const surface = page.locator('.calendar-reference');
    await expect(surface).toBeVisible();
    const emptyDay = surface.locator('.month-day[data-date="2026-09-15"]');
    const hitTarget = emptyDay.locator('.month-day-link');
    await expect(hitTarget).toHaveAttribute('href', /view=week&date=2026-09-15/);

    const geometry = await emptyDay.evaluate((day) => {
      const link = day.querySelector('.month-day-link');
      const cell = day.getBoundingClientRect();
      const target = link.getBoundingClientRect();
      const hit = document.elementFromPoint(cell.left + cell.width / 2, cell.bottom - 6);
      return {
        cell: { left: cell.left, top: cell.top, right: cell.right, bottom: cell.bottom },
        target: { left: target.left, top: target.top, right: target.right, bottom: target.bottom },
        hitHref: hit && hit.closest('a')?.getAttribute('href'),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(Math.abs(geometry.target.left - geometry.cell.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.target.right - geometry.cell.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.target.bottom - geometry.cell.bottom)).toBeLessThanOrEqual(1);
    expect(geometry.hitHref).toContain('view=week&date=2026-09-15');
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    const holiday = surface.locator('.month-day[data-date="2026-09-24"]');
    await expect(holiday).toHaveAttribute('data-public-holiday', 'Heritage Day');
    await expect(holiday.locator('.month-holiday')).toContainText('Heritage Day');
    await expect(holiday.locator('.month-day-link')).toHaveAttribute('aria-label', /South African public holiday: Heritage Day/);
    await expect(holiday.locator('.month-event .event-card').first()).toBeVisible();
    await expect(holiday.locator('.month-event .event-time-start').first()).toContainText('10:00');
    await expect(holiday.locator('.month-event .event-card h4').first()).toContainText('Month view client');
  }
});

for (const viewport of [{ width: 390, height: 640 }, { width: 1440, height: 1000 }]) {
  test(`appointment sections expose complete forms at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=workspace-production-surfaces--compact-appointment-editor&viewMode=story');
    for (const key of ['notes', 'treatment', 'timing', 'practitioner', 'danger']) {
      const section = page.locator(`[data-appointment-editor-section="${key}"]`);
      await section.locator('[data-appointment-editor-toggle]').click();
      const body = section.locator('[data-appointment-editor-body]');
      await expect(body).toBeVisible();
      const fits = await section.evaluate(node => {
        const body = node.querySelector('[data-appointment-editor-body]');
        return body.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom + 1;
      });
      expect(fits, 'Expanded form must not be clipped by its section').toBe(true);
      const action = body.getByRole('button').last();
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport();
      await expect(page.locator('[data-appointment-editor-toggle][aria-expanded="true"]')).toHaveCount(1);
    }
  });
}

const states = [
  {
    name: 'calendar-desktop',
    storyId: 'calendar-reference-implementation--desktop-toolbar-and-identity',
    viewport: { width: 1280, height: 900 },
  },
  {
    name: 'calendar-phone',
    storyId: 'calendar-reference-implementation--phone-touch-toolbar',
    viewport: { width: 390, height: 844 },
  },
  {
    name: 'calendar-colour-treatment-desktop',
    storyId: 'calendar-reference-implementation--colour-and-treatment-language',
    viewport: { width: 1280, height: 1000 },
  },
  {
    name: 'calendar-colour-treatment-phone',
    storyId: 'calendar-reference-implementation--colour-and-treatment-language-phone',
    viewport: { width: 390, height: 1100 },
  },
  ...[
    ['dashboard', 'dashboard-operational', '.workspace-surface-story'],
    ['client-history', 'client-appointment-history', '.workspace-surface-story'],
    ['messages', 'messages-attention', '.workspace-surface-story'],
    ['appointment-editor', 'compact-appointment-editor', '.appointment-editor-story'],
  ].flatMap(([name, story, selector]) => [
    { name: `${name}-desktop`, storyId: `workspace-production-surfaces--${story}`, selector, viewport: { width: 1440, height: 1000 } },
    { name: `${name}-phone`, storyId: `workspace-production-surfaces--${story}`, selector, viewport: { width: 390, height: 844 } },
  ]),
];

for (const state of states) {
  test(`${state.name} visual and accessibility baseline`, async ({ page }) => {
    await page.setViewportSize(state.viewport);
    await page.goto(`/iframe.html?id=${state.storyId}&viewMode=story`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });

    const reference = page.locator(state.selector || '.calendar-reference');
    await expect(reference).toBeVisible();

    const accessibility = await new AxeBuilder({ page })
      .include(state.selector || '.calendar-reference')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in ${state.name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await expect(reference).toHaveScreenshot(`${state.name}.png`, {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.001,
      scale: 'css',
    });
  });
}


const publicWebsiteStories = [
  ['home', 'home'],
  ['treatments', 'treatments'],
  ['about', 'about'],
  ['contact', 'contact'],
  ['privacy', 'privacy'],
  ['book', 'book'],
];

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 1000 },
]) {
  test(`public website production pages remain accessible and responsive on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const [name, story] of publicWebsiteStories) {
      await page.goto(
        `/iframe.html?id=public-website-production-pages--${story}&viewMode=story`,
        { waitUntil: 'networkidle' },
      );

      const surface = page.locator('[data-public-site-story]');
      await expect(surface).toBeVisible();
      await expect(surface.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(surface.locator('a[href="/book"]').first()).toBeAttached();

      const geometry = await surface.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

      const accessibility = await new AxeBuilder({ page })
        .include('[data-public-site-story]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = accessibility.violations.filter((violation) =>
        ['serious', 'critical'].includes(violation.impact),
      );
      expect(
        serious,
        `Serious accessibility violations in public ${name} on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`,
      ).toEqual([]);

      await page.screenshot({
        path: testInfo.outputPath(`public-${name}-${viewport.name}.png`),
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      });
    }
  });
}

test('public website Storybook exposes catalogue and WhatsApp unavailable states', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(
    '/iframe.html?id=public-website-production-pages--catalogue-unavailable&viewMode=story',
    { waitUntil: 'networkidle' },
  );
  await expect(page.getByRole('heading', { name: 'Treatments are temporarily unavailable' })).toBeVisible();

  await page.goto(
    '/iframe.html?id=public-website-production-pages--whats-app-unavailable&viewMode=story',
    { waitUntil: 'networkidle' },
  );
  await expect(page.getByRole('status')).toHaveText('WhatsApp booking is temporarily unavailable');
  await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
});
