const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test('Workspace vouchers stay contained and selectable on Phone and Desktop', async ({ page }, testInfo) => {
  await page.route('**/calendar/vouchers/walk-in', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'issued',
      voucher: { voucher_code:'SV-WALKIN12345' },
      voucherPath: '/gift-vouchers/storybook-walk-in-voucher-key',
      whatsappDelivery: { sent:false, reason:'not_requested' },
    }),
  }));
  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    try {
      await page.goto('/iframe.html?id=shiloh-gift-vouchers--workspace-balances&viewMode=story', { waitUntil:'domcontentloaded' });
    } catch (error) {
      if (!String(error?.message || error).includes('ERR_ABORTED')) throw error;
    }
    await expect(page.locator('.voucher-shell')).toBeVisible();
    await page.addScriptTag({ url:'/workspace/gift-vouchers.js' });

    const issued = page.getByRole('heading', { name:'Issued vouchers' });
    const redeem = page.getByRole('heading', { name:'Redeem a voucher' });
    await expect(issued).toBeVisible();
    await expect(redeem).toBeVisible();
    await expect(page.getByText(/Naledi · Online · Linked to My Shiloh/)).toBeVisible();
    await expect(page.getByText(/Chenique Botha · Walk-in · Card · Stock BOOK-0042 · Waiting for recipient/)).toBeVisible();
    expect(await issued.evaluate((node) => node.getBoundingClientRect().top)).toBeLessThan(await redeem.evaluate((node) => node.getBoundingClientRect().top));

    await page.getByRole('button', { name:/SV-4A7F31B920CC.*Naledi.*Use this voucher/ }).click();
    await expect(page.locator('[data-redeem-form]').getByLabel('Voucher code')).toHaveValue('SV-4A7F31B920CC');
    await expect(page.getByLabel('Amount to redeem')).toBeFocused();
    await expect(page.getByLabel('Amount to redeem')).toHaveAttribute('max', '400.00');
    await expect(page.getByText('SV-4A7F31B920CC selected. Enter the amount to redeem below.')).toBeVisible();

    await expect(page.getByText('This links the voucher to the recipient’s My Shiloh profile. Use 082…; +27 is converted automatically.')).toBeVisible();
    await page.getByLabel('Purchaser’s name').fill('Tinkie');
    await page.getByLabel('Recipient’s name and surname', { exact:true }).fill('Evelyn Example');
    await page.getByLabel('Recipient’s mobile number', { exact:true }).fill('082 123 4567');
    await page.getByLabel('From').fill('Tinkie');
    await page.getByLabel('Voucher value').fill('900');
    await page.getByLabel('Payment received by').selectOption('card_machine');
    await page.getByLabel('I confirm that Shiloh has received the full in-person payment shown above.').check();
    await page.getByRole('button', { name:'Issue preprinted voucher' }).click();
    await expect(page.getByText('SV-WALKIN12345')).toBeVisible();
    await expect(page.getByText('Write this code clearly on the physical voucher. It is now active in Shiloh.')).toBeVisible();
    await expect(page.getByText('No WhatsApp copy was requested.')).toBeVisible();

    const metrics = await page.evaluate(() => ({
      viewport:innerWidth,
      document:document.documentElement.scrollWidth,
      tableOverflow:getComputedStyle(document.querySelector('[data-issued-vouchers] table')).overflowX,
      short:[...document.querySelectorAll('.voucher-shell button,.voucher-shell input,.voucher-shell select,.voucher-shell a')].filter((node) => {
        if (!node.getClientRects().length) return false;
        const target = ['checkbox','radio'].includes(node.type) ? node.closest('label') : node;
        return !target || target.getBoundingClientRect().height < 44;
      }).length,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.tableOverflow).not.toBe('auto');
    expect(metrics.short).toBe(0);

    const accessibility = await new AxeBuilder({ page }).include('.voucher-shell').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);
    await page.screenshot({ path:testInfo.outputPath(`workspace-vouchers-${viewport.name}.png`), fullPage:true, animations:'disabled' });
  }
});

test('Voucher recipient recovery is explicit and accessible on Phone and Desktop', async ({ page }, testInfo) => {
  await page.route('**/calendar/vouchers/recipient', async (route) => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ status:'recipient_changed', voucherCode:'SV-A2F8CBC24FCA', linkStatus:'waiting' }),
  }));
  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=shiloh-gift-vouchers--workspace-balances&viewMode=story', { waitUntil:'networkidle' });
    await page.addScriptTag({ url:'/workspace/gift-vouchers.js' });
    await page.getByRole('button', { name:'Change recipient' }).nth(1).click();
    const form = page.locator('[data-recipient-form]');
    await expect(form).toBeVisible();
    await expect(form.getByLabel('Voucher code', { exact:true })).toHaveValue('SV-A2F8CBC24FCA');
    await expect(form.getByLabel('New recipient’s name and surname')).toHaveValue('Chenique Botha');
    await expect(form.getByLabel('New recipient’s mobile number')).toHaveValue('0837654321');
    await form.getByLabel('New recipient’s name and surname').fill('Evelyn Example');
    await form.getByLabel('New recipient’s mobile number').fill('082 123 4567');
    await page.getByLabel('I confirm that I want to change who this voucher is linked to.').check();
    const accessibility = await new AxeBuilder({ page }).include('.recipient-card').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);
    const metrics = await page.evaluate(() => ({ viewport:innerWidth, document:document.documentElement.scrollWidth }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    await page.screenshot({ path:testInfo.outputPath(`voucher-recipient-recovery-${viewport.name}.png`), fullPage:true, animations:'disabled' });
    const requestPromise = page.waitForRequest((request) => request.url().includes('/calendar/vouchers/recipient') && request.method() === 'POST');
    const reloadPromise = page.waitForNavigation({ waitUntil:'networkidle' });
    await page.getByRole('button', { name:'Update recipient' }).click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toEqual({
      voucherCode:'SV-A2F8CBC24FCA',
      recipientName:'Evelyn Example',
      recipientMobile:'082 123 4567',
      confirmed:true,
    });
    await reloadPromise;
  }
});

test('My Shiloh voucher wallet is clear and accessible on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=shiloh-gift-vouchers--recipient-linked&viewMode=story', { waitUntil:'networkidle' });
    await page.addScriptTag({ url:'/my-shiloh/assets/gift-vouchers.js' });

    await expect(page.getByRole('heading', { name:'Your voucher wallet', exact:true })).toBeVisible();
    await expect(page.getByText('Total available')).toBeVisible();
    await expect(page.getByText(/R\s*690[,.]00/).first()).toBeVisible();
    await expect(page.getByText('SV-A1B2C3D4E5F6')).toBeVisible();
    await expect(page.getByText('22 November 2026')).toBeVisible();
    await expect(page.getByText('From Tinkie')).toBeVisible();
    const walletCards = page.locator('.wallet-card');
    await expect(walletCards.first().getByText('Ready to use', { exact:true })).toBeVisible();
    await expect(walletCards.last().getByText('Used', { exact:true })).toBeVisible();
    await expect(page.getByRole('link', { name:'Show voucher at reception' })).toHaveAttribute('href', '/gift-vouchers/storybook-recipient-key');
    await expect(page.getByRole('link', { name:'Book a treatment' })).toHaveAttribute('href', '/book');

    const mobile = page.getByLabel('Recipient’s mobile number');
    await expect(mobile).toHaveAttribute('placeholder', '082 123 4567');
    await expect(mobile).toHaveAttribute('aria-describedby', 'recipientMobileHelp');

    const metrics = await page.evaluate(() => ({
      viewport:innerWidth,
      document:document.documentElement.scrollWidth,
      short:[...document.querySelectorAll('.wallet a,.purchase-card button,.purchase-card input,.purchase-card select')].filter((node) => {
        if (!node.getClientRects().length) return false;
        const target = ['checkbox','radio'].includes(node.type) ? node.closest('label') : node;
        return !target || target.getBoundingClientRect().height < 44;
      }).length,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.short).toBe(0);
    const accessibility = await new AxeBuilder({ page }).include('.voucher-shell').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);
    await page.screenshot({ path:testInfo.outputPath(`my-shiloh-voucher-wallet-${viewport.name}.png`), fullPage:true, animations:'disabled' });
  }
});

