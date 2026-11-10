const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const { once } = require('node:events');
const { renderCalendarGroupBookingPage, calendarGroupBookingClientScript } = require('../src/presentation/calendarGroupBookingUx');

const requestContext = { requestId: 42, revision: 'request-v1', organiser: { clientId: 201, name: 'Synthetic Organiser', mobile: '27810000201', revision: 'contact-v1' }, preferredDate: '2099-10-24', serviceDetail: 'Three friends planning massages', guestCount: 3, preferredDaypart: 'morning', occasionNote: 'Birthday', clientNote: 'Confirm treatments with each guest', returnTo: '/calendar/workspace#planning-request-42' };
const reviewKey = 'synthetic_review_key_12345678901';
const options = { requestContext, authority: { operatorAdminId: 7, canApplyDiscount: true }, guestBooking: { available: true }, services: [{ id: 81, name: 'Swedish Massage', durationMinutes: 60, price: 590, staffIds: [11, 12, 13] }], staff: [11, 12, 13].map((id, i) => ({ id, displayName: `Synthetic Practitioner ${i + 1}` })) };
let server, origin, state;
test.beforeEach(async () => {
  state = { prepares: [], confirms: [], discards: 0, discardPayloads: [], delayDiscard: null, failDiscard: false, failConfirm: false, delayPrepare: null, reviewContext: requestContext, confirmRequestId: 42, ordinaryBooking: false, offerPricing: false };
  const app = express(); app.use(express.json());
  app.get('/calendar/book/group', (_req, res) => res.send(renderCalendarGroupBookingPage({ options: state.ordinaryBooking ? { ...options, requestContext: null } : options, prefill: { date: requestContext.preferredDate } })));
  app.get('/calendar/book/group/client.js', (_req, res) => res.type('js').send(calendarGroupBookingClientScript()));
  app.post('/calendar/staff-auth/csrf', (_req, res) => res.json({ csrfToken: 'synthetic-csrf' }));
  app.post('/calendar/book/group/client-search', (_req, res) => res.json({ clients: [{ id: '201', name: 'Synthetic Organiser', displayName: 'Synthetic Organiser', mobile: '27810000201', profileStatus: 'complete', profileRevision: 'contact-v1' }] }));
  app.post('/calendar/book/group/prepare', async (req, res) => {
    state.prepares.push(req.body);
    if (state.delayPrepare) await state.delayPrepare;
    const startsAt = `${req.body.date}T${req.body.time}:00+02:00`;
    res.json({ review: { ...(state.ordinaryBooking ? {} : { requestContext: state.reviewContext, requestReviewKey: state.offerPricing ? String(state.prepares.length).padStart(32, 'q') : reviewKey }), ...(state.offerPricing ? { quoteHash: `synthetic-quote-${state.prepares.length}`, offerPricing: { discount: req.body.useMorningOffer ? 354 : 0, items: req.body.guests.map(() => ({ subtotal: 590, availableDiscount: 118, discount: req.body.useMorningOffer ? 118 : 0 })) } } : {}), guests: req.body.guests, startsAt, assignments: req.body.guests.map((_, i) => ({ service: options.services[0], practitioner: options.staff[i], startsAt })), pricing: { subtotal: 1770, total: state.offerPricing && req.body.useMorningOffer ? 1416 : 1770, allocations: Array(3).fill(state.offerPricing && req.body.useMorningOffer ? 472 : 590), discountAmount: 0 } } });
  });
  app.post('/calendar/book/group/discard', async (req, res) => { state.discards++; state.discardPayloads.push(req.body); if (state.delayDiscard) await state.delayDiscard; res.status(state.failDiscard ? 503 : 200).json(state.failDiscard ? { error: 'Synthetic discard unavailable' } : { ok: true }); });
  app.post('/calendar/book/group/confirm', (req, res) => { state.confirms.push(req.body); res.status(state.failConfirm ? 503 : 201).json(state.failConfirm ? { error: 'Synthetic interrupted response' } : { groupId: 501, ...(state.ordinaryBooking ? {} : { planningRequestId: state.confirmRequestId }), startsAt: '2099-10-25T07:00:00Z' }); });
  app.get('/calendar/read-only', (_req, res) => res.send('<!doctype html><html lang="en"><title>Synthetic calendar</title><main><h1>Synthetic calendar</h1></main></html>'));
  app.get('/calendar/workspace', (_req, res) => res.send('<!doctype html><html lang="en"><title>Synthetic requests</title><main><h1>Requests</h1><section id="planning-request-42">Group enquiry #42 remains open. Review linked group before confirming arranged.</section><a href="/calendar/book/group?request=42">Arrange booking</a></main></html>'));
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterEach(async () => { await new Promise(resolve => server.close(resolve)); });
async function open(page) { await page.goto(`${origin}/calendar/book/group?request=42`); }
async function fill(page) {
  for (let i = 0; i < 3; i++) { const card = page.locator('[data-guest]').nth(i); await card.locator('[data-name]').fill(`Synthetic Guest ${i + 1}`); await card.locator('[data-mobile]').fill(`082000000${i + 1}`); await card.locator('[data-service]').selectOption('81'); await card.locator('[data-staff]').selectOption(String(11 + i)); }
  await page.locator('#group-date').fill('2099-10-25'); await page.locator('#group-time').fill('09:00');
}
async function review(page) { await page.getByRole('button', { name: 'Review group booking' }).click(); await expect(page.locator('[data-group-review]')).toBeVisible(); }
for (const width of [390, 1440]) test(`enquiry contact stays separate from actual guests at ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await open(page);
  await expect(page.locator('[data-group-request]')).toContainText('Synthetic Organiser');
  await expect(page.locator('[data-group-request]')).toContainText('not automatically a guest');
  await expect(page.locator('#group-organiser-search')).toHaveCount(0);
  await expect(page.locator('#group-date')).toHaveValue('2099-10-24');
  await expect(page.locator('#group-time')).toHaveValue('');
  for (const card of await page.locator('[data-guest]').all()) { for (const selector of ['[data-client-id]', '[data-name]', '[data-mobile]', '[data-service]', '[data-staff]']) await expect(card.locator(selector)).toHaveValue(''); }
  await page.screenshot({ path: testInfo.outputPath(`group-enquiry-blank-${width}.png`), fullPage: true });
  await fill(page); await review(page);
  expect(state.prepares).toEqual([{ useMorningOffer: true, organiserClientId: 201, planningRequestId: 42, planningRequestRevision: 'request-v1', guests: [1, 2, 3].map(i => ({ clientId: null, name: `Synthetic Guest ${i}`, mobile: `082000000${i}`, dateOfBirth: '', gender: '', noMobile: false, firstVisitChoice: 'unknown', profileRevision: '' })), serviceIds: ['81', '81', '81'], staffIds: ['11', '12', '13'], startTimes: ['', '', ''], date: '2099-10-25', time: '09:00', discount: { type: 'none', value: '', reason: '' } }]);
  const rows = page.locator('[data-review-rows] .review-row');
  await expect(rows.filter({ hasText: /^Enquiry contact/ })).toContainText('Synthetic Organiser');
  await expect(rows.filter({ hasText: /^Guest \d/ })).toHaveCount(3);
  for (const row of await rows.filter({ hasText: /^Guest \d/ }).all()) await expect(row).not.toContainText('Synthetic Organiser');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`group-enquiry-review-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Create group booking' }).click(); await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-42`);
  expect(state.confirms).toEqual([{ reviewKey }]); await expect(page.locator('#planning-request-42')).toContainText('remains open');
});
test('organiser attends only after explicit existing-client selection', async ({ page }) => {
  await open(page); await fill(page); const card = page.locator('[data-guest]').first(); await card.locator('[data-client-search-input]').fill('Organiser'); await card.locator('[data-client-results] button').click(); await expect(card.locator('[data-client-id]')).toHaveValue('201'); await review(page);
  expect(state.prepares[0].guests[0].clientId).toBe('201'); await expect(page.locator('[data-review-rows] .review-row').filter({ hasText: /^Guest 1/ })).toContainText('Synthetic Organiser');
});
test('failed discard stays on request form; successful return discards and restores safe request anchor', async ({ page }) => {
  await open(page); await fill(page); await review(page); state.failDiscard = true; await page.getByRole('link', { name: 'Back to request' }).click(); await expect(page.locator('[data-group-status]')).toContainText('discard unavailable'); await expect(page).toHaveURL(/book\/group\?request=42$/); await expect(page.locator('[data-group-review]')).toBeVisible();
  state.failDiscard = false; await page.getByRole('link', { name: 'Back to request' }).click(); await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-42`); expect(state.discards).toBe(2); expect(state.discardPayloads).toEqual([{ planningRequestId: 42, requestDraftKey: reviewKey }, { planningRequestId: 42, requestDraftKey: reviewKey }]); expect(state.confirms).toEqual([]);
  await page.goBack(); await expect(page.locator('[data-group-review]')).toBeHidden(); await page.reload(); await expect(page.locator('[data-group-request]')).toContainText('Synthetic Organiser'); await page.goForward(); await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-42`);
});
test('in-flight prepare suppresses duplicates and rejects an edited stale response', async ({ page }) => {
  await open(page); await fill(page); let release; state.delayPrepare = new Promise(resolve => { release = resolve; }); await page.getByRole('button', { name: 'Review group booking' }).click(); await expect.poll(() => state.prepares.length).toBe(1); await expect(page.locator('[data-review-group]')).toBeDisabled();
  await page.locator('[data-review-group]').dispatchEvent('click'); await page.locator('#group-time').fill('10:00'); await page.getByRole('link', { name: 'Back to request' }).click(); await expect(page.locator('[data-group-status]')).toContainText('Finish checking'); release(); state.delayPrepare = null;
  await expect(page.locator('[data-group-status]')).toContainText('Details changed'); await expect(page.locator('[data-group-review]')).toBeHidden(); expect(state.prepares).toHaveLength(1); await review(page); expect(state.prepares[1].time).toBe('10:00');
});
test('interrupted confirmation survives reload and checks the same review key before returning', async ({ page }) => {
  await open(page); await fill(page); await review(page); state.failConfirm = true; await page.getByRole('button', { name: 'Create group booking' }).click(); await expect(page.getByRole('button', { name: 'Check booking result' })).toBeVisible(); await page.getByRole('link', { name: 'Back to request' }).click(); await expect(page.locator('[data-group-status]')).toContainText('Finish checking'); expect(state.discards).toBe(0);
  await page.reload(); await expect(page.getByRole('button', { name: 'Check booking result' })).toBeVisible(); await expect(page.locator('#group-date')).toBeDisabled(); state.failConfirm = false; await page.getByRole('button', { name: 'Check booking result' }).click(); await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-42`); expect(state.confirms).toEqual([{ reviewKey }, { reviewKey }]); expect(state.prepares).toHaveLength(1);
});
for (const width of [390, 1440]) test(`production-backed Storybook enquiry at ${width}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/iframe.html?id=calendar-group-enquiry-handover--enquiry-contact&viewMode=story');
  const frame = page.frameLocator('iframe[title="Synthetic group enquiry booking"]');
  await expect(frame.locator('[data-group-request]')).toContainText('Synthetic Organiser');
  await expect(frame.locator('[data-guest]')).toHaveCount(3);
  await expect(frame.locator('[data-guest]').first().locator('[data-name]')).toHaveValue('');
  expect(await frame.locator('html').evaluate(node => node.scrollWidth <= node.ownerDocument.defaultView.innerWidth)).toBe(true);
  // Storybook's finished phase follows its automatic afterEach accessibility audit.
  await page.waitForFunction(() => {
    const render = window.__STORYBOOK_PREVIEW__?.currentRender;
    return render?.id === 'calendar-group-enquiry-handover--enquiry-contact' && render.phase === 'finished';
  });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`group-enquiry-story-${width}.png`), fullPage: true });
});

