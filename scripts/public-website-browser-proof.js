const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderHome, renderTreatments } = require('../src/services/publicWebsite');
const { renderBookingPage } = require('../src/services/publicBookingPageEditorial');

const catalogue = [
  {
    id: 1,
    name: 'Deep Tissue Massage',
    category: 'Massage',
    duration: '60 min',
    price: 'R850',
    description: 'Focused therapeutic massage.',
  },
  {
    id: 2,
    name: 'Signature Pedicure',
    category: 'Pedicures & Foot Care',
    duration: '75 min',
    price: 'R620',
    description: 'Restorative foot care.',
  },
  {
    id: 3,
    name: 'Hydrating Facial',
    category: 'Aesthetic Care',
    duration: '60 min',
    price: 'R720',
    description: 'Hydrating facial care.',
  },
  {
    id: 4,
    name: 'SQT Rejuvenation BioMicroneedling',
    category: '1. SQT BioMicroneedling',
    duration: '90 min',
    price: 'R1785-R2585',
  },
  {
    id: 5,
    name: 'Permanent Makeup - Brows',
    category: 'Permanent Makeup',
    duration: '180 min',
    price: 'R1950-R2200',
  },
  {
    id: 6,
    name: 'Pelvic Floor Strengthening',
    category: 'Neo Pelvic Therapy',
    duration: '30 min',
    price: 'R350-R450',
  },
  {
    id: 7,
    name: 'Shiloh Consultation',
    category: 'Services',
    duration: '30 min',
    price: 'Price on consultation',
  },
];

function withPreviewBase(html) {
  return html.replace('<head>', '<head><base href="https://preview.shiloh.test/">');
}

async function wireAssets(page) {
  await page.route('https://preview.shiloh.test/assets/**', async (route) => {
    const relativePath = new URL(route.request().url()).pathname.replace(/^\//, '');
    const filePath = path.join(process.cwd(), 'public', relativePath);
    if (!fs.existsSync(filePath)) return route.abort();
    return route.fulfill({ path: filePath });
  });
}

async function assertAccessible(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact),
  );
  if (blocking.length)
    throw new Error(
      `${label} has blocking accessibility violations: ${blocking
        .map((item) => `${item.id} (${item.nodes.map((node) => node.target.join(' ')).join(', ')})`)
        .join(', ')}`,
    );
}