test('My Shiloh Wallet is a centred five-tab hub on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-wallet&viewMode=story', { waitUntil:'networkidle' });

    const nav = page.locator('.bottom-nav');
    await expect(nav.locator('[data-view-target]')).toHaveCount(5);
    await expect(nav.locator('[data-view-target="wallet"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name:'Your Shiloh value, together.' })).toBeVisible();
    await expect(page.getByRole('link', { name:'Open your Shiloh voucher wallet' })).toHaveAttribute('href', '/my-shiloh/gift-vouchers');
    await expect(page.getByRole('link', { name:'View Shiloh Rewards' })).toHaveAttribute('href', '/my-shiloh/rewards');
    await expect(page.getByRole('link', { name:'Open booking payments' })).toHaveAttribute('href', '#bookings');

    const metrics = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav');
      const shiloh = document.querySelector('[data-view-target="shiloh"]');
      const navBox = nav.getBoundingClientRect();
      const shilohBox = shiloh.getBoundingClientRect();
      return {
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        navCenter: navBox.left + navBox.width / 2,
        shilohCenter: shilohBox.left + shilohBox.width / 2,
        short: [...nav.querySelectorAll('a')].filter((node) => node.getBoundingClientRect().height < 44).length,
      };
    });
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(Math.abs(metrics.navCenter - metrics.shilohCenter)).toBeLessThanOrEqual(1);
    expect(metrics.short).toBe(0);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-view="wallet"]')
      .include('.bottom-nav')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);

    await page.screenshot({
      path:testInfo.outputPath(`my-shiloh-wallet-nav-${viewport.name}.png`),
      fullPage:true,
      animations:'disabled',
    });
  }
});

test('WhatsApp client menu leads with the My Shiloh R100 welcome voucher on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=whatsapp-client-menu--welcome-voucher-first&viewMode=story', { waitUntil: 'networkidle' });
    await expect(page.getByText('Install My Shiloh on your phone')).toBeVisible();
    const buttons = page.locator('.wa-action');
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveText('Get R100 voucher');
    await expect(buttons.nth(1)).toHaveText('Browse services');
    await expect(buttons.nth(2)).toHaveText('Book now');
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      short: [...document.querySelectorAll('.wa-action')].filter((node) => node.getBoundingClientRect().height < 44).length,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.short).toBe(0);
    const accessibility = await new AxeBuilder({ page }).include('.wa-story').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`whatsapp-client-menu-voucher-first-${viewport.name}.png`), fullPage: true });
  }
});

test('My Shiloh WhatsApp automatic return is clear and accessible on Phone and Desktop', async ({page},testInfo)=>{
  for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--whats-app-automatic-return&viewMode=story',{waitUntil:'networkidle'});
    const appFrame = page.locator('[data-app-frame]');
    const home = appFrame.locator('[data-view="home"]');
    await expect(home.getByRole('heading',{name:'Your Shiloh, all in one place.'})).toBeVisible();
    await expect(home.getByText('Checking your WhatsApp verification… My Shiloh will open automatically.')).toBeVisible();
    await expect(home.getByText('Enter your 6-digit fallback code')).toBeVisible();
    await expect(home.getByRole('button',{name:'Open My Shiloh'})).toBeVisible();
    const metrics=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,short:[...document.querySelectorAll('[data-client-auth-start], [data-client-auth-code-form] input, [data-client-auth-code-form] button')].filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<44).length}));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);expect(metrics.short).toBe(0);
    const accessibility=await new AxeBuilder({page}).include('[data-view="home"] .hero').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`my-shiloh-whatsapp-auto-return-${viewport.name}.png`),fullPage:true});
  }
});

test('My Shiloh personal details stay contained and accessible on Phone and Desktop', async ({page},testInfo)=>{
  for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-profile&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.getByRole('heading',{name:'Keep your details up to date.'})).toBeVisible();
    await expect(page.getByLabel('Date of birth')).toHaveValue('1985-06-14');
    const geometry=await page.evaluate(()=>{const card=document.querySelector('.profile-editor');const input=document.querySelector('#profile-date-of-birth');const c=card.getBoundingClientRect();const i=input.getBoundingClientRect();return{viewport:innerWidth,document:document.documentElement.scrollWidth,contained:i.left>=c.left&&i.right<=c.right,textAlign:getComputedStyle(input).textAlign,paddingLeft:getComputedStyle(input).paddingLeft};});
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);expect(geometry.contained).toBe(true);
    expect(geometry.textAlign).toBe('left');
    expect(parseFloat(geometry.paddingLeft)).toBeGreaterThanOrEqual(11);
    const accessibility=await new AxeBuilder({page}).include('[data-view="profile"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`my-shiloh-profile-${viewport.name}.png`),fullPage:true});
  }
});

test('My Shiloh presents a client request as planning on phone and desktop', async ({ page }, testInfo) => {
  await page.route('**/my-shiloh/api/experience', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      version: 'my_shiloh_client_experience_v1', generatedAt: '2026-09-26T10:00:00.000Z', client: { firstName: 'Christel' },
      home: {
        eyebrow: 'Your booking request', headline: 'Shiloh is planning your request.',
        summary: 'You requested Hot Stone Massage for Fri, 2 Oct at 10:00. Reception will review the arrangement before confirming it. This appointment is not confirmed yet.',
        status: 'Planning', primaryAction: { kind: 'navigate', label: 'View request', href: '#bookings' },
        facts: [
          { key: 'appointment', label: 'Booking request', value: 'Planning', href: '#bookings', message: 'Reception is reviewing your request.' },
          { key: 'forms', label: 'Forms', value: 'Nothing to do yet', href: null, message: 'Shiloh will let you know if a form is needed.' },
          { key: 'payment', label: 'Payment', value: 'No action yet', href: null, message: 'No payment action is due from this request yet.' },
        ],
      },
      bookings: { upcoming: [
        { service: 'Hot Stone Massage', date: 'Fri, 2 Oct', time: '10:00', practitioner: 'Christel', status: 'Planning', nextAction: 'Reception is reviewing your request. The appointment has not been confirmed.' },
        { service: 'Facial', date: 'Sat, 3 Oct', time: '11:00', practitioner: 'Abigail', status: 'Awaiting your response', nextAction: 'Reply to the Shiloh message about the proposed time.' },
      ], history: [
        { service: 'Sports Massage', date: 'Thu, 1 Oct', time: '09:00', practitioner: 'Christel', status: 'Could not accommodate', nextAction: 'This request was not booked. Ask Shiloh if you would like to find another time.' },
      ] },
      assistant: { prompts: ['What is the status of my request?'], contextReady: true },
    }),
  }));
  for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--booking-request-planning&viewMode=story', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('my-shiloh-install-whatsapp-verified-v1', '1');
      Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => true });
    });
    await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
    await expect(page.locator('[data-client-experience-home]')).toContainText('This appointment is not confirmed yet.');
    await expect(page.locator('[data-client-experience-bookings] .action-card').first()).toContainText('Planning');
    await expect(page.locator('[data-client-experience-bookings] .action-card').first().getByRole('link')).toContainText('request');
    await expect(page.locator('[data-experience-extra-booking]').first()).toContainText('Awaiting your response');
    await expect(page.locator('[data-experience-extra-booking]').last()).toContainText('Could not accommodate');
    await expect(page.locator('[data-experience-extra-booking]').last()).toContainText('not booked');
    await expect(page.locator('[data-client-experience-bookings] .action-card').first()).not.toContainText('Upcoming appointment');
    const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-client-experience-home]')
      .include('[data-client-experience-bookings]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(item => ['serious','critical'].includes(item.impact))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`my-shiloh-request-planning-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
  }
});

