const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {planningRequestClientScript}=require('../src/presentation/workspaceDashboardUx');
const pastBooking=require('../src/presentation/calendarRetrospectiveBookingV1Ux');

for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1365,height:950}]){
  async function open(page){
    await page.setViewportSize(viewport);
    await page.route('**/calendar/staff-auth/csrf',route=>route.fulfill({json:{csrfToken:'synthetic-csrf'}}));
    await page.goto('/iframe.html?id=client-planning-requests--enquiry-resolution&viewMode=story',{waitUntil:'networkidle'});
    await page.addScriptTag({content:planningRequestClientScript()});
    return page.locator('[data-dashboard-planning-request="81"]');
  }
  async function proof(page,testInfo,label){
    expect((await new AxeBuilder({page}).include('[data-dashboard-attention-panel], [data-shiloh-confirm]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`enquiry-${label}-${viewport.name}.png`),fullPage:true,animations:'disabled'});
  }
  test(`already attended selects the actual completed visit after missing walk-in recovery on ${viewport.name}`,async({page},testInfo)=>{
    let visits=false,stale=true;const writes=[];
    await page.route('**/calendar/workspace/planning-requests/81/appointments?kind=attended',route=>route.fulfill({json:{revision:'2030-10-30T09:00:00.000Z',appointments:visits?[{id:801,startsAt:'2030-10-29T08:00:00Z',serviceName:'Actual individual treatment',staffNames:'Synthetic therapist'}]:[]}}));
    await page.route('**/calendar/workspace/planning-requests/81/attended',async route=>{
      writes.push(route.request().postDataJSON());expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-csrf');
      await route.fulfill(stale?{status:409,json:{code:'PLANNING_VISIT_CHANGED',error:'This visit changed. Refresh visits.'}}:{json:{id:81,status:'attended'}});
    });
    const card=await open(page);
    await expect(card.getByRole('link',{name:'Open client profile'})).toHaveAttribute('href','/calendar/clients/22');
    await card.getByText('Already attended',{exact:true}).click();
    await card.getByRole('button',{name:'Refresh completed visits'}).click();
    await expect(card.locator('[data-enquiry-status]')).toContainText('Record the past appointment');
    await expect(card.getByRole('link',{name:'Record past appointment'})).toHaveAttribute('href',/clientName=Synthetic%20Organiser/);
    await expect(card.getByRole('button',{name:'Confirm visit already attended'})).toBeDisabled();
    await proof(page,testInfo,'missing-walk-in');
    visits=true;await card.getByRole('button',{name:'Refresh completed visits'}).click();
    await card.getByLabel('Actual completed visit').selectOption('801');
    await expect(card.locator('[data-enquiry-visit-summary]')).toContainText('Actual individual treatment');
    await card.getByRole('button',{name:'Confirm visit already attended'}).click();
    const dialog=page.locator('[data-shiloh-confirm]');
    await expect(dialog).toContainText('Synthetic Organiser');await expect(dialog).toContainText('Actual individual treatment');
    await proof(page,testInfo,'attended-review');
    await dialog.getByRole('button',{name:'Keep enquiry'}).click();expect(writes).toHaveLength(0);
    await card.getByRole('button',{name:'Confirm visit already attended'}).click();
    await dialog.getByRole('button',{name:'Confirm visit already attended'}).click();
    await expect(card.locator('[data-enquiry-status]')).toContainText('This visit changed');
    stale=false;await card.getByRole('button',{name:'Refresh completed visits'}).click();
    await card.getByLabel('Actual completed visit').selectOption('801');
    await card.getByRole('button',{name:'Confirm visit already attended'}).click();
    await dialog.getByRole('button',{name:'Confirm visit already attended'}).click();
    await expect(card.locator('[data-enquiry-status]')).toContainText('Enquiry resolved');
    expect(writes[1]).toMatchObject({appointmentId:801,confirmed:true,expectedRevision:'2030-10-30T09:00:00.000Z'});
  });
  test(`client cancellation uses named confirmation and safely retries an uncertain response on ${viewport.name}`,async({page},testInfo)=>{
    const writes=[];
    await page.route('**/calendar/workspace/planning-requests/81/cancelled',async route=>{
      writes.push(route.request().postDataJSON());
      if(writes.length===1)return route.abort('failed');
      expect(writes[1]).toEqual(writes[0]);return route.fulfill({json:{id:81,status:'cancelled',replayed:true}});
    });
    const card=await open(page);await expect(card).not.toContainText('Cannot accommodate');
    await expect(card.getByText('Rebook with client',{exact:true})).toBeVisible();
    await card.getByRole('button',{name:'Client cancelled',exact:true}).click();
    const dialog=page.locator('[data-shiloh-confirm]');await expect(dialog).toContainText('Synthetic Organiser');
    await expect(dialog).toContainText('use Cancel appointment in Calendar');
    await proof(page,testInfo,'cancel-review');
    await page.keyboard.press('Escape');expect(writes).toHaveLength(0);
    await expect(card.getByRole('button',{name:'Client cancelled',exact:true})).toBeFocused();
    for(let i=0;i<2;i++){
      await card.getByRole('button',{name:'Client cancelled',exact:true}).click();
      await dialog.getByRole('button',{name:'Client cancelled',exact:true}).click();
      await expect(card.locator('[data-enquiry-status]')).toContainText(i===0?'Retry the same confirmation safely':'Enquiry closed');
    }
    expect(writes[0]).toMatchObject({confirmed:true,expectedRevision:'2030-10-30T09:00:00.000Z'});
    expect(writes[0].appointmentId).toBeUndefined();
  });
  test(`record past appointment carries the enquiry client into the existing search and requires selection on ${viewport.name}`,async({page})=>{
    await page.setViewportSize(viewport);const searches=[];
    await page.route('**/calendar/book/past?clientName=*',route=>route.fulfill({contentType:'text/html',body:pastBooking.renderCalendarRetrospectiveBookingPage().replace(/<script[^>]+src=[\s\S]*?<\/script>/g,'')}));
    await page.route('**/calendar/book/past/client-search',async route=>{searches.push(route.request().postDataJSON());return route.fulfill({json:{clients:[{id:22,displayName:'Synthetic Organiser',contactHint:'***0022'}]}});});
    await page.goto('/calendar/book/past?clientName=Synthetic%20Organiser');
    await page.addScriptTag({content:pastBooking.calendarRetrospectiveBookingClientScript()});
    await expect(page.locator('#past-client-search')).toHaveValue('Synthetic Organiser');
    await expect(page.getByRole('button',{name:/Synthetic Organiser/})).toBeVisible();
    await expect(page.locator('[data-selected-client]')).toBeHidden();
    expect(searches).toEqual([{query:'Synthetic Organiser'}]);
    await page.getByRole('button',{name:/Synthetic Organiser/}).click();
    await expect(page.locator('[data-selected-client]')).toContainText('Synthetic Organiser');
  });
}
