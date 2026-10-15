const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');
const { calendarHtml, messagesHtml, clientsHtml, rewardsHtml, dashboardHtml } = require('../stories/fixtures/workspaceBrowserReview');

test.beforeEach(async ({page}) => {
  await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
});
for (const empty of [true,false]) {
  test(`approved Team day hourly controls retain geometry, practitioner and navigation after reload (${empty?'empty':'populated'})`, async ({page}) => {
    await page.setViewportSize({width:1180,height:757});
    await page.goto(`/iframe.html?id=workspace-browser-review--${empty?'empty':'populated'}-team-day&viewMode=story`,{waitUntil:'networkidle'});
    const frame = page.frameLocator('iframe[title="Synthetic browser review"]');
    for (const reload of [false,true]) {
      if(reload) await page.reload({waitUntil:'networkidle'});
      await expect(frame.locator('.desktop-practitioner-grid')).toBeVisible();
      for (const staffId of [41,42]) {
        const slots = frame.locator(`.desktop-practitioner-lane[data-staff-id="${staffId}"] [data-calendar-booking-slot]`);
        await expect(slots).toHaveCount(11);
        const geometry = await slots.evaluateAll(nodes=>nodes.map(n=>({top:n.getBoundingClientRect().top,time:n.dataset.time,href:n.getAttribute('href'),staff:n.dataset.staffId,position:getComputedStyle(n).position})));
        for (let hour=0;hour<11;hour++) {
          expect(geometry[hour].position).toBe('absolute');
          expect(geometry[hour].time).toBe(String(7+hour).padStart(2,'0')+':00');
          expect(geometry[hour].staff).toBe(String(staffId));
          const url=new URL(geometry[hour].href,'http://localhost');
          expect(url.searchParams.get('date')).toBe('2026-10-14');expect(url.searchParams.get('staff')).toBe(String(staffId));expect(url.searchParams.get('time')).toBe(geometry[hour].time);
          expect(geometry[hour].top-geometry[0].top).toBeCloseTo(hour*72,0);
        }
      }
      if(!empty) expect(await frame.locator('.desktop-practitioner-lane[data-staff-id="42"] .event-card').count()).toBe(1);
    }
  });
}

for (const width of [1180,500]) test(`Messages Open booking opens the exact visible appointment and Back restores the selected Messages view at ${width}px`,async ({page})=>{
  await page.setViewportSize({width,height:757});
  await page.route('**/calendar/messages**',r=>r.fulfill({contentType:'text/html',body:messagesHtml()}));
  await page.route('**/calendar/read-only**',r=>r.fulfill({contentType:'text/html',body:calendarHtml(false)}));
  await page.goto('/calendar/messages?view=attention');
  await page.locator('[data-message-attention]').getByRole('link',{name:'Open booking',exact:true}).click();
  await expect(page).toHaveURL(/date=2026-10-14.*appointment=9101/);
  await expect(page.locator('[data-appointment-details-dialog]')).toBeVisible();
  await expect(page.locator('[data-details-title]')).toHaveText('Appointment #9101');
  await expect(page.locator('body')).not.toHaveAttribute('data-calendar-phone-pending','true');
  await page.getByRole('button',{name:'Close appointment details',exact:true}).click();
  await expect(page.locator('.event-card[data-event-id="appointment-9101"]:visible')).toHaveCount(1);
  await page.getByRole('link',{name:'Back to Messages',exact:true}).click();
  await expect(page).toHaveURL(/\/calendar\/messages\?view=attention$/);
  await page.locator('[data-message-attention]').getByRole('link',{name:'Open booking',exact:true}).click();await page.goBack();
  await expect(page).toHaveURL(/\/calendar\/messages\?view=attention$/);
});