test('My Shiloh Home summary cards are tappable and redeemed welcome voucher clears from Home', async ({ page }, testInfo) => {
  await page.route('**/my-shiloh/api/experience', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      version: 'my_shiloh_client_experience_v1',
      generatedAt: '2026-09-22T20:00:00.000Z',
      client: { firstName: 'Christel' },
      home: {
        eyebrow: 'Your Shiloh',
        headline: 'Ready when you are, Christel.',
        summary: 'There is no upcoming appointment linked to your secure client profile right now.',
        status: 'Ready',
        primaryAction: { kind: 'navigate', label: 'Book an appointment', href: '/my-shiloh/book' },
        facts: [
          { key: 'appointment', label: 'Appointment', value: 'None upcoming', href: '#bookings', message: 'Open Bookings to start a new appointment.' },
          { key: 'forms', label: 'Forms', value: 'Nothing waiting', href: null, message: 'Nothing waiting right now.' },
          { key: 'payment', label: 'Payment', value: 'No active booking', href: null, message: 'There is no payment action waiting right now.' },
        ],
      },
      bookings: { upcoming: [] },
      assistant: { prompts: ['Help me choose a treatment.'], contextReady: true },
    }),
  }));
  await page.route('**/my-shiloh/api/profile', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      profile: {
        revision: 'a'.repeat(64),
        name: 'Test Client',
        dateOfBirth: '1985-06-14',
        gender: 'female',
        mobile: '+27 •• ••• 0000',
        registrationComplete: true,
      },
    }),
  }));
  await page.route('**/my-shiloh/api/welcome-voucher', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      version: 'my_shiloh_welcome_voucher_v1',
      eligibility: { complete: true, steps: [] },
      voucher: { state: 'redeemed', amount: 100, minimumBookingValue: 450, redeemedAt: '2026-09-22T19:00:00.000Z' },
      eligibleBookings: [],
      terms: [],
    }),
  }));
  await page.route('**/my-shiloh/api/problem-reports', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reports: [] }),
  }));

  for (const viewport of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-home-summary-actions&viewMode=story', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem('my-shiloh-install-whatsapp-verified-v1', '1');
      Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => true });
    });
    await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });

    const focus = page.locator('[data-client-experience-home]');
    await expect(focus.getByRole('button', { name: /Appointment: None upcoming/ })).toBeVisible();
    await expect(focus.getByRole('button', { name: /Forms: Nothing waiting/ })).toBeVisible();
    await expect(focus.getByRole('button', { name: /Payment: No active booking/ })).toBeVisible();
    await expect(page.locator('[data-welcome-voucher]')).toBeHidden();

    const metrics = await focus.evaluate((node) => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      short: [...node.querySelectorAll('[data-client-experience-fact]')]
        .filter((target) => target.getBoundingClientRect().height < 44).length,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.short).toBe(0);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-client-experience-home]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`my-shiloh-home-summary-actions-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
    });

    await focus.getByRole('button', { name: /Forms: Nothing waiting/ }).click();
    await expect(page.locator('[data-client-experience-fact-status]')).toHaveText('Nothing waiting right now.');
    await focus.getByRole('button', { name: /Payment: No active booking/ }).click();
    await expect(page.locator('[data-client-experience-fact-status]')).toHaveText('There is no payment action waiting right now.');
    await focus.getByRole('button', { name: /Appointment: None upcoming/ }).click();
    await expect(page.locator('[data-view="bookings"]')).toBeVisible();
  }
});

test('Shiloh Rewards is clear, responsive and accessible on Phone and Desktop', async ({page},testInfo)=>{
  for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('/iframe.html?id=shiloh-shiloh-rewards--ready-to-use&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.getByRole('heading',{name:'Shiloh Rewards'})).toBeVisible();
    await expect(page.getByText(/R\s*132[,.]50/).first()).toBeVisible();
    await expect(page.getByRole('button',{name:'Use rewards'})).toBeVisible();
    const metrics=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,short:[...document.querySelectorAll('button,input,select,a')].filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<44).length}));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);expect(metrics.short).toBe(0);
    const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`shiloh-rewards-${viewport.name}.png`),fullPage:true});
  }
});

test('linked booking payment is usable on Phone and Desktop', async ({page},testInfo)=>{
  for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('/iframe.html?id=workspace-production-surfaces--linked-booking-payment&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.getByRole('heading',{name:'Linked booking #55'})).toBeVisible();
    await expect(page.getByText('R 740,00').first()).toBeVisible();
    const metrics=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,short:[...document.querySelectorAll('button,input,select,a')].filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<44).length}));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);expect(metrics.short).toBe(0);
    const accessibility=await new AxeBuilder({page}).include('.workspace-surface-story').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`payment-${viewport.name}.png`),fullPage:true});
  }
});


test('booking deposit policy is clear and accessible on Phone and Desktop', async ({page},testInfo)=>{
  for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('/iframe.html?id=workspace-production-surfaces--booking-deposit-awaiting&viewMode=story',{waitUntil:'networkidle'});
    await expect(page.getByRole('heading',{name:'Appointment #812'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'50% booking deposit'})).toBeVisible();
    await expect(page.getByText('Awaiting deposit',{exact:true})).toBeVisible();
    await expect(page.getByText(/48\+ hours notice/)).toBeVisible();
    await expect(page.getByText(/24–48 hours/)).toBeVisible();
    await expect(page.getByText(/no-show/)).toBeVisible();
    await expect(page.getByRole('heading',{name:'Record deposit received'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Shiloh Rewards'})).toHaveCount(0);
    const metrics=await page.evaluate(()=>({
      viewport:innerWidth,
      document:document.documentElement.scrollWidth,
      short:[...document.querySelectorAll('[data-payment-page] button,[data-payment-page] input,[data-payment-page] select,[data-payment-page] a')]
        .filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<44).length,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.short).toBe(0);
    const accessibility=await new AxeBuilder({page}).include('[data-payment-page]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`booking-deposit-${viewport.name}.png`),fullPage:true,animations:'disabled'});
  }
});

test('My Shiloh deposit request is clear and accessible on Phone and Desktop', async ({page},testInfo)=>{
  for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-deposit-required&viewMode=story',{waitUntil:'networkidle'});
    const home=page.locator('[data-client-experience-home]');
    await expect(home.getByRole('heading',{name:'Your booking is awaiting its deposit.'})).toBeVisible();
    await expect(home.getByText('R340 deposit required')).toBeVisible();
    await expect(home.getByRole('link',{name:'Pay deposit'})).toHaveAttribute('href','/pay/dep_storybook123');
    await expect(home.getByText(/Pay the 50% booking deposit to secure it/)).toBeVisible();
    const metrics=await home.evaluate(node=>({
      viewport:innerWidth,
      document:document.documentElement.scrollWidth,
      short:[...node.querySelectorAll('button,a')].filter(target=>target.getClientRects().length&&target.getBoundingClientRect().height<44).length,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.short).toBe(0);
    const accessibility=await new AxeBuilder({page}).include('[data-client-experience-home]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`my-shiloh-deposit-${viewport.name}.png`),fullPage:true,animations:'disabled'});
  }
});

test('My Shiloh keeps an awaiting deposit clear when its link is unavailable on Phone and Desktop', async ({page},testInfo)=>{
  for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1280,height:900}]){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-deposit-link-unavailable&viewMode=story',{waitUntil:'networkidle'});
    const home=page.locator('[data-client-experience-home]');
    await expect(home.getByRole('heading',{name:'Your booking is awaiting its deposit.'})).toBeVisible();
    await expect(home.getByText(/secure payment link is not available yet/)).toBeVisible();
    await expect(home.getByRole('link',{name:'Ask Shiloh about my deposit'})).toHaveAttribute('href','#shiloh');
    await expect(home.getByRole('link',{name:'Pay deposit'})).toHaveCount(0);
    const metrics=await home.evaluate(node=>({
      viewport:innerWidth,
      document:document.documentElement.scrollWidth,
      short:[...node.querySelectorAll('button,a')].filter(target=>target.getClientRects().length&&target.getBoundingClientRect().height<44).length,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.short).toBe(0);
    const accessibility=await new AxeBuilder({page}).include('[data-client-experience-home]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`my-shiloh-deposit-link-unavailable-${viewport.name}.png`),fullPage:true,animations:'disabled'});
  }
});

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

test('Group booking adds multiple guests and exposes an optional-note discount on Phone', async ({ page }, testInfo) => {
  const guests = [
    ['Alex Adams', '082 111 1111', '81', '11'],
    ['Sam Adams', '082 222 2222', '84', '12'],
    ['Taylor Adams', '082 333 3333', '82', '13'],
  ];
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
  await expect(page.locator('[data-review-group]')).toBeEnabled();

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

test('Multiple treatments stays compact and clear for one client on Phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--multi-service-client-booking&viewMode=story', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Book multiple treatments' })).toBeVisible();
  await expect(page.locator('[data-treatment]')).toHaveCount(2);
  await page.locator('[data-treatment]').nth(0).locator('[data-service]').selectOption('81');
  await page.locator('[data-treatment]').nth(0).locator('[data-staff]').selectOption('11');
  await page.locator('[data-treatment]').nth(0).locator('[data-start-time]').fill('09:00');
  await page.locator('[data-treatment]').nth(1).locator('[data-service]').selectOption('82');
  await expect(page.locator('[data-treatment]').nth(1).locator('[data-start-time]')).toHaveValue('09:45');
  await page.getByRole('button', { name: 'Add treatment' }).click();
  await expect(page.locator('[data-treatment]')).toHaveCount(3);
  await expect(page.locator('[data-multiple-status]')).toContainText('Treatment 3 added');
  const scan = await new AxeBuilder({ page }).analyze();
  const serious = scan.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(serious, `Serious accessibility violations in multiple-treatment booking: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('multi-service-client-booking-phone.png'), fullPage: true });
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