test('a review for another enquiry cannot be confirmed', async ({ page }) => {
  await open(page); await fill(page); state.reviewContext = { ...requestContext, requestId: 43 };
  await page.getByRole('button', { name: 'Review group booking' }).click();
  await expect(page.locator('[data-group-status]')).toContainText('enquiry review changed');
  await expect(page.locator('[data-group-review]')).toBeHidden(); expect(state.confirms).toEqual([]);
});
test('enquiry handover preserves the three to ten actual guest limit', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-guest]')).toHaveCount(3);
  for (const button of await page.locator('[data-remove-guest]').all()) await expect(button).toBeHidden();
  for (let i = 3; i < 10; i++) await page.getByRole('button', { name: '+ Add guest', exact: true }).click();
  await expect(page.locator('[data-guest]')).toHaveCount(10); await expect(page.locator('[data-add-guest]')).toBeDisabled();
  await page.getByRole('button', { name: 'Remove Guest 10', exact: true }).click();
  await expect(page.locator('[data-guest]')).toHaveCount(9); await expect(page.locator('[data-add-guest]')).toBeEnabled();
  await expect(page.locator('[data-organiser-id]')).toHaveValue('201');
});

test('recovery returns to the committed enquiry rather than the currently open enquiry', async ({ page }) => {
  await open(page);
  await page.evaluate(key => sessionStorage.setItem('shiloh-group-guest-attempt:7', key), reviewKey);
  state.confirmRequestId = 43;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check booking result' })).toBeVisible();
  await page.getByRole('button', { name: 'Check booking result' }).click();
  await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-43`);
  expect(state.confirms).toEqual([{ reviewKey }]); expect(state.prepares).toEqual([]);
});

test('opening an enquiry then going Back performs no booking writes', async ({ page }) => {
  await open(page);
  await page.getByRole('link', { name: 'Back to request' }).click();
  await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-42`);
  expect(state.prepares).toEqual([]); expect(state.discardPayloads).toEqual([]); expect(state.confirms).toEqual([]);
});
test('editing a reviewed form retains its scoped draft key for Back discard', async ({ page }) => {
  await open(page); await fill(page); await review(page);
  await page.locator('#group-time').fill('10:00');
  await expect(page.locator('[data-group-review]')).toBeHidden();
  await page.getByRole('link', { name: 'Back to request' }).click();
  await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-42`);
  expect(state.discardPayloads).toEqual([{ planningRequestId: 42, requestDraftKey: reviewKey }]);
  expect(state.prepares).toHaveLength(1); expect(state.confirms).toEqual([]);
});
for (const action of ['Back to request', 'Edit details']) test(`pending ${action} discard blocks confirmation and review races`, async ({ page }) => {
  await open(page); await fill(page); await review(page);
  let release; state.delayDiscard = new Promise(resolve => { release = resolve; });
  try {
    await page.getByRole(action === 'Back to request' ? 'link' : 'button', { name: action, exact: true }).click();
    await expect.poll(() => state.discards).toBe(1);
    expect(state.discardPayloads).toEqual([{ planningRequestId: 42, requestDraftKey: reviewKey }]);
    // Dispatch directly even if controls become disabled, checking the handler guard too.
    await page.locator('[data-confirm-group]').dispatchEvent('click');
    await page.locator('[data-review-group]').dispatchEvent('click');
    await page.locator('[data-discard-group]').dispatchEvent('click');
    await page.locator('[data-group-request-return]').dispatchEvent('click');
    expect(state.confirms).toEqual([]); expect(state.prepares).toHaveLength(1); expect(state.discards).toBe(1);
  } finally { release(); state.delayDiscard = null; }
  if (action === 'Back to request') await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-42`);
  else { await expect(page.locator('[data-group-review]')).toBeHidden(); await expect(page.locator('[data-group-status]')).toContainText('Review discarded'); }
  expect(state.confirms).toEqual([]); expect(state.prepares).toHaveLength(1); expect(state.discards).toBe(1);
});

