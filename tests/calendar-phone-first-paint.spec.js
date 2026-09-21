const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const {
  decoratePhoneCalendarV2,
  calendarPhoneCompactV2ClientScript,
} = require('../src/presentation/calendarPhoneCompactV2');

function phoneModel() {
  const staff = [{ id: 51, displayName: 'Jean-Pierre', schedulingType: 'regular' }];
  return {
    view: 'week',
    dateKey: '2026-09-21',
    period: { dateKeys: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'] },
    activeStaffId: 51,
    visibleStaffIds: [51],
    permittedStaff: staff,
    publicHolidays: [],
    timeline: { staff, workingWindows: [], scheduleExceptions: [], recurringClosures: [], closures: [], appointments: [], blocks: [], leave: [], externalBusy: [], events: [] },
    mutationCapability: { enabled: false, operations: [], calendarScope: 'own_staff' },
  };
}

function firstPaintHtml() {
  const source = '<!doctype html><html><head><style>:root{--leaf-deep:#17382d;--leaf:#496b5a;--leaf-soft:#dfeae3;--line:#dfe5df;--line-strong:#b8c9bf;--ink:#20322b;--muted:#5e7067}</style></head><body data-calendar-view="week"><div class="workspace-frame"><div class="workspace-main"><div class="shell"><h1>Calendar</h1><main class="calendar-view week-view"><div class="time-grid week-time-grid"><div class="week-grid"></div></div></main></div></div></div></body></html>';
  return decoratePhoneCalendarV2(source, {
    model: phoneModel(),
    basePath: '/calendar/read-only',
    bookingAllowed: false,
  }).replace(/<script src="[^"]+" defer><\/script>/, '');
}

test('phone navigation never paints the legacy Calendar before compact setup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(firstPaintHtml());

  const shell = page.locator('.workspace-main>.shell');
  await expect(shell).toHaveCSS('visibility', 'hidden');
  await expect(shell).toHaveCSS('opacity', '0');

  await page.addScriptTag({ content: calendarPhoneCompactV2ClientScript() });

  await expect(page.locator('body')).not.toHaveAttribute('data-calendar-phone-pending');
  await expect(shell).toHaveCSS('visibility', 'visible');
  await expect(shell).toHaveCSS('opacity', '1');
  await expect(page.locator('[data-phone-calendar-v2-controls]')).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include('.workspace-main').analyze();
  expect(accessibility.violations).toEqual([]);
});

test('desktop remains visible while the Phone-only guard is present', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(firstPaintHtml());
  await expect(page.locator('.workspace-main>.shell')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.workspace-main>.shell')).toHaveCSS('opacity', '1');
});