test('staff browser handoff offers existing passkey recovery on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=staff-passkey-sign-in--browser-handoff&viewMode=story', { waitUntil:'networkidle' });

    const surface = page.locator('[data-passkey-signin-story]');
    await expect(surface).toBeVisible();
    await expect(surface.getByRole('heading', { name:'Secure staff sign-in' })).toBeVisible();
    await expect(surface.getByRole('button', { name:'Use existing passkey' })).toBeVisible();
    await expect(surface.getByText(/This browser is not linked yet/)).toBeVisible();
    await expect(surface).not.toContainText('Device setup required');

    const metrics = await surface.evaluate((node) => ({
      viewportWidth:innerWidth,
      documentWidth:document.documentElement.scrollWidth,
      shortButtons:[...node.querySelectorAll('button')]
        .filter((button) => button.getClientRects().length && button.getBoundingClientRect().height < 44)
        .map((button) => button.textContent.trim()),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.shortButtons).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-passkey-signin-story]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);

    await page.screenshot({
      path:testInfo.outputPath(`staff-passkey-browser-handoff-${viewport.name}.png`),
      fullPage:true,
      animations:'disabled',
      caret:'hide',
    });
  }
});

test('stalled Android passkey setup shows a clear accessible recovery on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=staff-passkey-bootstrap--android-verification-stalled&viewMode=story', { waitUntil:'networkidle' });

    const surface = page.locator('[data-passkey-bootstrap-story]');
    await expect(surface).toBeVisible();
    await expect(surface.getByRole('heading', { name:'Set up this device' })).toBeVisible();
    await expect(surface.getByText(/Android did not finish device verification/)).toBeVisible();
    await expect(surface.getByRole('button', { name:'Try again' })).toBeVisible();
    await expect(surface.getByRole('button', { name:'Open sign-in' })).toBeVisible();
    await expect(surface.getByRole('button', { name:'Add this device' })).toBeHidden();
    await expect(surface.getByRole('button', { name:'Replace a lost device' })).toBeHidden();

    const metrics = await surface.evaluate((node) => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      shortButtons: [...node.querySelectorAll('button')]
        .filter((button) => button.getClientRects().length && button.getBoundingClientRect().height < 44)
        .map((button) => button.textContent.trim()),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.shortButtons).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-passkey-bootstrap-story]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in passkey stall recovery on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await page.screenshot({
      path:testInfo.outputPath(`android-passkey-stall-${viewport.name}.png`),
      fullPage:true,
      animations:'disabled',
      caret:'hide',
    });
  }
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

