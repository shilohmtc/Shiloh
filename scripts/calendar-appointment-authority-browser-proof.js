const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { calendarAppointmentDetailsClientScript } = require('../src/presentation/calendarAppointmentDetailsUx');
const { calendarAppointmentTreatmentPriceClientScript } = require('../src/presentation/calendarAppointmentTreatmentPriceUx');
const {
  decorateClientAppointmentHistory,
  decorateWorkspaceAppointmentLinks,
} = require('../src/presentation/calendarAppointmentDetailLinks');
const { renderCalendarRetrospectiveBookingPage } = require('../src/presentation/calendarRetrospectiveBookingV1Ux');

const output = path.join(process.cwd(), 'artifacts', 'calendar-appointment-authority-v1');
fs.mkdirSync(output, { recursive: true });

const states = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1440, height: 1000 } },
];

function installedChrome() {
  return [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function calendarFixture(editable) {
  const readiness = JSON.stringify({
    appointmentId:42,
    terms:{ state:'awaiting', policyVersion:'2026-09-25-v3' },
    deposit:{ state:'not_started', requiredAmount:null },
    confirmation:{ state:'pending' },
    policyActions: editable ? {
      policyVersion:'2026-09-25-v3',
      clinicPath:'/booking-policy/clinic_fixture_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      clientPath:'/booking-policy/client_fixture_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      clientMobile:'27820000000',
    } : null,
  });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--panel:#fff;--line:#dfe5df;--leaf-soft:#e7eee9;--leaf-deep:#294b3e}body{font-family:system-ui;background:#f7f5ef;padding:20px}.event-card{min-height:64px;border:1px solid #dfe5df;border-radius:14px;background:#fff;padding:14px;max-width:420px}.event-card h4{margin:4px 0}.event-meta{display:flex;gap:8px}.eyebrow{font-size:11px;text-transform:uppercase}</style><script>window.fetch=async function(url){if(String(url).includes('/calendar/book/readiness/42'))return new Response(${JSON.stringify(readiness)},{status:200,headers:{'Content-Type':'application/json'}});return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});};</script></head><body><article class="event-card" data-event-id="appointment-42" data-kind="appointment" data-canonical="true" ${editable ? 'data-appointment-management-target="true" data-appointment-id="42"' : ''} data-client-name="Client Example" data-client-mobile="+27 82 000 0000" data-service-name="Treatment Example" data-practitioner-names="Practitioner A" data-appointment-status="confirmed"><div class="event-time"><span class="event-time-range">09:00–10:00</span></div><span class="kind-pill">Appointment</span><h4>Client Example</h4><p class="event-client-mobile">+27 82 000 0000</p><p class="event-meta"><span class="event-practitioners">Practitioner A</span><span class="event-service-context"><span>Treatment Example</span></span><span class="event-state">confirmed</span></p></article><script>${calendarAppointmentDetailsClientScript()}</script></body></html>`;
}

function clientHistoryFixture() {
  const base = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;padding:20px;background:#f7f5ef}.history-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;padding:12px;border:1px solid #dfe5df;border-radius:12px;background:#fff;color:#20322b}.history-time{display:grid}.history-service{font-weight:700}</style></head><body><section class="history-list"><article class="history-row"><div class="history-time"><strong>11 Sep 2026</strong><small>09:00–10:00</small></div><div class="history-service">Treatment Example</div><div class="history-staff">Practitioner A</div><span>confirmed</span></article></section></body></html>';
  return decorateClientAppointmentHistory(base, [{ id: 42, starts_at: '2026-09-11T07:00:00.000Z' }]);
}

function workspaceFixture() {
  const base = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;padding:20px;background:#f7f5ef}.appointment{padding:12px;border:1px solid #dfe5df;border-radius:12px;background:#fff}.appointment-actions{margin-top:10px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 12px;border:1px solid #294b3e;border-radius:9px;text-decoration:none;color:#294b3e}</style></head><body><article class="appointment" data-dashboard-appointment="42" data-operational-date-key="2026-09-11"><div><strong>Client Example</strong><span> Treatment Example · Practitioner A</span></div><div class="appointment-actions"><a class="button" href="/calendar/read-only?view=week&amp;date=2026-09-11&amp;staff=all">Open / manage</a></div></article></body></html>';
  return decorateWorkspaceAppointmentLinks(base);
}

function treatmentPriceFixture() {
  const payload = JSON.stringify({
    status: 'ready',
    appointment: {
      id: 42,
      status: 'confirmed',
      currency: 'ZAR',
      chargedPrice: '500.00',
      revision: '2026-09-12T07:00:00.000Z',
      services: [{ serviceId: 1, name: 'Original Treatment', priceSnapshot: '500.00', durationMinutesSnapshot: 60, position: 1 }],
    },
    catalogue: [
      { id: 1, name: 'Original Treatment', standardPrice: '500.00', variablePrice: false, durationMinutes: 60 },
      { id: 2, name: 'Canonical Treatment', standardPrice: '650.00', variablePrice: false, durationMinutes: 60 },
    ],
  });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--panel:#fff;--line:#dfe5df;--line-strong:#ccd7d0;--leaf-soft:#e7eee9;--leaf-deep:#294b3e;--muted:#6c7d75}body{font-family:system-ui;background:#f7f5ef}.management-panel{position:fixed;inset:0;border:0;padding:0;width:100%;height:100%;background:transparent}.management-card{position:absolute;right:0;top:0;height:100%;width:min(430px,100%);overflow:auto;box-sizing:border-box;background:#fff;padding:22px}.panel-actions{display:grid;gap:14px}.eyebrow{font-size:11px;text-transform:uppercase}</style><script>window.fetch=async function(url){if(String(url).includes('/treatment-price'))return new Response(${JSON.stringify(payload)},{status:200,headers:{'Content-Type':'application/json'}});return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});};</script></head><body><dialog open class="management-panel" data-calendar-management-panel><section class="management-card"><header><span class="eyebrow">Appointment</span><h2>Appointment #42</h2></header><div class="panel-actions"></div></section></dialog><span data-calendar-operation-status></span><script>${calendarAppointmentTreatmentPriceClientScript()}</script><script>var panel=document.querySelector('[data-calendar-management-panel]');panel.dispatchEvent(new CustomEvent('shiloh:appointment-panel-open',{bubbles:true,detail:{appointment:{id:42}}}));</script></body></html>`;
}

function fileUrl(filePath, query = '') {
  const normalized = filePath.replace(/\\/g, '/');
  return `file://${normalized}${query}`;
}

(async () => {
  const executablePath = installedChrome();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const deepLinkFixturePath = path.join(output, 'calendar-deep-link-fixture.html');
    fs.writeFileSync(deepLinkFixturePath, calendarFixture(false));

    for (const state of states) {
      const page = await browser.newPage({ viewport: state.viewport });
      await page.setContent(calendarFixture(false));
      const card = page.locator('.event-card');
      if ((await card.getAttribute('role')) !== 'button') throw new Error(`${state.name}: visible appointment is not interactive`);
      await card.click();
      await page.locator('[data-appointment-details-dialog][open]').waitFor();
      if (await page.locator('[data-details-edit]').isVisible()) throw new Error(`${state.name}: read-only viewer received edit action`);
      await page.locator('[data-details-readiness-body]').filter({ hasText:'Terms awaiting acceptance' }).waitFor();
      if ((await page.locator('.readiness-actions').count()) !== 0) throw new Error(`${state.name}: read-only viewer received policy acceptance actions`);
      await page.screenshot({ path: path.join(output, `${state.name}-appointment-details.png`), fullPage: true });

      await page.goto(fileUrl(deepLinkFixturePath, '?view=day&date=2026-09-11&appointment=42&staff=all'));
      await page.locator('[data-appointment-details-dialog][open]').waitFor();
      if ((await page.locator('[data-details-title]').textContent()) !== 'Appointment #42') throw new Error(`${state.name}: canonical deep link did not open appointment 42`);
      await page.screenshot({ path: path.join(output, `${state.name}-appointment-deep-link.png`), fullPage: true });

      // page.setContent preserves the current URL. Reset after the selected-appointment
      // navigation so subsequent fixtures are not auto-opened by ?appointment=42.
      await page.goto('about:blank');
      await page.setContent(calendarFixture(true));
      await page.locator('.event-card').click();
      await page.locator('[data-appointment-details-dialog][open]').waitFor();
      if (!(await page.locator('[data-details-edit]').isVisible())) throw new Error(`${state.name}: editor did not receive edit handoff`);
      await page.locator('[data-details-readiness-body]').filter({ hasText:'Terms awaiting acceptance' }).waitFor();
      if ((await page.getByText('Let client review terms').count()) !== 1) throw new Error(`${state.name}: clinic-device policy action missing`);
      if ((await page.getByText('Send link in WhatsApp').count()) !== 1) throw new Error(`${state.name}: client-phone policy action missing`);
      await page.screenshot({ path: path.join(output, `${state.name}-appointment-readiness-actions.png`), fullPage: true });

      await page.setContent(clientHistoryFixture());
      const historyLink = page.locator('[data-appointment-detail-link="42"]');
      if ((await historyLink.count()) !== 1) throw new Error(`${state.name}: Client History appointment drill-in missing`);
      const historyHref = await historyLink.getAttribute('href');
      if (!historyHref || !historyHref.includes('appointment=42') || !historyHref.includes('staff=all')) throw new Error(`${state.name}: Client History did not target canonical appointment detail`);
      if (state.name === 'phone') {
        const box = await historyLink.boundingBox();
        if (!box || box.height < 44) throw new Error('phone: Client History target below 44px');
      }
      await page.screenshot({ path: path.join(output, `${state.name}-client-history-drill-in.png`), fullPage: true });

      await page.setContent(workspaceFixture());
      const workspaceLink = page.locator('[data-appointment-detail-link="42"]');
      if ((await workspaceLink.count()) !== 1) throw new Error(`${state.name}: Workspace appointment drill-in missing`);
      const workspaceHref = await workspaceLink.getAttribute('href');
      if (!workspaceHref || !workspaceHref.includes('appointment=42')) throw new Error(`${state.name}: Workspace did not target canonical appointment detail`);
      if (state.name === 'phone') {
        const box = await workspaceLink.boundingBox();
        if (!box || box.height < 44) throw new Error('phone: Workspace Open / manage target below 44px');
      }
      await page.screenshot({ path: path.join(output, `${state.name}-workspace-drill-in.png`), fullPage: true });

      await page.setContent(treatmentPriceFixture());
      const treatmentForm = page.locator('[data-treatment-price-form]');
      await treatmentForm.waitFor();
      if ((await treatmentForm.locator('select[name="serviceId"] option').count()) !== 2) throw new Error(`${state.name}: canonical treatment choices missing`);
      if ((await treatmentForm.locator('input[name="chargedPrice"]').inputValue()) !== '500.00') throw new Error(`${state.name}: appointment charged price missing`);
      await treatmentForm.locator('select[name="serviceId"]').selectOption('2');
      if (!String(await treatmentForm.locator('[data-treatment-price-catalogue]').textContent()).includes('R650.00')) throw new Error(`${state.name}: canonical Services standard price context missing`);
      if (state.name === 'phone') {
        for (const selector of ['select[name="serviceId"]', 'input[name="chargedPrice"]', 'button[type="submit"]']) {
          const box = await treatmentForm.locator(selector).boundingBox();
          if (!box || box.height < 44) throw new Error(`phone: ${selector} target below 44px`);
        }
      }
      await page.screenshot({ path: path.join(output, `${state.name}-appointment-treatment-price.png`), fullPage: true });

      const past = renderCalendarRetrospectiveBookingPage({ options: { staff: [{ id: 1, displayName: 'Practitioner A', serviceIds: [1] }], services: [{ id: 1, name: 'Canonical Treatment', durationMinutes: 60, staffIds: [1] }] } });
      await page.setContent(past.replace(/<script src="[^"]+" defer><\/script>/, ''));
      await page.selectOption('#past-service', 'custom');
      await page.locator('[data-custom-service-field]').evaluate(el => { el.hidden = false; });
      if ((await page.locator('#past-custom-service').count()) !== 1) throw new Error(`${state.name}: Custom service field missing`);
      if ((await page.locator('[data-add-past]').count()) !== 1) throw new Error(`${state.name}: Add New Appointment action missing`);
      const minHeight = await page.locator('.button').first().evaluate(el => getComputedStyle(el).minHeight);
      if (state.name === 'phone' && Number.parseFloat(minHeight) < 44) throw new Error('phone: interaction target below 44px');
      await page.screenshot({ path: path.join(output, `${state.name}-past-appointment.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
})();
