const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
for(const width of [390,1280]) test(`individual client sections retain history and permission boundaries at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  for(const section of ['activity','forms','rewards','vouchers']){
    await page.goto(`/iframe.html?id=workspace-production-surfaces--client-home-${section}&viewMode=story`,{waitUntil:'networkidle'});
    const hub=page.locator('[data-client-profile-services]');
    await expect(hub).toBeVisible();
    const nav=page.getByRole('navigation',{name:'Client sections'});
    await expect(nav.locator('[aria-current="page"]')).toHaveText(section[0].toUpperCase()+section.slice(1));
    await expect(nav.locator('a')).toHaveCount(6);
    for(const key of ['activity','forms','rewards','vouchers'])await expect(nav.locator(`a[href="/calendar/clients/9012?services=${key}#client-${key}"]`)).toHaveCount(1);
    if(section==='activity')await expect(hub.getByText('Available in My Shiloh',{exact:true})).toBeVisible();
    if(section==='forms'){
      await expect(hub.getByRole('link',{name:'View signed form'})).toHaveAttribute('href','/calendar/clients/9012/consultation-forms/7001');
      await expect(hub.getByRole('heading',{name:'Booking Policy & Terms'})).toBeVisible();
    }
    if(section==='rewards')await expect(hub.getByText('Recorded balance: R120.00')).toBeVisible();
    if(section==='vouchers')for(const code of ['SV-SYNTHETIC-RECEIVED','SV-SYNTHETIC-PURCHASED'])await expect(hub.getByText(code)).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect.poll(async()=>{try{return(await new AxeBuilder({page}).include('[data-client-detail-view]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;}catch(e){if(e.message.includes('Axe is already running'))return ['retry'];throw e;}}).toEqual([]);
    await page.screenshot({path:info.outputPath(`client-services-${section}-${width}.png`),fullPage:true});
  }
});