test('Dashboard visit outcomes use a polished accessible confirmation on Desktop and Phone', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=workspace-production-surfaces--dashboard-operational&viewMode=story', { waitUntil: 'networkidle' });

    const carryOver = page.locator('[data-dashboard-carryover-panel]');
    await carryOver.getByRole('button', { name: 'Completed' }).click();

    const dialog = page.locator('[data-dashboard-outcome-dialog]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Mark this visit as completed?' })).toBeVisible();
    await expect(dialog).toContainText('Previous-day client’s appointment');
    await expect(dialog.getByRole('button', { name: 'Not yet' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Mark completed' })).toBeVisible();

    const accessibility = await new AxeBuilder({ page })
      .include('[data-dashboard-outcome-dialog]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in Dashboard outcome dialog: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await dialog.getByRole('button', { name: 'Not yet' }).click();
    await expect(dialog).toBeHidden();

    await carryOver.getByRole('button', { name: 'No-show' }).click();
    await expect(dialog.getByRole('heading', { name: 'Mark this visit as a no-show?' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Mark no-show' })).toBeVisible();
    await page.screenshot({ path: `artifacts/dashboard-outcome-dialog-${viewport.width <= 560 ? 'phone' : 'desktop'}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(carryOver.getByRole('button', { name: 'No-show' })).toBeFocused();
  }
});

test('Dashboard allows No-show from visit start while keeping Completed unavailable until the visit ends', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=workspace-production-surfaces--dashboard-active-no-show&viewMode=story', { waitUntil: 'networkidle' });

    const activeVisit = page.locator('[data-dashboard-appointment="667"]');
    await expect(activeVisit.getByRole('button', { name: 'No-show' })).toBeVisible();
    await expect(activeVisit.getByRole('button', { name: 'Completed' })).toHaveCount(0);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-dashboard-appointment="667"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, 'Serious accessibility violations in active No-show action: ' + JSON.stringify(serious, null, 2)).toEqual([]);

    await activeVisit.getByRole('button', { name: 'No-show' }).click();
    const dialog = page.locator('[data-dashboard-outcome-dialog]');
    await expect(dialog.getByRole('heading', { name: 'Mark this visit as a no-show?' })).toBeVisible();
    await expect(dialog).toContainText('release the remaining appointment time for booking');
    await page.screenshot({ path: 'artifacts/dashboard-active-no-show-' + (viewport.width <= 560 ? 'phone' : 'desktop') + '.png' });
    await page.keyboard.press('Escape');
  }
});

test('PWA icon uses the approved raster asset at full canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=workspace-production-surfaces--pwa-icon-optical-scale&viewMode=story', { waitUntil: 'networkidle' });

  const icon = await page.locator('.pwa-icon').evaluate((svg) => {
    const image = svg.querySelector('image');
    return {
      viewBox: svg.getAttribute('viewBox'),
      width: image?.getAttribute('width'),
      height: image?.getAttribute('height'),
      href: image?.getAttribute('href'),
    };
  });
  expect(icon).toEqual({
    viewBox: '0 0 192 192',
    width: '192',
    height: '192',
    href: '/assets/pwa/shiloh-pwa-192.png?v=official-brand-v2',
  });
});

test('Workspace navigation drawer remains contained and branded on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=workspace-production-surfaces--navigation-drawer-open&viewMode=story', { waitUntil: 'networkidle' });

    const drawer = page.locator('[data-workspace-navigation-drawer]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.workspace-brand-icon:visible')).toBeVisible();
    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector)?.getBoundingClientRect();
        return value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height } : null;
      };
      const links = document.querySelector('.workspace-links');
      const logo = document.querySelector('.workspace-brand-icon');
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        drawer: rect('[data-workspace-navigation-drawer]'),
        header: rect('.workspace-drawer-header'),
        close: rect('[data-workspace-drawer-close]'),
        account: rect('[data-workspace-account-footer]'),
        closeDisplay: getComputedStyle(document.querySelector('[data-workspace-drawer-close]')).display,
        linksOverflowY: links ? getComputedStyle(links).overflowY : '',
        logoSource: logo?.getAttribute('src') || '',
        shortTargets: [...document.querySelectorAll('.workspace-nav a,.workspace-nav button')]
          .filter((node) => node.getClientRects().length > 0 && node.getBoundingClientRect().height < 44)
          .map((node) => node.textContent.trim() || node.getAttribute('aria-label')),
      };
    });
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.logoSource).toBe('/calendar/pwa/icon-192.png?v=official-brand-v4');
    if (viewport.name === 'phone') {
      expect(metrics.shortTargets).toEqual([]);
      const expectedDrawerWidth = Math.min(viewport.width * 0.6, 220);
      expect(metrics.drawer.width).toBeGreaterThanOrEqual(expectedDrawerWidth - 1);
      expect(metrics.drawer.width).toBeLessThanOrEqual(expectedDrawerWidth + 1);
      expect(viewport.width - metrics.drawer.right).toBeGreaterThanOrEqual(viewport.width - expectedDrawerWidth - 1);
      expect(metrics.drawer.right).toBeLessThanOrEqual(viewport.width);
      expect(metrics.header.left).toBeGreaterThanOrEqual(metrics.drawer.left);
      expect(metrics.header.right).toBeLessThanOrEqual(metrics.drawer.right);
      expect(metrics.close.left).toBeGreaterThanOrEqual(metrics.drawer.left);
      expect(metrics.close.right).toBeLessThanOrEqual(metrics.drawer.right);
      expect(metrics.account.bottom).toBeLessThanOrEqual(metrics.drawer.bottom);
      expect(metrics.linksOverflowY).toBe('auto');
    } else {
      expect(metrics.drawer.width).toBe(188);
      expect(metrics.closeDisplay).toBe('none');
    }

    const accessibility = await new AxeBuilder({ page })
      .include('[data-workspace-navigation-drawer]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in Workspace drawer on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`workspace-navigation-drawer-${viewport.name}.png`), fullPage: false, animations: 'disabled' });
  }
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
  ['visit', 'visit'],
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
      await expect(surface.locator('a[href="/my-shiloh/"]').first()).toBeAttached();

      if (name === 'home') {
        await expect(surface.locator('[data-public-service-discovery]')).toBeVisible();
        await expect(surface.locator('[data-google-reviews]')).toBeVisible();
        await expect(surface.locator('[data-reviews-rail] .review-card')).toHaveCount(3);
        await expect(surface.getByRole('link', { name: 'Read all reviews on Google Maps →' })).toBeVisible();
        await expect(surface.getByRole('button', { name: 'Previous review' })).toBeVisible();
        await expect(surface.getByRole('button', { name: 'Next review' })).toBeVisible();
        await expect(surface.locator('[data-public-service-category]')).toHaveCount(7);
        await expect(surface.getByRole('heading', { name: 'Advanced Aesthetics' })).toBeVisible();
        await expect(surface.getByRole('heading', { name: 'Body & Wellness' })).toBeVisible();
        await expect(surface.getByRole('link', { name: 'Not sure? Ask Shiloh' })).toHaveAttribute(
          'href',
          '/book#choose-with-shiloh',
        );
      }

      if (name === 'treatments') {
        await expect(surface.locator('[data-public-category-navigation]')).toBeVisible();
        await expect(surface.locator('[data-public-category-navigation] a')).toHaveCount(7);
        await expect(surface.locator('#category-massage')).toBeVisible();
        await expect(surface.locator('#category-advanced-aesthetics')).toBeVisible();
        await expect(surface.locator('#category-body-and-wellness')).toBeVisible();
        await expect(surface.getByRole('heading', { name: 'SQT Rejuvenation & Revitalising BioMicroneedling' })).toBeVisible();
        await expect(surface.getByText(
          'An SQT BioMicroneedling option focused on rejuvenation and revitalising skincare goals, selected according to the client’s skin assessment and suitability.',
          { exact: true },
        )).toBeVisible();
        await expect(surface.getByRole('heading', { name: 'Plasma Fibroblast – By Area' })).toBeVisible();
        await expect(surface.getByText('R1 900–R6 500', { exact: true })).toBeVisible();
        await expect(surface.getByRole('heading', { name: 'VHC Vitamin Microneedling' })).toBeVisible();
      }

      if (name === 'book') {
        await expect(surface.getByText('Restorative foot care.', { exact: true })).toBeVisible();
      }

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
  await expect(page.getByRole('heading', { name: 'Services are temporarily unavailable' })).toBeVisible();

  await page.goto(
    '/iframe.html?id=public-website-production-pages--whats-app-unavailable&viewMode=story',
    { waitUntil: 'networkidle' },
  );
  await expect(page.getByRole('status')).toContainText('WhatsApp is taking a short pause.');
  await expect(page.getByRole('status')).toContainText('Your choice is safe here.');
  await expect(page.getByRole('link', { name: 'email Shiloh for help' })).toHaveAttribute(
    'href',
    /^mailto:info@shilohmtc\.co\.za\?/,
  );
  await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
});


test('My Shiloh install doorway is clear, contained and accessible on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--browser-install-doorway&viewMode=story', { waitUntil: 'networkidle' });

    const gate = page.locator('[data-install-gate]');
    await expect(gate).toBeVisible();
    await expect(page.locator('[data-app-frame]')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Keep My Shiloh one tap away.' })).toBeVisible();
    await expect(page.getByText('Already installed? Open My Shiloh from your Home Screen.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show install steps' })).toBeVisible();
    await expect(gate.locator('[data-install-gate-instructions]')).toHaveCount(0);

    const metrics = await gate.evaluate((node) => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      cardWidth: node.querySelector('.install-gate__card')?.getBoundingClientRect().width || 0,
      shortTargets: [...node.querySelectorAll('button,a')]
        .filter((target) => target.getClientRects().length && target.getBoundingClientRect().height < 44)
        .map((target) => target.textContent.trim() || target.getAttribute('aria-label')),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.cardWidth).toBeLessThanOrEqual(metrics.viewportWidth - 24);
    expect(metrics.shortTargets).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-install-gate]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in My Shiloh install doorway on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`my-shiloh-install-doorway-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});

test('My Shiloh standalone guest state keeps WhatsApp sign-in available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=client-my-shiloh-pwa--standalone-guest-sign-in&viewMode=story', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-install-gate]')).toBeHidden();
  const appFrame = page.locator('[data-app-frame]');
  await expect(appFrame).toBeVisible();
  await expect(appFrame.getByRole('button', { name: 'Continue with WhatsApp' }).first()).toBeVisible();
  await expect(appFrame.getByText('Enter your 6-digit fallback code').first()).toBeVisible();
});


test('authenticated My Shiloh browser sessions still show only the install doorway', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-browser-install-doorway&viewMode=story', { waitUntil: 'networkidle' });

    const gate = page.locator('[data-install-gate]');
    const appFrame = page.locator('[data-app-frame]');
    await expect(gate).toBeVisible();
    await expect(appFrame).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Keep My Shiloh one tap away.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show install steps' })).toBeVisible();
    await expect(gate.locator('[data-install-gate-instructions]')).toHaveCount(0);
    await expect(page.getByText('Good evening, Christel.')).toBeHidden();
    await expect(page.getByText('Your R100 welcome voucher.')).toBeHidden();

    const accessibility = await new AxeBuilder({ page })
      .include('[data-install-gate]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in authenticated browser install doorway on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`my-shiloh-authenticated-browser-install-doorway-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});


test('My Shiloh install guidance appears only after Show install steps is tapped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=client-my-shiloh-pwa--browser-install-doorway&viewMode=story', { waitUntil: 'networkidle' });
  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });

  await expect(page.locator('[data-install-gate-instructions]')).toHaveCount(0);
  const button = page.getByRole('button', { name: 'Show install steps' });
  await expect(button).toBeVisible();

  const sheet = page.locator('[data-install-sheet]');
  await expect(sheet).toBeHidden();
  await button.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Add My Shiloh to your Home Screen.' })).toBeVisible();
  await expect(sheet.getByText('Open your browser menu or Share button')).toBeVisible();
  await expect(sheet.getByText('Choose Add to Home Screen or Install app')).toBeVisible();
  await expect(sheet.getByText('Open My Shiloh', { exact: true })).toBeVisible();
});

test('iPhone Safari install guide fits without scrolling and is accessible on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--i-phone-install-guide&viewMode=story', { waitUntil: 'networkidle' });

    const gate = page.locator('[data-install-gate]');
    const sheet = page.locator('[data-install-sheet]');
    const panel = sheet.locator('.install-sheet__panel');
    await expect(gate).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(gate.getByRole('heading', { name: 'Add My Shiloh to your iPhone.' })).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Show iPhone steps' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Three quick steps.' })).toBeVisible();
    await expect(sheet.getByText('Stay in Safari — no App Store download is needed.')).toBeVisible();
    const safariShareStep = sheet.locator('[data-install-step-title="1"]');
    await expect(safariShareStep).toContainText('Tap Share');
    await expect(safariShareStep.locator('svg.install-share-icon[aria-hidden="true"]')).toHaveCount(1);
    await expect(sheet.getByText('Choose Add to Home Screen', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Turn on Open as Web App, then tap Add', { exact: true })).toBeVisible();

    const metrics = await panel.evaluate((node) => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      shortTargets: [...node.querySelectorAll('button,a')]
        .filter((target) => target.getClientRects().length && target.getBoundingClientRect().height < 44)
        .map((target) => target.textContent.trim() || target.getAttribute('aria-label')),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.shortTargets).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-install-sheet]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in iPhone Safari install guide on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`my-shiloh-iphone-safari-install-guide-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});

test('iPhone Chrome install guide adds My Shiloh directly without scrolling', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--i-phone-chrome-install-guide&viewMode=story', { waitUntil: 'networkidle' });

    const gate = page.locator('[data-install-gate]');
    const sheet = page.locator('[data-install-sheet]');
    const panel = sheet.locator('.install-sheet__panel');
    await expect(gate.getByRole('heading', { name: 'Add My Shiloh to your iPhone.' })).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Show iPhone steps' })).toBeVisible();
    await expect(gate.getByText('You’re in Chrome. Use Share to add My Shiloh to your Home Screen.')).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Three quick steps.' })).toBeVisible();
    await expect(sheet.getByText('You can add My Shiloh straight from Chrome — no App Store download is needed.')).toBeVisible();
    const chromeShareStep = sheet.locator('[data-install-step-title="1"]');
    await expect(chromeShareStep).toContainText('Tap Share');
    await expect(chromeShareStep.locator('svg.install-share-icon[aria-hidden="true"]')).toHaveCount(1);
    await expect(sheet.getByText('Choose Add to Home Screen', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Tap Add', { exact: true })).toBeVisible();

    const metrics = await panel.evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      shortTargets: [...node.querySelectorAll('button,a')]
        .filter((target) => target.getClientRects().length && target.getBoundingClientRect().height < 44)
        .map((target) => target.textContent.trim() || target.getAttribute('aria-label')),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.shortTargets).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-install-sheet]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`my-shiloh-iphone-chrome-install-guide-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});

