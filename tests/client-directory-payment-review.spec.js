const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {renderClientListPage}=require('../src/presentation/workspaceClientsUx');
const {directoryPaymentScript}=require('../src/presentation/clientDirectoryPaymentUx');
const origin='https://synthetic.shiloh.test';
for(const width of [390,1440])test(`Directory payment indicators preserve financial meaning and recover at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:950});let mode='known';
 const known={state:'known',completedVisits:2,outstandingVisits:1,sharedBookings:0,reviewNeeded:0,upcomingDeposits:1};
 await page.route(origin+'/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/calendar/clients/payments.js')return route.fulfill({contentType:'application/javascript',body:directoryPaymentScript()});
  if(url.pathname==='/calendar/clients/payment-review')return route.fulfill(mode==='failure'?{status:503,body:'unavailable'}:{json:{reviews:{101:mode==='known'?known:{state:mode}}}});
  if(url.pathname==='/calendar/clients')return route.fulfill({contentType:'text/html',body:renderClientListPage({clients:[{id:101,name:'Synthetic Client',status:'active'}],offset:0,pageSize:24})});
  if(url.pathname.includes('icon-192.png'))return route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')});
  return route.fulfill({contentType:'application/javascript',body:''});
 });
 await page.goto(origin+'/calendar/clients');const indicator=page.locator('[data-client-payment-id="101"]');
 await expect(indicator).toHaveText('Completed visit: payment outstanding · Upcoming deposit to review');
 await expect(page.locator('.client-name')).toHaveText('Synthetic Client');await expect(page.locator('[data-client-profile-link]')).toHaveAttribute('href',/\/calendar\/clients\/101\?returnTo=/);await expect(indicator).toHaveAttribute('href',/services=appointments&returnTo=.*#client-appointments$/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).include('[data-clients-list-view]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`directory-payment-${width}.png`),fullPage:true});
 mode='restricted';await page.reload();await expect(indicator).toHaveText('Payment details restricted');
 mode='failure';await page.reload();await expect(indicator).toHaveText('Payment review unavailable');
 mode='known';known.outstandingVisits=0;known.upcomingDeposits=0;known.sharedBookings=1;await page.reload();await expect(indicator).toHaveText('Shared booking: review payment');
 known.sharedBookings=0;await page.reload();await expect(indicator).toHaveText('Linked completed visits: no balance remaining');
 await expect(indicator).not.toHaveAttribute('data-attention','true');
});
for(const width of [320,1440])test(`Directory payment Storybook populated states at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:950});await page.goto('/iframe.html?id=workspace-clients--payment-review-indicators&viewMode=story',{waitUntil:'networkidle'});
 await expect(page.getByText('Shared booking: review payment',{exact:true})).toBeVisible();await expect(page.getByText('Payment details restricted',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).include('[data-clients-list-view]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`directory-payment-story-${width}.png`),fullPage:true});
});

test('a delayed payment response cannot attach the old client balance to replacement search results',async({page})=>{
 let release,oldStarted=false;
 await page.route(origin+'/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/calendar/clients/payments.js')return route.fulfill({contentType:'application/javascript',body:directoryPaymentScript()});
  if(url.pathname==='/calendar/clients/payment-review'){
   if(url.searchParams.get('ids')==='101'){oldStarted=true;await new Promise(resolve=>{release=resolve;});return route.fulfill({json:{reviews:{101:{state:'known',completedVisits:1,outstandingVisits:1,sharedBookings:0,reviewNeeded:0,upcomingDeposits:0}}}}).catch(()=>{});}
   return route.fulfill({json:{reviews:{102:{state:'restricted'}}}});
  }
  if(url.pathname==='/calendar/clients')return route.fulfill({contentType:'text/html',body:renderClientListPage({clients:[{id:101,name:'Synthetic Old',status:'active'}],offset:0,pageSize:24})});
  return route.fulfill({body:'',contentType:'application/javascript'});
 });
 await page.goto(origin+'/calendar/clients');await expect.poll(()=>oldStarted).toBe(true);
 await page.locator('[data-client-search-results]').evaluate(root=>{root.innerHTML='<span data-client-payment-id="102">Checking</span>';});
 await expect(page.locator('[data-client-payment-id="102"]')).toHaveText('Payment details restricted');release();
 await expect(page.locator('[data-client-payment-id="102"]')).toHaveText('Payment details restricted');await expect(page.getByText('Completed visit: payment outstanding',{exact:true})).toHaveCount(0);
});