for (const ordinary of [false, true]) test(`Morning Welcome Offer toggles re-review and confirm the latest quote for ${ordinary ? 'ordinary booking' : 'enquiry handover'}`, async ({ page }) => {
  state.offerPricing = true; state.ordinaryBooking = ordinary;
  if (ordinary) await page.goto(`${origin}/calendar/book/group`);
  else await open(page);
  await expect(page.locator('[data-group-request]')).toHaveCount(ordinary ? 0 : 1);
  await fill(page); await review(page);
  const initialPayload = structuredClone(state.prepares[0]);
  expect(initialPayload.useMorningOffer).toBe(true);
  if (ordinary) {
    expect(initialPayload).not.toHaveProperty('planningRequestId');
    expect(initialPayload).not.toHaveProperty('planningRequestRevision');
    expect(initialPayload.organiserClientId).toBe('');
  } else {
    expect(initialPayload.planningRequestId).toBe(42);
    expect(initialPayload.planningRequestRevision).toBe('request-v1');
  }
  const offer = page.getByRole('checkbox', { name: /Apply Morning Welcome Offer/ });
  await expect(offer).toBeChecked();
  await offer.uncheck();
  await expect.poll(() => state.prepares.length).toBe(2);
  await expect(page.locator('[data-group-review]')).toBeVisible();
  await expect(offer).not.toBeChecked();
  await expect(page.locator('[data-group-status]')).toContainText('Review ready');
  await expect(page.locator('[data-group-status]')).not.toContainText('Details changed');
  expect(state.prepares[1]).toEqual({ ...initialPayload, useMorningOffer: false });
  await offer.check();
  await expect.poll(() => state.prepares.length).toBe(3);
  await expect(page.locator('[data-group-review]')).toBeVisible();
  await expect(offer).toBeChecked();
  await expect(page.locator('[data-group-status]')).toContainText('Review ready');
  await expect(page.locator('[data-group-status]')).not.toContainText('Details changed');
  expect(state.prepares[2]).toEqual({ ...initialPayload, useMorningOffer: true });
  await page.getByRole('button', { name: 'Create group booking' }).click();
  if (ordinary) await expect(page).toHaveURL(`${origin}/calendar/read-only?view=week&date=2099-10-25&staff=all`);
  else await expect(page).toHaveURL(`${origin}/calendar/workspace#planning-request-42`);
  expect(state.confirms).toEqual([{ quoteHash: 'synthetic-quote-3', ...(ordinary ? {} : { reviewKey: '3'.padStart(32, 'q') }) }]);
});
