const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
for(const width of [390,1440])test(`public address is practical, not repeated narrative at ${width}`,async({page},info)=>{
 test.setTimeout(45000);await page.setViewportSize({width,height:1000});
 for(const [story,count] of [['home',0],['about',0],['treatments',0],['book',0],['contact',1]]){
  await page.goto(`/iframe.html?id=public-website-production-pages--${story}&viewMode=story`,{waitUntil:'networkidle'});
  const visible=await page.locator('body').innerText();expect((visible.match(/37 Jacobs Street/g)||[]).length).toBe(count);
  const band=page.locator('.site-location-band');await expect(band).toContainText('We look forward to welcoming you.');await expect(band).toHaveAttribute('href','/contact');await expect(band).toContainText('Plan your visit');
  if(story==='home'){
   await expect(page.locator('.home-hero')).toContainText('Heidelberg');
   await expect(page.locator('.local-story__copy')).toContainText('welcome drink');
   await page.screenshot({path:info.outputPath(`home-reading-${width}.png`),fullPage:true,animations:'disabled'});
  }
  if(story==='about')await expect(page.locator('.fact-grid')).toContainText('Personal care in the heart of Heidelberg.');
  if(story==='contact'){
   await expect(page.locator('.contact-visit h2')).toHaveText('37 Jacobs Street');
   const url=new URL(await page.getByRole('link',{name:'Get directions in Google Maps (opens in a new tab)',exact:true}).getAttribute('href'));
   expect(url.searchParams.get('destination')).toBe('37 Jacobs Street, Heidelberg, Gauteng, South Africa');
  }
  const axe=await new AxeBuilder({page}).include('.site-location-band').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await band.screenshot({path:info.outputPath(`visit-banner-${story}-${width}.png`)});
 }
});