async function run() {
  const evidenceDir = path.join(process.cwd(), 'artifacts', 'public-website-v1');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    const phone = await phoneContext.newPage();
    await wireAssets(phone);
    await phone.setContent(withPreviewBase(renderHome(catalogue)), { waitUntil: 'networkidle' });
    if (!(await phone.locator('.mobile-book').isVisible()))
      throw new Error('Phone sticky booking CTA must be visible');
    if (!(await phone.locator('.mobile-nav').isVisible()))
      throw new Error('Phone navigation menu must be visible');
    if (await phone.locator('.site-nav').isVisible())
      throw new Error('Phone full navigation must be condensed');
    const phoneTargetHeight = await phone
      .locator('.mobile-book')
      .evaluate((node) => node.getBoundingClientRect().height);
    if (phoneTargetHeight < 44)
      throw new Error(`Phone booking target must be at least 44px; got ${phoneTargetHeight}`);
    const phoneColumns = await phone
      .locator('.home-hero-grid')
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    if (phoneColumns.split(' ').filter(Boolean).length !== 1)
      throw new Error(`Phone hero must collapse to one column; got ${phoneColumns}`);
    if (!(await phone.locator('[data-public-visit-shiloh]').isVisible()))
      throw new Error('Phone home must show the Heidelberg town-centre story');
    const phoneLocalColumns = await phone
      .locator('[data-public-visit-shiloh]')
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    if (phoneLocalColumns.split(' ').filter(Boolean).length !== 1)
      throw new Error(`Phone local story must collapse to one column; got ${phoneLocalColumns}`);
    if ((await phone.locator('[data-public-visit-shiloh] .neighbour-list li').count()) !== 8)
      throw new Error('Phone local story must use the approved neighbour authority');
    await assertAccessible(phone, 'Phone home');
    await phone.screenshot({
      path: path.join(evidenceDir, 'phone-home-390x844.png'),
      fullPage: true,
    });

    await phone.setContent(
      withPreviewBase(renderBookingPage('27830000000', catalogue, catalogue[0].id)),
      { waitUntil: 'networkidle' },
    );
    if (!(await phone.locator('.selection-summary').isVisible()))
      throw new Error('Phone booking must show the saved service summary');
    if (!(await phone.locator('#service-1.selected[data-selected-service="true"]').isVisible()))
      throw new Error('Phone booking must highlight the canonical selected service');
    const phoneWhatsAppUrl = await phone.locator('.mobile-book').getAttribute('href');
    if (!decodeURIComponent(phoneWhatsAppUrl || '').includes('Deep Tissue Massage'))
      throw new Error('Phone WhatsApp handoff must preserve the selected service');
    await assertAccessible(phone, 'Phone booking selection');
    await phone.screenshot({
      path: path.join(evidenceDir, 'phone-booking-selection-390x844.png'),
      fullPage: true,
    });
    await phoneContext.close();

    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    const desktop = await desktopContext.newPage();
    await wireAssets(desktop);
    await desktop.setContent(withPreviewBase(renderHome(catalogue)), { waitUntil: 'networkidle' });
    if (!(await desktop.locator('.site-nav a[href="/treatments"]').isVisible()))
      throw new Error('Desktop full navigation must be visible');
    if (await desktop.locator('.mobile-book').isVisible())
      throw new Error('Desktop must not show the phone sticky CTA');
    const desktopColumns = await desktop
      .locator('.home-hero-grid')
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    if (desktopColumns.split(' ').filter(Boolean).length !== 2)
      throw new Error(`Desktop hero must retain two columns; got ${desktopColumns}`);
    const desktopLocalColumns = await desktop
      .locator('[data-public-visit-shiloh]')
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    if (desktopLocalColumns.split(' ').filter(Boolean).length !== 2)
      throw new Error(`Desktop local story must retain two columns; got ${desktopLocalColumns}`);
    if ((await desktop.locator('[data-public-visit-shiloh] .neighbour-list li').count()) !== 8)
      throw new Error('Desktop local story must use the approved neighbour authority');
    if ((await desktop.locator('[data-public-service-category]').count()) !== 7)
      throw new Error('Desktop home must show the seven public service families');
    if ((await desktop.getByRole('heading', { name: 'Advanced Aesthetics' }).count()) !== 1)
      throw new Error('Desktop home must replace administrative aesthetic category labels');
    await assertAccessible(desktop, 'Desktop home');
    await desktop.screenshot({
      path: path.join(evidenceDir, 'desktop-home-1440x1000.png'),
      fullPage: true,
    });

    await desktop.setContent(withPreviewBase(renderTreatments(catalogue)), {
      waitUntil: 'networkidle',
    });
    if (
      (await desktop.locator('[data-public-treatment-catalogue] .treatment-card').count()) !==
      catalogue.length
    )
      throw new Error('Treatments must render the exact supplied catalogue fixture');
    if (
      (await desktop.locator('.treatment-card a[href^="/book?service="]').count()) !==
      catalogue.length
    )
      throw new Error('Every treatment CTA must preserve its canonical service ID');
    if (
      (await desktop.locator('.treatment-card a[href="/book?service=1#service-1"]').count()) !== 1
    )
      throw new Error('Deep Tissue Massage must link to its canonical booking selection');
    if ((await desktop.locator('[data-public-category-navigation] a').count()) !== 7)
      throw new Error('Desktop treatments must expose the seven public service families');
    if ((await desktop.getByRole('heading', { name: 'Body & Wellness' }).count()) !== 1)
      throw new Error('Desktop treatments must use the Body & Wellness public family');
    await assertAccessible(desktop, 'Desktop treatments');
    await desktop.screenshot({
      path: path.join(evidenceDir, 'desktop-treatments-1440x1000.png'),
      fullPage: true,
    });

    await desktop.setContent(
      withPreviewBase(renderBookingPage('27830000000', catalogue, catalogue[0].id)),
      { waitUntil: 'networkidle' },
    );
    if (!(await desktop.locator('.selection-summary').isVisible()))
      throw new Error('Desktop booking must show the saved service summary');
    if (!(await desktop.locator('#service-1.selected[data-selected-service="true"]').isVisible()))
      throw new Error('Desktop booking must highlight the canonical selected service');
    const desktopWhatsAppUrl = await desktop.locator('.cta').getAttribute('href');
    if (!decodeURIComponent(desktopWhatsAppUrl || '').includes('Deep Tissue Massage'))
      throw new Error('Desktop WhatsApp handoff must preserve the selected service');
    await assertAccessible(desktop, 'Desktop booking selection');
    await desktop.screenshot({
      path: path.join(evidenceDir, 'desktop-booking-selection-1440x1000.png'),
      fullPage: true,
    });
    await desktopContext.close();

    console.log(
      'Public Website V1 browser proof passed: Phone 390x844 + Desktop 1440x1000 + booking continuity + accessibility.',
    );
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
