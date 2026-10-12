const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');
const { calendarAppointmentDetailsClientScript } = require('../src/presentation/calendarAppointmentDetailsUx');
const { renderEventCard } = require('../src/presentation/calendarReadOnlyUx');

for (const viewport of [{ name:'phone',width:390,height:844 },{ name:'desktop',width:1440,height:960 }]) {
  test(`linked pairs, completed notes, retry and permissions in Storybook on ${viewport.name}`, async ({ page },testInfo) => {
    await page.setViewportSize(viewport);
    let completed=false, denied=false, saves=[];
    const state=()=>({groupId:71,revision:'2026-10-01T08:00:00.000Z',startsAt:'2026-11-02T08:00:00.000Z',canMove:!completed,
      explanation:completed?'You can update booking notes. Date, time, treatments, prices and completion records stay protected.':'Move both visits together without changing their durations. Each guest keeps separate booking notes.',
      members:[101,102].map((id,index)=>({appointmentId:id,name:'Synthetic Guest '+(index?'B':'A'),treatment:'Massage '+(index?'B':'A'),status:completed?'completed':'scheduled',startsAt:'2026-11-02T08:00:00.000Z',endsAt:index?'2026-11-02T09:00:00.000Z':'2026-11-02T09:30:00.000Z',notes:index?'Second note':'First note',revision:'2026-10-01T08:00:00.000Z'}))});
    await page.route('**/calendar/operations/appointments/*/couples',async route=>{
      if(route.request().method()==='GET')return route.fulfill({status:denied?403:200,json:denied?{error:'This pair is outside your appointment scope.'}:state()});
      saves.push(route.request().postDataJSON());return route.fulfill({status:409,json:{error:'One of the appointments changed. Reload the pair before saving.'}});
    });
    await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic-token'}}));
    await page.goto('/iframe.html?id=calendar-couples-editing--linked-pair&viewMode=story',{waitUntil:'networkidle'});
    const frame=page.frameLocator('iframe[title="Synthetic couples appointment editor"]');
    // Storybook must carry the exact production script for this head.
    const fixture=fs.readFileSync('stories/fixtures/calendarCouplesEditing.html','utf8');
    expect(fixture).toContain(calendarAppointmentDetailsClientScript());
    const model={mutationCapability:{enabled:true,operations:['appointment:reschedule'],calendarScope:'all_business',serviceScope:'all_services'}};
    const item={kind:'appointment',id:501,status:'completed',appointmentGroupType:'couples_massage',appointmentGroupId:71,staffIds:[11],serviceContexts:[{serviceId:21}]};
    expect(renderEventCard(item,model)).toContain('data-couples-edit-target="true"');
    expect(renderEventCard(item,{...model,mutationCapability:{enabled:false}})).not.toContain('data-couples-edit-target');
    for(const id of [101,102]) {
      await frame.locator(`[data-event-id="appointment-${id}"]`).focus();await page.keyboard.press('Enter');
      const details=frame.locator('[data-appointment-details-dialog]');
      await expect(details.getByRole('button',{name:'Edit couples booking'})).toBeVisible();
      if(id===101)await page.screenshot({path:testInfo.outputPath(`couples-details-${viewport.name}.png`),fullPage:true});
      await details.getByRole('button',{name:'Edit couples booking'}).click();
      const editor=frame.locator('[data-couples-edit-dialog]');
      await expect(editor.getByText('Synthetic Guest A · Appointment #101')).toBeVisible();
      await expect(editor.getByText('Synthetic Guest B · Appointment #102')).toBeVisible();
      await expect(editor.getByLabel('Date',{exact:true})).toBeVisible();
      await expect(editor.getByLabel('Start time',{exact:true})).toHaveValue('10:00');
      await page.screenshot({path:testInfo.outputPath(`couples-edit-${viewport.name}-${id}.png`),fullPage:true});
      await editor.getByRole('button',{name:'Save couples booking'}).scrollIntoViewIfNeeded();
      expect((await editor.getByRole('button',{name:'Save couples booking'}).boundingBox()).height).toBeGreaterThanOrEqual(44);
      await page.screenshot({path:testInfo.outputPath(`couples-edit-actions-${viewport.name}-${id}.png`),fullPage:true});
      await editor.getByRole('button',{name:'Close couples editor'}).click();
    }
    completed=true;
    await frame.locator('.event-card').evaluateAll(cards=>cards.forEach(card=>{card.dataset.eventTone='completed';card.querySelector('.event-state').textContent='completed';}));
    await frame.locator('[data-event-id="appointment-102"]').click();
    await frame.getByRole('button',{name:'Edit couples booking'}).click();
    const editor=frame.locator('[data-couples-edit-dialog]');
    await expect(editor.getByLabel('Booking notes for Synthetic Guest A')).toHaveValue('First note');
    await expect(editor.getByLabel('Date',{exact:true})).toBeHidden();
    await editor.getByLabel('Booking notes for Synthetic Guest A').fill('Synthetic completed correction');
    await editor.getByRole('button',{name:'Save couples booking'}).click();
    await expect(editor.getByRole('status')).toContainText('One of the appointments changed');
    await editor.getByRole('button',{name:'Save couples booking'}).click();
    await expect.poll(()=>saves.length).toBe(2);expect(saves[0]).toEqual(saves[1]);expect(saves[0].startsAt).toBeUndefined();
    expect(saves[0].members.map(row=>row.appointmentId)).toEqual([101,102]);
    await expect(editor.getByLabel('Booking notes for Synthetic Guest A')).toHaveValue('Synthetic completed correction');
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`couples-completed-${viewport.name}.png`),fullPage:true});
    if(viewport.name==='phone') {
      await page.setViewportSize({width:320,height:844});
      await frame.locator('html').evaluate(node=>{node.style.fontSize='200%';});
      await editor.getByRole('button',{name:'Save couples booking'}).scrollIntoViewIfNeeded();
      expect(await editor.locator('.appointment-details-card').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath('couples-completed-narrow-text.png'),fullPage:true});
      await frame.locator('html').evaluate(node=>{node.style.fontSize='';});await page.setViewportSize(viewport);
    }
    await page.keyboard.press('Escape');denied=true;
    await frame.locator('[data-event-id="appointment-101"]').click();await frame.getByRole('button',{name:'Edit couples booking'}).click();
    await expect(editor.getByRole('status')).toContainText('outside your appointment scope');
    await expect(editor.locator('form')).toBeHidden();
    expect(await editor.getByText('Synthetic Guest B · Appointment #102').isVisible()).toBe(false);
    // Retain the pixels independently of the general test-results directory.
    fs.mkdirSync('artifacts/couples-edit-review',{recursive:true});
    for(const filename of fs.readdirSync(testInfo.outputDir).filter(name=>name.endsWith('.png')))fs.copyFileSync(path.join(testInfo.outputDir,filename),path.join('artifacts/couples-edit-review',filename));
  });
}