test('Android install doorway keeps the native install action primary on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--android-install-doorway&viewMode=story', { waitUntil: 'networkidle' });
    const gate = page.locator('[data-install-gate]');
    await expect(gate.getByRole('heading', { name: 'Add My Shiloh to your phone.' })).toBeVisible();
    await expect(gate.getByRole('button', { name: 'Install My Shiloh' })).toBeVisible();
    await expect(gate.getByText('Tap below and Android will add My Shiloh to your Home Screen.')).toBeVisible();

    const accessibility = await new AxeBuilder({ page })
      .include('[data-install-gate]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`my-shiloh-android-install-doorway-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});

test('My Shiloh refreshes an authenticated greeting from current Johannesburg time', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-home&viewMode=story', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('my-shiloh-install-whatsapp-verified-v1', '1');
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => true });
    const RealDate = window.Date;
    const fixed = new RealDate('2026-09-26T04:41:00.000Z');
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(fixed.getTime());
      }
      static now() { return fixed.getTime(); }
    }
    window.Date = FixedDate;
  });
  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
  await expect(page.getByRole('heading', { name: 'Good morning, Christel.' })).toBeVisible();
});


test('My Shiloh first installed launch asks for one WhatsApp verification on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--first-launch-whats-app-verification&viewMode=story', { waitUntil: 'networkidle' });

    const gate = page.locator('[data-install-verification-gate]');
    await expect(gate).toBeVisible();
    await expect(page.locator('[data-install-gate]')).toBeHidden();
    await expect(page.locator('[data-app-frame]')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Confirm it’s you to finish setting up My Shiloh.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify with WhatsApp' })).toBeVisible();
    await expect(page.getByText('Verify with WhatsApp once on this installation. After that, just open My Shiloh normally.')).toBeVisible();
    await expect(page.getByText('Good evening, Jean-Pierre.')).toBeHidden();

    const metrics = await gate.evaluate((node) => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      shortTargets: [...node.querySelectorAll('button,input,a')]
        .filter((target) => target.getClientRects().length && target.getBoundingClientRect().height < 44)
        .map((target) => target.textContent.trim() || target.getAttribute('aria-label') || target.id),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.shortTargets).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-install-verification-gate]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in My Shiloh first-launch verification on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`my-shiloh-first-launch-whatsapp-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});


test('My Shiloh opens installed WhatsApp directly before web fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      get: () => true,
    });
  });
  await page.route('**/my-shiloh/auth/start', async (route) => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'waiting_for_whatsapp',
      whatsappUrl: 'whatsapp://send?phone=27830000000&text=MY%20SHILOH%20SIGN%20IN%20TEST',
      whatsappAppUrl: 'whatsapp://send?phone=27830000000&text=MY%20SHILOH%20SIGN%20IN%20TEST',
      whatsappFallbackUrl: 'https://wa.me/27830000000?text=MY%20SHILOH%20SIGN%20IN%20TEST',
      expiresAt: '2026-09-22T22:00:00.000Z',
    }),
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=client-my-shiloh-pwa--first-launch-whats-app-verification&viewMode=story', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    window.__myShilohDirectWhatsApp = null;
    window.__myShilohFallbackSeen = false;
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('[data-whatsapp-direct]');
      if (!link) return;
      event.preventDefault();
      window.__myShilohDirectWhatsApp = link.getAttribute('href');
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
    }, true);
  });
  await page.route('https://wa.me/**', async (route) => {
    await page.evaluate(() => { window.__myShilohFallbackSeen = true; });
    await route.abort();
  });

  await page.addScriptTag({ url: '/my-shiloh/assets/app.js' });
  const gate = page.locator('[data-install-verification-gate]');
  await expect(gate).toBeVisible();
  await gate.getByRole('button', { name: 'Verify with WhatsApp' }).click();

  await expect.poll(() => page.evaluate(() => window.__myShilohDirectWhatsApp)).toContain('whatsapp://send?phone=27830000000');
  await page.waitForTimeout(2100);
  expect(await page.evaluate(() => window.__myShilohFallbackSeen)).toBe(false);
  await expect(gate).toBeVisible();
});


test('legacy welcome-voucher deep link opens the new Wallet view', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-home&viewMode=story#welcome-voucher', { waitUntil:'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('my-shiloh-install-whatsapp-verified-v1', '1');
    Object.defineProperty(window.navigator, 'standalone', { configurable:true, get:() => true });
    location.hash = '#welcome-voucher';
  });
  await page.addScriptTag({ url:'/my-shiloh/assets/app.js' });
  await expect(page.locator('[data-view="wallet"]')).toBeVisible();
  await expect(page.locator('[data-view-target="wallet"]')).toHaveAttribute('aria-current', 'page');
});


test('My Shiloh update prompt is clear and accessible on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--update-available&viewMode=story', { waitUntil:'networkidle' });
    const banner = page.locator('[data-app-update]');
    await expect(banner).toBeVisible();
    await expect(banner.getByText('A new My Shiloh update is ready.')).toBeVisible();
    await expect(banner.getByRole('button', { name:'Update now' })).toBeVisible();
    const metrics = await banner.evaluate((node) => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      buttonHeight: node.querySelector('button')?.getBoundingClientRect().height || 0,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.buttonHeight).toBeGreaterThanOrEqual(42);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-app-update]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);
    await page.screenshot({
      path:testInfo.outputPath(`my-shiloh-update-available-${viewport.name}.png`),
      fullPage:true,
      animations:'disabled',
    });
  }
});

test('My Shiloh notification opt-in is client-controlled and accessible on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-notifications-profile&viewMode=story', { waitUntil:'networkidle' });
    const settings = page.locator('[data-push-settings]');
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('heading', { name:'Stay up to date with Shiloh.' })).toBeVisible();
    await expect(settings.getByRole('button', { name:'Turn on notifications' })).toBeVisible();
    await expect(settings.getByText('Operational updates only. Promotional messages stay separate and are never enabled by this setting.')).toBeVisible();
    await expect(page.locator('[data-notification-badge]')).toHaveCount(0);
    const metrics = await settings.evaluate((node) => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      buttonHeight: node.querySelector('[data-push-toggle]')?.getBoundingClientRect().height || 0,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.buttonHeight).toBeGreaterThanOrEqual(44);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-push-settings]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter((violation) => ['serious','critical'].includes(violation.impact))).toEqual([]);
    await page.screenshot({
      path:testInfo.outputPath(`my-shiloh-notification-opt-in-${viewport.name}.png`),
      fullPage:true,
      animations:'disabled',
    });
  }
});


test('unified Booking Policy & Terms is readable and accessible on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-booking-policy--unified-booking-policy&viewMode=story', { waitUntil: 'networkidle' });

    const policy = page.locator('[data-booking-policy-story]');
    await expect(policy).toBeVisible();
    await expect(policy.getByRole('heading', { level: 1, name: 'Booking Policy & Terms' })).toBeVisible();
    await expect(policy.getByText(/50% booking deposit/)).toBeVisible();
    await expect(policy.getByText(/48 hours or more before your appointment/)).toBeVisible();
    await expect(policy.getByText(/24–48 hours/)).toBeVisible();
    await expect(policy.getByText(/Our therapists set aside this time especially for you/)).toBeVisible();
    await expect(policy).not.toContainText('Marietjie');
    await expect(policy.getByText(/Any deposit already paid remains linked to your booking/)).toBeVisible();
    await expect(policy.getByText(/reply exactly: I AGREE/i)).toBeVisible();

    const geometry = await policy.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-booking-policy-story]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact),
    );
    expect(
      serious,
      `Serious accessibility violations in unified booking policy on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`,
    ).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`unified-booking-policy-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});


