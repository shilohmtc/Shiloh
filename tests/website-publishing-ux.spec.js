const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {workspaceNavigationClientScript}=require('../src/presentation/workspaceShell');
const {renderEditorialArticle}=require('../src/services/publicWebsite');
const id='b06a730c-30ec-4245-9f98-2dc8eebbb2d0';
for(const width of [390,1440]){
  test(`website stories and accurate ongoing offer are readable at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    for(const story of ['episode','morning-welcome-offer','home-with-publications']){
      await page.goto(`/iframe.html?id=website-publishing--${story}&viewMode=story`,{waitUntil:'networkidle'});
      await expect(page.locator('main')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      expect(results.violations).toEqual([]);
      if(story==='morning-welcome-offer'){
        await expect(page.getByLabel('Offer conditions')).toContainText('before 12:00');
        await expect(page.getByLabel('Offer conditions')).toContainText('excluding Saturdays');
        await expect(page.getByLabel('Offer conditions')).toContainText('Purchased gift vouchers');
        await expect(page.locator('main')).not.toContainText('October 2026');
        await expect(page.locator('.publication-image')).toHaveJSProperty('naturalWidth',1024);
      }
      await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:testInfo.outputPath(`${story}-${width}.png`),fullPage:true});
    }
  });
  test(`owner draft, preview, publish and unpublish workflow at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    let post,history=[],fail=false;const writes=[];
    await page.route('**/calendar/pwa/icon-192.png?*',route=>route.fulfill({path:require('node:path').join(__dirname,'../public/assets/brand/shiloh-mark-192.png'),contentType:'image/png'}));
    await page.route('**/calendar/workspace/navigation',route=>route.fulfill({json:{website:{allowed:true,href:'/calendar/website'}}}));
    await page.route('**/calendar/website/*/history',route=>route.fulfill({json:history}));
    await page.route('**/calendar/website/*/preview?*',route=>route.fulfill({contentType:'text/html',body:renderEditorialArticle({id,slug:post.slug,kind:'episode',...post.draft},{preview:true})}));
    await page.route(/\/calendar\/website\/[^/]+\/(save|publish|unpublish|restore)$/,async route=>{
      const payload=route.request().postDataJSON(),action=route.request().url().split('/').at(-1);writes.push({action,payload});
      expect(route.request().headers()['x-shiloh-csrf-token']).toBe('synthetic-website-csrf');
      if(fail)return route.fulfill({status:409,json:{error:'Someone saved a newer version. Reload before making changes.'}});
      post={...post,revision:post.revision+1,draft:action==='unpublish'?post.draft:payload.document,published:action==='publish'?payload.document:action==='unpublish'?null:post.published};
      history.unshift({revision:post.revision,action,document:post.draft,created_at:'2026-10-22T12:00:00Z'});
      return route.fulfill({json:post});
    });
    await page.goto('/iframe.html?id=website-publishing--website-editor&viewMode=story',{waitUntil:'networkidle'});
    post=await page.locator('[data-website-model]').evaluate(node=>JSON.parse(node.textContent).posts.find(p=>p.id==='b06a730c-30ec-4245-9f98-2dc8eebbb2d0'));
    await page.addScriptTag({content:workspaceNavigationClientScript()});
    await page.addScriptTag({url:'/workspace/website.js'});
    await page.getByLabel('Choose an item').selectOption(id);
    await page.getByLabel('Title',{exact:true}).fill('A thoughtful first visit');
    await page.getByRole('button',{name:'Save draft',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');expect(writes[0].action).toBe('save');
    await page.getByRole('button',{name:'Save & preview',exact:true}).click();
    await expect(page.locator('[data-preview-panel]')).toBeVisible();
    await expect(page.frameLocator('[data-preview-frame]').getByRole('heading',{level:1})).toHaveText('A thoughtful first visit');
    await page.getByRole('button',{name:'Phone',exact:true}).click();await expect(page.locator('[data-preview-frame]')).toHaveClass(/phone/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).include('[data-website-editor]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:testInfo.outputPath(`website-editor-preview-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Publish',exact:true}).click();await expect(page.getByRole('status')).toContainText('Published.');
    await expect(page.getByRole('button',{name:'Take off website',exact:true})).toBeVisible();
    await page.getByLabel('Title',{exact:true}).fill('');
    await page.getByRole('button',{name:'Take off website',exact:true}).click();await expect(page.getByRole('status')).toContainText('Taken off');expect(post.published).toBeNull();
    await page.getByLabel('Title',{exact:true}).fill('Conflicting unsaved edit');fail=true;
    await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByRole('status')).toContainText('newer version');expect(post.draft.title).toBe('A thoughtful first visit');
  });
  test(`client sees actual saving and can choose one promotional offer at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});const reviews=[];const confirms=[];
    await page.route('**/my-shiloh/api/booking/unfinished-draft',r=>r.fulfill({json:{draft:null}}));
    await page.route('**/my-shiloh/api/booking/practitioners?*',r=>r.fulfill({json:{practitioners:[{id:'11',name:'Synthetic Practitioner'}]}}));
    await page.route('**/my-shiloh/api/booking/availability?*',r=>r.fulfill({json:{slots:[{startsAt:'2026-11-02T08:00:00Z',date:'2026-11-02',time:'10:00',endTime:'11:15'}]}}));
    await page.route('**/my-shiloh/api/booking/review',route=>{
      const p=route.request().postDataJSON();reviews.push(p);
      return route.fulfill({json:{items:[{subtotal:'850.00',discount:p.useMorningOffer?'170.00':'0.00',total:p.useMorningOffer?'680.00':'850.00',availableDiscount:'170.00'}],discount:p.useMorningOffer?'170.00':'0.00',total:p.useMorningOffer?'680.00':'850.00',quoteHash:(p.useMorningOffer?'a':'b').repeat(64)}});
    });
    await page.route('**/my-shiloh/api/booking/confirm',route=>{confirms.push(route.request().postDataJSON());return route.fulfill({status:201,json:{message:'Your booking request is in.'}});});
    await page.goto('/iframe.html?id=website-publishing--booking-with-offer&viewMode=story',{waitUntil:'networkidle'});
    await page.addScriptTag({url:'/my-shiloh/assets/offer-pricing.js'});await page.addScriptTag({url:'/my-shiloh/assets/booking.js'});
    await page.locator('[data-book-service][data-service-id="101"]').click();await page.getByRole('button',{name:/Synthetic Practitioner/}).click();
    await page.locator('[data-booking-date]').fill('2026-11-02');await page.locator('[data-find-slots]').click();await page.getByRole('button',{name:/10:00–11:15/}).click();
    await expect(page.locator('[data-offer-total]')).toContainText('680');await expect(page.locator('[data-offer-saving]')).toContainText('170');
    await page.locator('[data-use-morning-offer]').uncheck();await expect(page.locator('[data-offer-total]')).toContainText('850');expect(reviews.at(-1).useMorningOffer).toBe(false);
    await page.locator('[data-use-morning-offer]').check();await expect(page.locator('[data-offer-total]')).toContainText('680');
    await page.locator('[data-special-occasion][value="no"]').check();await page.locator('[data-policy-accepted]').check();
    expect((await new AxeBuilder({page}).include('[data-step="4"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:testInfo.outputPath(`booking-offer-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Send booking request',exact:true}).click();expect(confirms).toHaveLength(1);expect(confirms[0].quoteHash).toBe('a'.repeat(64));expect(confirms[0].useMorningOffer).toBe(true);
  });
}
