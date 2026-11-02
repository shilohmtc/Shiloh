const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {renderBookingPage}=require('../src/services/publicBookingPageEditorial');

for(const width of [390,1440])test(`retired Places pages preserve review links and clinic directions at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  const calls=[];
  page.on('request',request=>{if(/reviews\/google|visit\/places|places\.googleapis/.test(request.url()))calls.push(request.url());});
  await page.route('**/reviews/google',route=>route.abort());
  await page.route('**/visit/places**',route=>route.abort());
  for(const story of ['home','visit','contact']) {
    await page.goto(`/iframe.html?id=public-website-production-pages--${story}&viewMode=story`,{waitUntil:'networkidle'});
    if(story==='home') {
      await expect(page.getByRole('link',{name:'Read reviews on Google Maps →'})).toHaveAttribute('href',/^https:\/\/www\.google\.com\/maps\//);
      await expect(page.locator('[data-google-reviews]')).not.toContainText(/Loading|temporarily unavailable|out of 5/);
      await expect(page.locator('.review-card')).toHaveCount(0);
    }
    if(story==='visit') {
      await expect(page.getByRole('heading',{name:'Come find Shiloh in Heidelberg.'})).toBeVisible();
      await expect(page.getByText('Accommodation starting points.')).toHaveCount(0);
      await expect(page.locator('[data-live-places-query]')).toHaveCount(0);
    }
    if(story==='contact') {
      const link=page.getByRole('link',{name:'Get directions in Google Maps (opens in a new tab)',exact:true});
      const url=new URL(await link.getAttribute('href'));
      expect(url.searchParams.get('destination')).toBe('37 Jacobs Street, Heidelberg, Gauteng, South Africa');
    }
    const axe=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`places-removed-${story}-${width}.png`),fullPage:true,animations:'disabled'});
  }
  expect(calls).toEqual([]);
});

for(const width of [390,1440])test(`Youth Guests Pedi & Gel stays in foot care on Services and Book at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  for(const view of ['services','booking']){
    await page.goto(`/iframe.html?id=public-website-production-pages--youth-guest-${view}&viewMode=story`,{waitUntil:'networkidle'});
    const category=page.locator('.category').filter({hasText:'Youth Guests Pedi & Gel'});
    await expect(category.getByRole('heading',{level:2})).toHaveText('Pedicures & Foot Care');
    const card=view==='services'?page.locator('[data-service-id="1101"]'):page.locator('#service-1101');
    await expect(card).toContainText('R210');await expect(card).toContainText('45 min');
    await expect(card.getByRole('link')).toHaveAttribute('href',view==='services'?'/book?service=1101#service-1101':'/my-shiloh/book?service=1101');
    const axe=await new AxeBuilder({page}).include('.category').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    await category.screenshot({path:info.outputPath(`youth-pedi-${view}-${width}.png`)});
  }
});

for(const width of [320,390,900,1440])test(`selected service anchor clears the sticky header at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  const catalogue=Array.from({length:18},(_,i)=>({id:1001+i,name:`Synthetic massage ${i+1}`,category:'Massage',duration:'30 min',price:'R200'}));
  await page.route('**/_anchor-proof?service=1007',r=>r.fulfill({contentType:'text/html',body:renderBookingPage('27830000000',catalogue,1007)}));
  await page.goto('/_anchor-proof?service=1007#service-1007',{waitUntil:'networkidle'});
  const card=page.locator('#service-1007');
  await expect(card).toBeInViewport({ratio:0.9});
  const header=await page.locator('.site-header').boundingBox();
  expect((await card.boundingBox()).y).toBeGreaterThanOrEqual(header.y+header.height+8);
  await expect(card).toHaveAttribute('data-selected-service','true');
  await expect(card.getByRole('link')).toHaveAttribute('href','/my-shiloh/book?service=1007');
  await page.screenshot({path:info.outputPath(`selected-anchor-${width}.png`)});
  await page.reload({waitUntil:'networkidle'});
  expect((await card.boundingBox()).y).toBeGreaterThanOrEqual((await page.locator('.site-header').boundingBox()).height+8);
});
