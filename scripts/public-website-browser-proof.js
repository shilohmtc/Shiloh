const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { renderHome, renderTreatments } = require('../src/services/publicWebsite');

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
    await assertAccessible(phone, 'Phone home');
    await phone.screenshot({
      path: path.join(evidenceDir, 'phone-home-390x844.png'),
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
    if ((await desktop.locator('.treatment-card a[href="/book"]').count()) !== catalogue.length)
      throw new Error('Every treatment CTA must route to /book');
    await assertAccessible(desktop, 'Desktop treatments');
    await desktop.screenshot({
      path: path.join(evidenceDir, 'desktop-treatments-1440x1000.png'),
      fullPage: true,
    });
    await desktopContext.close();

    console.log(
      'Public Website V1 browser proof passed: Phone 390x844 + Desktop 1440x1000 + accessibility.',
    );
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
