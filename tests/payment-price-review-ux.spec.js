const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
for(const [name,width,height] of [['phone',390,844],['desktop',1280,900]]){
 test(`changed payment price opens an accessible read-only review on ${name}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height});let mutations=[];
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/calendar/payments'))mutations.push(r.url());});
  await page.goto('/iframe.html?id=workspace-booking-payment-recovery--price-changed-after-payment&viewMode=story');
  const review=page.locator('[data-price-review]');await expect(review).toBeVisible();
  await expect(review).toContainText('R0 is not yet a No charge decision.');
  await expect(page.locator('[data-payment-history]')).toBeVisible();
  await expect(page.locator('[data-manual-form],[data-refund-form],[data-ozow-form],[data-copy-link],[data-retry-deposit],[data-payment-method-card]')).toHaveCount(0);
  await expect(page.getByText('Recorded balance · review only',{exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).include('[data-payment-page]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath(`price-review-${name}.png`),fullPage:true});
  await page.getByRole('link',{name:'Review payment history',exact:true}).click();
  await expect(page).toHaveURL(/#payment-history$/);expect(mutations).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