test('My Shiloh native booking stays in-app and is usable on Phone and Desktop', async ({ page }, testInfo) => {
  const confirmations = [];
  await page.route('**/my-shiloh/api/booking/practitioners?**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      service: { id:101, name:'Hot Stone Massage', category:'Massage', durationMinutes:75, price:850, variablePrice:false },
      practitioners: [
        { id:11, name:'Christel', depositExempt:false },
        { id:13, name:'Marietjie', depositExempt:true },
      ],
      deposit: { ratePercent:50, exemptStaffId:13 },
    }),
  }));
  await page.route('**/my-shiloh/api/booking/availability?**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status:'available',
      service:{ id:101, name:'Hot Stone Massage' },
      practitioner:{ id:11, name:'Christel' },
      date:'2026-09-30',
      slots:[
        { startsAt:'2026-09-30T08:00:00.000Z', endsAt:'2026-09-30T09:15:00.000Z', date:'2026-09-30', time:'10:00', endTime:'11:15', practitionerId:11, practitionerName:'Christel' },
      ],
    }),
  }));
  await page.route('**/my-shiloh/api/booking/confirm', async (route) => {
    confirmations.push({
      headers: await route.request().allHeaders(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        status:'pending_resolution',
        appointmentId:812,
        service:'Hot Stone Massage',
        practitioner:'Christel',
        startsAt:'2026-09-30T08:00:00.000Z',
        message:'Your booking request is in. Your selected time is being held while the Shiloh team confirms it. You’ll see the deposit step in My Shiloh after approval.',
      }),
    });
  });

  for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'desktop', width:1280, height:900 }]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=client-my-shiloh-pwa--authenticated-native-booking&viewMode=story', { waitUntil:'networkidle' });
    await page.addScriptTag({ url:'/my-shiloh/assets/booking.js' });

    await expect(page.getByRole('heading', { name:'Choose your next appointment, Christel.' })).toBeVisible();
    await expect(page.getByText(/Everything happens here in My Shiloh/)).toBeVisible();
    await page.locator('[data-book-service][data-service-id="101"]').click();

    await expect(page.getByRole('heading', { name:'Who would you like to see?' })).toBeVisible();
    await expect(page.getByText('No deposit required')).toBeVisible();
    await page.locator('[data-practitioner-id="11"]').click();

    await expect(page.getByRole('heading', { name:'Choose a date and time.' })).toBeVisible();
    await page.locator('[data-booking-date]').fill('2026-09-30');
    await page.getByRole('button', { name:'Show available times' }).click();
    await page.getByRole('button', { name:/10:00–11:15/ }).click();

    await expect(page.getByRole('heading', { name:'Review your booking request.' })).toBeVisible();
    await expect(page.locator('[data-review-service]')).toContainText('Hot Stone Massage');
    await expect(page.locator('[data-review-practitioner]')).toHaveText('Christel');
    await expect(page.locator('[data-review-deposit]')).toHaveText('50% after approval');
    await page.locator('[data-policy-accepted]').check();
    await page.getByRole('button', { name:'Send booking request' }).click();

    await expect(page.getByRole('heading', { name:'Booking request sent.' })).toBeVisible();
    await expect(page.getByText(/selected time is being held while the Shiloh team confirms it/)).toBeVisible();
    await expect(page.getByRole('link', { name:'View My Shiloh bookings' })).toHaveAttribute('href', '/my-shiloh/#bookings');

    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      short: [...document.querySelectorAll('[data-my-shiloh-booking] button,[data-my-shiloh-booking] a,[data-my-shiloh-booking] input')]
        .filter((node) => {
          if (!node.getClientRects().length) return false;
          const target = ['checkbox','radio'].includes(node.type) ? node.closest('label') : node;
          return !target || target.getBoundingClientRect().height < 44;
        }).length,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.short).toBe(0);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-my-shiloh-booking]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);

    await page.screenshot({
      path:testInfo.outputPath(`my-shiloh-native-booking-${viewport.name}.png`),
      fullPage:true,
      animations:'disabled',
    });
  }

  expect(confirmations).toHaveLength(2);
  for (const call of confirmations) {
    expect(call.headers['x-shiloh-csrf-token']).toBe('storybook-csrf');
    expect(call.body).toEqual({
      serviceId:101,
      staffId:11,
      startsAt:'2026-09-30T08:00:00.000Z',
      policyAccepted:true,
    });
  }
});


test('booking conflict recovery shows the actual cause on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=workspace-production-surfaces--booking-conflict-recovery&viewMode=story', { waitUntil: 'networkidle' });

    const status = page.locator('[data-booking-status]');
    await expect(status).toBeVisible();
    await expect(status.getByText('This time overlaps another booking or blocked period.')).toBeVisible();
    await expect(status.locator('.recovery-detail')).toContainText('Christel — Toe Gel Only');
    await expect(status.locator('.recovery-detail')).toContainText('Existing client booking');
    await expect(status.getByRole('button', { name: 'Choose another time' })).toBeVisible();
    await expect(status.getByRole('button', { name: 'Report a problem' })).toBeVisible();

    const geometry = await status.evaluate((node) => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      shortControls: [...node.querySelectorAll('button')].filter((control) => control.getBoundingClientRect().height < 44).length,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.shortControls).toBe(0);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-booking-status]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(serious, `Serious accessibility violations in booking conflict recovery on ${viewport.name}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`booking-conflict-recovery-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});


test('deposit policy is unmistakable before Ozow on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=client-payment-policy--deposit-policy-before-ozow&viewMode=story', { waitUntil: 'networkidle' });

    const policy = page.locator('[data-payment-policy-story]');
    await expect(policy).toBeVisible();
    await expect(policy.getByRole('heading', { level: 1, name: 'Review & accept before payment' })).toBeVisible();
    await expect(policy.getByText('Step 1', { exact: true })).toBeVisible();
    await expect(policy.getByText('Step 2', { exact: true })).toBeVisible();
    await expect(policy.getByText(/No payment is taken until you accept/)).toBeVisible();
    await expect(policy.getByRole('heading', { name: 'Booking Deposit' })).toBeVisible();
    await expect(policy.getByRole('heading', { name: 'Cancellations & Rescheduling' })).toBeVisible();
    await expect(policy.getByText(/Our therapists set aside this time especially for you/)).toBeVisible();
    await expect(policy).not.toContainText('Marietjie');
    await expect(policy.getByRole('heading', { name: 'Professional Treatment Standards' })).toBeVisible();
    await expect(policy.getByRole('heading', { name: 'Appointments & Arrival' })).toBeVisible();
    await expect(policy.getByRole('heading', { name: 'Health & Treatment Information' })).toBeVisible();
    await expect(policy.getByRole('heading', { name: 'Respect, Safety & Belongings' })).toBeVisible();
    await expect(policy.getByText('Updated 25 September 2026')).toHaveCount(0);
    await expect(policy.getByText('Version 2026-09-25-v3')).toHaveCount(0);
    await expect(policy.getByText(/reply exactly: I AGREE/i)).toHaveCount(0);
    await expect(policy.getByText(/If you do not agree, reply/i)).toHaveCount(0);
    await expect(policy.getByRole('button', { name: 'Accept & continue to secure payment' })).toBeVisible();
    await expect(policy).not.toContainText('*Respect, Safety & Belongings*');
    const policyOrder = await policy.locator('.policy').evaluate((node) => {
      const text = node.innerText;
      return {
        deposit: text.indexOf('Booking Deposit'),
        cancellations: text.indexOf('Cancellations & Rescheduling'),
        professionalHeading: text.indexOf('Professional Treatment Standards'),
        professional: text.indexOf('All treatments and services provided by Shiloh are strictly professional and non-sexual.'),
        appointments: text.indexOf('Appointments & Arrival'),
        health: text.indexOf('Health & Treatment Information'),
      };
    });
    expect(policyOrder.deposit).toBeGreaterThanOrEqual(0);
    expect(policyOrder.deposit).toBeLessThan(policyOrder.cancellations);
    expect(policyOrder.cancellations).toBeLessThan(policyOrder.professionalHeading);
    expect(policyOrder.professionalHeading).toBeLessThan(policyOrder.professional);
    expect(policyOrder.professional).toBeLessThan(policyOrder.appointments);
    expect(policyOrder.appointments).toBeLessThan(policyOrder.health);
    const policyOverflow = await policy.locator('.policy').evaluate((node) => getComputedStyle(node).overflowY);
    expect(policyOverflow).not.toBe('auto');
    expect(policyOverflow).not.toBe('scroll');

    const metrics = await policy.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      short: [...document.querySelectorAll('button,input:not([type="checkbox"]),a')]
        .filter((node) => node.getClientRects().length && node.getBoundingClientRect().height < 44)
        .length,
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.short).toBe(0);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-payment-policy-story]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`deposit-policy-before-ozow-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});


test('cancelled booking payment review is safe and actionable on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=workspace-production-surfaces--cancelled-booking-payment-review&viewMode=story', { waitUntil: 'networkidle' });

    const surface = page.locator('.workspace-surface-story');
    await expect(surface).toBeVisible();
    await expect(surface.getByText('Payment received after this booking was cancelled')).toBeVisible();
    await expect(surface.getByText('The booking stays cancelled. No refund has been issued automatically.')).toBeVisible();
    await expect(surface.getByText('Payment collection is disabled because this booking is cancelled.')).toBeVisible();
    await expect(surface.getByText('No further deposit should be collected.')).toBeVisible();
    await expect(surface.getByText('Cancelled booking', { exact: true })).toBeVisible();
    await expect(surface.getByText('Awaiting deposit', { exact: true })).toHaveCount(0);
    await expect(surface.getByText('Still needed', { exact: true })).toHaveCount(0);
    await expect(surface.getByRole('heading', { name: 'Record refund' })).toBeVisible();
    await expect(surface.locator('[data-payment-requests] [data-copy-link]')).toHaveCount(0);

    const metrics = await surface.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      short: [...document.querySelectorAll('button,input,select,a')]
        .filter((node) => node.getClientRects().length && node.getBoundingClientRect().height < 44)
        .length,
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.short).toBe(0);

    const accessibility = await new AxeBuilder({ page })
      .include('.workspace-surface-story')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`cancelled-booking-payment-review-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});


