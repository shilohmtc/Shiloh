const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
for(const width of [390,1440])test(`Payment shows the selected visit and a date-aware return at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:950});
 await page.goto('/iframe.html?id=workspace-booking-payment-recovery--selected-visit-context&viewMode=story',{waitUntil:'networkidle'});
 await expect(page.getByRole('heading',{name:'Linked booking #88'})).toBeVisible();
 await expect(page.locator('[data-payment-visit-context]')).toHaveText('Selected visit: 15 Dec 2026, 10:30 – 11:30 SAST · Synthetic practitioner');
 await expect(page.getByRole('link',{name:'Back to appointment',exact:true})).toHaveAttribute('href','/calendar/read-only?view=week&date=2026-12-15&staff=all&appointment=779');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).include('[data-payment-page]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`payment-context-${width}.png`),fullPage:true});
});
