'use strict';
const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {renderClientListPage}=require('../src/presentation/workspaceClientsUx');
const {clientSearchScript}=require('../src/presentation/workspaceClientSearchUx');
const origin='https://synthetic.shiloh.test';
function html(q='',status='active',offset=0){return renderClientListPage({clients:[{id:901,name:q||'Synthetic Client',status:status==='archived'?'archived':'active',appStatus:{usage:'Used before',phoneAlerts:'Enabled'}}],query:q,status,offset,pageSize:24,hasMore:offset===0});}
for(const width of [390,1440])test(`Directory live search, race protection, recovery and navigation at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:950});
 const calls=[];let fail=false,delay=false,release;
 await page.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/calendar/pwa/icon-192.png')return route.fulfill({path:require('node:path').resolve('public/assets/brand/shiloh-mark-192.png')});
  if(url.pathname==='/calendar/clients/search.js')return route.fulfill({contentType:'application/javascript',body:clientSearchScript()});
  if(url.pathname==='/calendar/clients'){
   const q=url.searchParams.get('q')||'',status=url.searchParams.get('status')||'active';calls.push(q);
   if(delay&&q==='Old'){await new Promise(resolve=>{release=resolve;});}
   return route.fulfill({status:fail?503:200,contentType:'text/html',body:html(q,status,Number(url.searchParams.get('offset')||0))}).catch(()=>{});
  }
  return route.fulfill({body:'',contentType:'application/javascript'});
 });
 await page.goto(origin+'/calendar/clients');
 const input=page.getByRole('searchbox'),status=page.locator('[data-client-search-status]');
 await expect(page.getByRole('button',{name:'Search',exact:true})).toBeHidden();
 await input.fill('S');await input.fill('Surname');
 await expect(page.locator('.client-name')).toHaveText('Surname');expect(calls).not.toContain('S');await expect(input).toBeFocused();
 delay=true;await input.fill('Old');await expect.poll(()=>Boolean(release)).toBe(true);
 await input.fill('0821234567');await expect(page.locator('.client-name')).toHaveText('0821234567');release();
 await expect(page.locator('.client-name')).toHaveText('0821234567');
 await page.locator('#client-status').selectOption('archived');await expect(page.locator('.client-row .status-pill')).toHaveText('archived');
 await input.fill('');await expect(page.locator('.client-name')).toHaveText('Synthetic Client');
 await expect(page).toHaveURL(/status=archived$/);
 await page.getByRole('link',{name:'Next',exact:true}).click();await expect(page).toHaveURL(/offset=24/);await expect(input).toBeFocused();
 await page.goBack();await expect(page).toHaveURL(/status=archived$/);await expect(page.getByRole('link',{name:'Next',exact:true})).toBeVisible();
 fail=true;await input.fill('Failure');await expect(status).toContainText('Search is unavailable');await expect(page.getByRole('button',{name:'Search',exact:true})).toBeVisible();
 fail=false;await input.press('Enter');await expect(page.locator('.client-name')).toHaveText('Failure');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).include('[data-clients-list-view]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath('directory-'+width+'.png'),fullPage:true});
});

test('Directory still submits a normal GET search without JavaScript and presents an empty result',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false});
 try{const page=await context.newPage();await page.route(origin+'/**',route=>{const url=new URL(route.request().url());return route.fulfill({contentType:'text/html',body:renderClientListPage({clients:[],query:url.searchParams.get('q')||'',status:'active',offset:0,pageSize:24})});});
 await page.goto(origin+'/calendar/clients');await page.getByRole('searchbox').fill('Missing client');await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect(page).toHaveURL(/q=Missing\+client/);await expect(page.getByText('No clients found.',{exact:true})).toBeVisible();
 }finally{await context.close();}
});

test('Clinic check-in menu is hidden until the existing permission response allows it',async({page})=>{
 const {workspaceNavigationClientScript}=require('../src/presentation/workspaceShell');
 let allowed=false;
 await page.route(origin+'/**',route=>{
  if(route.request().url().endsWith('/calendar/workspace/navigation'))return route.fulfill({json:{clinicCheckin:{allowed,href:allowed?'/calendar/check-in/devices':null}}});
  return route.fulfill({contentType:'text/html',body:html()});
 });
 await page.goto(origin+'/calendar/clients');await page.addScriptTag({content:workspaceNavigationClientScript()});
 await expect(page.locator('[data-workspace-destination="clinicCheckin"]')).toBeHidden();
 allowed=true;await page.reload();await page.addScriptTag({content:workspaceNavigationClientScript()});
 await expect(page.locator('a[data-workspace-destination="clinicCheckin"]')).toHaveAttribute('href','/calendar/check-in/devices');
});

for(const width of [390,1440])test(`Filtered client and payment links retain Directory context across tabs at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:950});
 const {renderClientDetailPageWithCommunications}=require('../src/presentation/workspaceCommunicationEvidenceUx');
 const {clientDirectoryReturnHref}=require('../src/presentation/clientDirectoryContext');
 await page.route(origin+'/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/calendar/clients/search.js')return route.fulfill({contentType:'application/javascript',body:clientSearchScript()});
  if(url.pathname==='/calendar/clients')return route.fulfill({contentType:'text/html',body:html(url.searchParams.get('q')||'',url.searchParams.get('status')||'active',Number(url.searchParams.get('offset')||0))});
  if(url.pathname==='/calendar/clients/901')return route.fulfill({contentType:'text/html',body:renderClientDetailPageWithCommunications({client:{id:901,name:'Synthetic Client',status:'active'},appointments:[],historyOffset:0,pageSize:20,policyAcceptances:[],services:url.searchParams.get('services')||'overview',clientListReturnHref:clientDirectoryReturnHref(url.searchParams.get('returnTo'))})});
  return route.fulfill({body:'',contentType:'application/javascript'});
 });
 await page.goto(origin+'/calendar/clients');await page.getByRole('searchbox').fill('Synthetic surname');
 await expect(page.locator('.client-name')).toHaveText('Synthetic surname');
 await page.locator('#client-status').selectOption('archived');
 await expect(page.locator('.client-row .status-pill')).toHaveText('archived');
 await page.getByRole('link',{name:'Next',exact:true}).click();await expect(page).toHaveURL(/offset=24/);
 const context=new URL(page.url()).pathname+new URL(page.url()).search;
 for(const selector of ['[data-client-profile-link]','[data-client-payment-id]']) {
  await page.locator(selector).click();
  await expect(page.locator('[data-client-home-section]')).toHaveAttribute('data-client-home-section',selector.includes('payment')?'appointments':'overview');
  await page.getByRole('navigation',{name:'Client sections'}).getByRole('link',{name:'Forms',exact:true}).click();
  await expect(page.getByRole('link',{name:'Back to Clients',exact:true})).toHaveAttribute('href',context);
  await page.getByRole('link',{name:'Back to Clients',exact:true}).click();
  await expect(page.getByRole('searchbox')).toHaveValue('Synthetic surname');await expect(page.locator('#client-status')).toHaveValue('archived');await expect(page).toHaveURL(/offset=24/);
 }
});
