const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {renderHome}=require('../src/services/publicWebsite');
const {renderBookingPage}=require('../src/services/publicBookingPageEditorial');

async function home(page,{preview=false}={}) {
  const reviewPreview=preview?{place:{rating:4.9,ratingCount:87},reviews:Array.from({length:3},()=>({rating:5,text:'Synthetic review',authorName:'Synthetic reviewer'}))}:null;
  await page.route('**/_review-proof',r=>r.fulfill({contentType:'text/html',body:renderHome([],{reviewPreview})}));
  await page.goto('/_review-proof',{waitUntil:'domcontentloaded'});
  const reviews=page.locator('[data-google-reviews]');
  await expect(reviews).toBeVisible();
  return reviews;
}
for(const width of [390,1440])test(`review outage offers Google Maps and directions remain accessible at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  await page.route('**/reviews/google',r=>r.fulfill({status:503,json:{status:'error',reviews:[]}}));
  const reviews=await home(page);
  await expect(reviews.locator('[data-reviews-summary]')).toHaveText('Reviews are temporarily unavailable here.');
  await expect(reviews).not.toContainText('Loading');
  await expect(reviews.locator('[data-reviews-rail]')).toBeHidden();
  await expect(reviews.getByRole('link',{name:'Read all reviews on Google Maps →'})).toHaveAttribute('href',/^https:\/\/www\.google\.com\/maps\//);
  await expect(reviews.locator('[data-reviews-next]')).toBeDisabled();
  await expect(reviews.locator('.reviews-controls')).toBeHidden();
  const axe=await new AxeBuilder({page}).include('[data-google-reviews]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
  await reviews.screenshot({path:info.outputPath(`reviews-unavailable-${width}.png`)});
  await page.goto('/iframe.html?id=public-website-production-pages--contact&viewMode=story',{waitUntil:'networkidle'});
  const link=page.getByRole('link',{name:'Get directions in Google Maps (opens in a new tab)',exact:true});
  await expect(link).toBeVisible();
  const url=new URL(await link.getAttribute('href'));
  expect(url.searchParams.get('destination')).toBe('37 Jacobs Street, Heidelberg, Gauteng, South Africa');
  const contactAxe=await new AxeBuilder({page}).include('.contact-panel').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(contactAxe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:info.outputPath(`contact-directions-${width}.png`),fullPage:true,animations:'disabled'});
});
for(const status of ['not_configured','live'])test(`empty ${status} review response clears the loading state`,async({page})=>{
  await page.route('**/reviews/google',r=>r.fulfill({json:{status,reviews:[]}}));
  const reviews=await home(page);
  await expect(reviews).toContainText('Reviews are temporarily unavailable here.');
  await expect(reviews).not.toContainText('Loading');
});
test('a stalled review request times out and keeps the public Maps fallback',async({page})=>{
  let requested=false;
  await page.route('**/reviews/google',()=>{requested=true;});
  await page.clock.install({time:new Date('2026-10-23T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-23T12:00:01Z'));
  const reviews=await home(page);
  await expect.poll(()=>requested).toBe(true);
  await page.clock.runFor(9000);
  await expect(reviews).toContainText('Loading recent client reviews');
  await page.clock.runFor(3001);
  await expect(reviews).not.toContainText('Loading');
  await expect(reviews).toContainText('Reviews are temporarily unavailable here.');
});
test('an outage preserves already-rendered reviews instead of replacing them',async({page})=>{
  await page.route('**/reviews/google',r=>r.fulfill({status:503,json:{}}));
  const reviews=await home(page,{preview:true});
  await expect(reviews.locator('[data-reviews-summary]')).toHaveText('4.9 from 87 Google reviews');
  await expect(reviews.locator('.review-card')).toHaveCount(3);
  await expect(reviews).not.toContainText('temporarily unavailable');
});
test('live review success still renders literal review text without a stale loading summary',async({page})=>{
  await page.route('**/reviews/google',r=>r.fulfill({json:{status:'live',reviews:[{rating:5,text:'<b>Synthetic review</b>',authorName:'Synthetic reviewer'}]}}));
  const reviews=await home(page);
  await expect(reviews.locator('[data-reviews-summary]')).toHaveText('Recent reviews from Google Maps.');
  await expect(reviews.locator('.review-text')).toHaveText('“<b>Synthetic review</b>”');
  await expect(reviews.locator('.review-text b')).toHaveCount(0);
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