test('booking-created deposit retry status is clear on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/iframe.html?id=workspace-production-surfaces--deposit-message-retry&viewMode=story', { waitUntil: 'networkidle' });

    const status = page.locator('[data-booking-status]');
    await expect(status).toBeVisible();
    await expect(status).toContainText('BOOKING CREATED — DEPOSIT MESSAGE NOT SENT.');
    await expect(status).toContainText('Appointment #761 exists in Shiloh.');
    await expect(status).toContainText('Automatic retry is queued.');
    await expect(status).toContainText('required deposit');
    await expect(status).toHaveClass(/warn/);
    await expect(status).not.toHaveClass(/error/);

    const geometry = await status.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-booking-status]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`deposit-message-retry-${viewport.name}.png`),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
  }
});


test('in-clinic future-booking terms review is clear and accessible on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name:'phone', width:390, height:844 },
    { name:'desktop', width:1280, height:900 },
  ]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=client-in-person-booking-policy--awaiting-client-acceptance&viewMode=story', { waitUntil:'networkidle' });
    const surface = page.locator('[data-in-person-policy-story]');
    await expect(surface).toBeVisible();
    await expect(surface.getByRole('heading', { name:'Booking Policy & Terms' })).toBeVisible();
    await expect(surface.getByText('Naledi Mokoena')).toBeVisible();
    await expect(surface.getByText(/client must read and tap the acknowledgement themselves/i)).toBeVisible();
    await expect(surface.getByText(/staff must not accept on their behalf/i)).toBeVisible();
    await expect(surface.getByText(/Our therapists set aside this time especially for you/)).toBeVisible();
    await expect(surface.getByText('Marietjie')).toHaveCount(0);
    await expect(surface.getByText(/I have read and accept Shiloh’s Booking Policy & Terms/)).toBeVisible();

    const metrics = await surface.evaluate(() => ({
      viewportWidth:innerWidth,
      documentWidth:document.documentElement.scrollWidth,
      short:[...document.querySelectorAll('button,input,a')]
        .filter((node) => {
          if (!node.getClientRects().length) return false;
          const target = ['checkbox','radio'].includes(node.type) ? node.closest('label') : node;
          return !target || target.getBoundingClientRect().height < 44;
        })
        .map(node => node.textContent || node.getAttribute('aria-label') || node.tagName),
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.short).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-in-person-policy-story]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);

    await page.screenshot({
      path:testInfo.outputPath(`in-person-policy-${viewport.name}.png`),
      fullPage:true,animations:'disabled',caret:'hide',
    });
  }
});

test('Workspace client record shows policy history and booking readiness on Phone and Desktop', async ({ page }, testInfo) => {
  for (const viewport of [
    { name:'phone', width:390, height:844 },
    { name:'desktop', width:1280, height:900 },
  ]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=workspace-clients--marietjie-client-management&viewMode=story', { waitUntil:'networkidle' });
    const surface = page.locator('[data-story-surface]');
    await expect(surface).toBeVisible();
    await expect(surface.getByRole('heading', { name:'Booking Policy & Terms' })).toBeVisible();
    await expect(surface.getByText('2026-09-25-v3')).toBeVisible();
    await expect(surface.getByText(/In clinic on Shiloh device/)).toBeVisible();
    await expect(surface.getByText('✓ Terms accepted')).toBeVisible();
    await expect(surface.getByText('Deposit received')).toBeVisible();
    await expect(surface.getByText('✓ Confirmed')).toBeVisible();

    const metrics = await surface.evaluate(() => ({
      viewportWidth:innerWidth,
      documentWidth:document.documentElement.scrollWidth,
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-story-surface]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);

    await page.screenshot({
      path:testInfo.outputPath(`client-policy-history-${viewport.name}.png`),
      fullPage:true,animations:'disabled',caret:'hide',
    });
  }
});

test('future booking completion offers clinic-device review and the secure client-phone link on Phone and Desktop', async ({ page }, testInfo) => {
  await page.route('**/calendar/staff-auth/csrf', async route => route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({ csrfToken:'storybook-csrf' }),
  }));
  await page.route('**/calendar/book/client-search', async route => route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({
      clients:[{ id:91, displayName:'Naledi Mokoena', contactHint:'••67', profileStatus:'registered' }],
    }),
  }));
  await page.route('**/calendar/book/prepare', async route => route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({
      status:'pending_confirmation',
      review:{
        client:{ id:91, displayName:'Naledi Mokoena', contactHint:'••67', mobile:'082 123 4567' },
        service:{ id:81, name:'Quick Relief: Back & Neck (45 min)' },
        practitioner:{ id:11, displayName:'Christel' },
        startsAt:'2026-09-14T08:30:00.000Z',
        durationMinutes:45,
        price:'R520.00',
      },
    }),
  }));
  await page.route('**/calendar/book/confirm', async route => route.fulfill({
    status:201,contentType:'application/json',body:JSON.stringify({
      status:'created',
      appointmentId:812,
      policyReviewPath:'/calendar/book/policy/812',
      paymentPath:'/pay/dep_812_secure',
      customerConfirmation:{
        status:'deposit_request_sent',
        sent:false,
        retryable:false,
        reason:'deposit_required',
        paymentPath:'/pay/dep_812_secure',
      },
    }),
  }));

  for (const viewport of [
    { name:'phone', width:390, height:844 },
    { name:'desktop', width:1280, height:900 },
  ]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.goto('/iframe.html?id=workspace-production-surfaces--create-booking&viewMode=story', { waitUntil:'networkidle' });
    await page.locator('#client-search').fill('Naledi');
    await page.locator('[data-client-search]').click();
    await page.locator('.client-result').click();
    await page.locator('#service-select').selectOption('81');
    await page.locator('#staff-select').selectOption('11');
    await page.locator('[data-review-booking]').click();
    await expect(page.locator('[data-review-panel]')).toBeVisible();
    await page.locator('[data-create-booking]').click();

    const status = page.locator('[data-booking-status]');
    await expect(status).toContainText('BOOKING CREATED — DEPOSIT REQUEST SENT');
    await expect(status.getByRole('link', { name:'Let client review terms' })).toHaveAttribute('href', '/calendar/book/policy/812');
    await expect(status.getByRole('button', { name:'Copy secure link' })).toBeVisible();
    await expect(status.getByText(/same Booking Policy & Terms before deposit payment/)).toBeVisible();

    const accessibility = await new AxeBuilder({ page })
      .include('[data-booking-status]')
      .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])
      .analyze();
    expect(accessibility.violations.filter(v => ['serious','critical'].includes(v.impact))).toEqual([]);

    await page.screenshot({
      path:testInfo.outputPath(`future-booking-terms-options-${viewport.name}.png`),
      fullPage:true,animations:'disabled',caret:'hide',
    });
  }
});