for (const viewport of [{width:1180,height:757},{width:500,height:757},{width:320,height:757}]) {
  test(`synthetic Rewards, Clients and Today layout and accessibility at ${viewport.width}px`,async ({page})=>{
    await page.setViewportSize(viewport);
    for(const [name,html] of [['rewards',rewardsHtml()],['clients',clientsHtml()],['dashboard',dashboardHtml()]]) {
      await page.route(`**/review-${name}`,r=>r.fulfill({contentType:'text/html',body:html}));
      await page.goto(`/review-${name}`,{waitUntil:'networkidle'});
      await expect(page.locator('.workspace-main')).toBeVisible();
      if(name==='rewards') {
        for(const zoom of [1,2]) {
          await page.evaluate(scale=>document.documentElement.style.fontSize=`${16*scale}px`,zoom);
          const menu=await page.locator('.workspace-menu-toggle').boundingBox(),heading=await page.locator('h1').boundingBox();
          if(viewport.width<=700) expect(heading.x).toBeGreaterThanOrEqual(menu.x+menu.width);
          expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
          for(const input of await page.locator('.adjust input,.adjust select').all()) expect((await input.boundingBox()).width).toBeLessThanOrEqual(viewport.width);
        }
        await page.evaluate(()=>document.documentElement.style.fontSize='16px');
      }
      if(name==='clients') {
        await expect(page.locator('.client-last')).toContainText('Last appointment:');
        if(viewport.width<=700) expect((await page.locator('.search-panel').boundingBox()).y).toBeLessThan((await page.locator('[data-client-create-panel]').boundingBox()).y);
      }
      if(name==='dashboard') {
        const summary=page.locator('[data-dashboard-today] .day-summary');
        await expect(summary).toContainText('1 appointment');await expect(summary).toContainText('2 pending requests');await expect(summary).toContainText('1 holiday decision');await expect(summary).not.toContainText('awaiting outcome');
        await expect(page.locator('[data-dashboard-attention-panel]>.panel-head .summary-pill')).toHaveText('3');
        if(viewport.width>1050) {
          const card=await page.locator('.team-group').boundingBox(),panel=await page.locator('[data-dashboard-today]').boundingBox();expect(card.width).toBeGreaterThan(panel.width*.8);
        }
      }
      const axe=await new AxeBuilder({page}).include('.workspace-main').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    }
  });
}

for (const width of [1180,1440,500]) {
  test(`multiple team cards fill available columns and retain appointment identity at ${width}px`, async ({page}) => {
    const { dashboardModel } = require('../stories/fixtures/workspaceBrowserReview');
    const { renderDashboardPage } = require('../src/presentation/workspaceDashboardUx');
    const model=dashboardModel(), original=model.appointments[0];
    model.calendar.timeline.staff=[41,42,43].map(id=>({id,displayName:'Synthetic Team '+id}));
    model.appointments=[41,42,43].map((id,index)=>({...original,id:9201+index,staffIds:[id],clientName:'Synthetic Guest '+index}));
    model.teamGroups=model.appointments.map((appointment,index)=>({key:String(41+index),label:'Synthetic Team '+(41+index),appointments:[appointment]}));
    await page.setViewportSize({width,height:757});
    await page.route('**/review-multiple-team',route=>route.fulfill({contentType:'text/html',body:renderDashboardPage(model)}));
    await page.goto('/review-multiple-team',{waitUntil:'networkidle'});
    const groups=page.locator('[data-dashboard-team-group]');await expect(groups).toHaveCount(3);
    await expect(page.locator('[data-dashboard-today] .day-summary')).toContainText('3 appointments');
    const grid=await page.locator('.team-groups').boundingBox();
    const columns=width>=1400?3:1;
    for(let index=0;index<3;index++) {
      const group=groups.nth(index),box=await group.boundingBox();
      expect(box.width).toBeCloseTo((grid.width-(columns-1)*10)/columns,0);
      await expect(group.locator('[data-dashboard-appointment]')).toHaveAttribute('data-dashboard-appointment',String(9201+index));
      await expect(group).toContainText('Synthetic Guest '+index);
      const action=group.getByRole('link',{name:'Open / manage'});expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    const empty=await page.locator('[data-dashboard-carryover-panel] .empty').boundingBox();expect(empty.height).toBeLessThan(100);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
