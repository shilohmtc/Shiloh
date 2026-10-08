'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {PNG}=require('pngjs');
const pixelmatch=require('pixelmatch').default;
const {fixtureHtml,STAFF}=require('./calendar-phone-working-day-fixture');
const OUT=path.join(process.cwd(),'artifacts/calendar-phone-roomier');
const executablePath=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/calendar/operations/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({notes:'Synthetic internal note',revision:'synthetic'}));return;}
    if(url.pathname==='/calendar/book'){res.end('<!doctype html><title>Synthetic booking destination</title>');return;}
    if(url.pathname==='/calendar/pwa/icon-192.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync('public/assets/pwa/shiloh-pwa-192.png'));return;}
    if(url.pathname.startsWith('/assets/')){const file=path.join(process.cwd(),'public',url.pathname);if(fs.existsSync(file)){res.end(fs.readFileSync(file));return;}}
    res.setHeader('Content-Type','text/html');res.end(fixtureHtml({empty:url.searchParams.has('empty'),straddlers:true,staff:url.searchParams.has('subset')?STAFF.slice(0,1):url.searchParams.has('longNames')?STAFF.map(p=>({...p,displayName:p.displayName+' Synthetic long staff name'})):STAFF}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath,args:['--no-sandbox']});const results=[];
  try{
    for(const [width,height] of [[320,740],[390,844],[667,375],[700,800],[701,800]]){
      console.log('Checking Roomier viewport',width,height);
      const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/?view=week');await page.waitForTimeout(150);
      if(width===701){assert.equal(await page.locator('[data-phone-layout-choice]').count(),0);await context.close();continue;}
      assert.equal(await page.locator('body').getAttribute('data-phone-layout'),'compact');
      await page.screenshot({path:path.join(OUT,`compact-${width}.png`)});
      await page.locator('[data-phone-layout-choice="roomier"]').click();await page.waitForTimeout(150);
      const metrics=await geometry(page);
      assert.ok(metrics.height>=2398,JSON.stringify(metrics));assert.ok(metrics.laneWidth>=179);assert.ok(metrics.scrollWidth>metrics.clientWidth);assert.ok(metrics.scrollHeight>metrics.clientHeight);
      verifyGeometry(metrics);assert.equal(metrics.events.find(e=>e.id==='appointment-3').lanes,'2');assert.equal(metrics.events.find(e=>e.id==='appointment-1').lanes,'1');
      assert.equal(await page.locator('[data-phone-layout-choice="roomier"]').getAttribute('aria-pressed'),'true');assert.ok(page.url().includes('phoneLayout=roomier'));assert.equal(await page.locator('[data-phone-staff-column-id]').count(),4);
      await page.screenshot({path:path.join(OUT,`roomier-${width}.png`)});
      if(width===390){const expected=PNG.sync.read(fs.readFileSync(path.join(OUT,'compact-390.png'))),candidate=PNG.sync.read(fs.readFileSync(path.join(OUT,'roomier-390.png'))),diff=new PNG({width,height});const changed=pixelmatch(expected.data,candidate.data,diff.data,width,height,{threshold:.1});fs.writeFileSync(path.join(OUT,'expected.png'),PNG.sync.write(expected));fs.writeFileSync(path.join(OUT,'candidate.png'),PNG.sync.write(candidate));fs.writeFileSync(path.join(OUT,'diff.png'),PNG.sync.write(diff));results.push({comparison:'same-head compact versus optional roomier',changedPixels:changed});}
      await page.locator('[data-phone-staff-menu-summary]').click();for(const id of [55,56])await page.locator(`[data-phone-week-staff-id="${id}"]`).click();await page.locator('[data-phone-staff-menu-summary]').click();await page.waitForTimeout(150);assert.equal(await page.locator('[data-phone-staff-column-id]').count(),6);assert.ok((await geometry(page)).laneWidth>=179);
      await page.reload();await page.waitForTimeout(150);assert.equal(await page.locator('body').getAttribute('data-phone-layout'),'roomier');assert.equal(await page.locator('[data-phone-staff-column-id]').count(),6);
      const next=await page.locator('[data-phone-week-nav="next"]').getAttribute('href');assert.ok(next.includes('phoneLayout=roomier'));assert.ok(next.includes('phoneStaff=all'));await page.locator('[data-phone-week-nav="next"]').click();await page.waitForTimeout(150);assert.equal(await page.locator('body').getAttribute('data-phone-layout'),'roomier');
      await page.goto(origin+'/?view=week&phoneLayout=roomier');await page.waitForTimeout(150);
      // Real horizontal and vertical scroll, visible header and proportional cards.
      await page.locator('[data-event-id="appointment-5"]').scrollIntoViewIfNeeded();
      const scroll=await page.locator('.phone-day-scroll').evaluate(n=>({left:n.scrollLeft,top:n.scrollTop}));assert.ok(scroll.top>0);
      await page.locator('[data-event-id="appointment-5"]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('[data-details-time]').textContent(),'12:00–13:30');assert.match(await page.locator('[data-details-client]').textContent(),/long surname/);await page.locator('[data-details-close]').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.eventId),'appointment-5');
      await page.screenshot({path:path.join(OUT,`midday-notes-${width}.png`)});
      const notes=page.locator('[data-event-id="appointment-5"] [data-notes-indicator]');await notes.focus();await page.keyboard.press('Enter');await page.locator('[data-appointment-notes-form] textarea').waitFor({state:'visible'});assert.equal(await page.locator('[data-appointment-notes-form] textarea').inputValue(),'Synthetic internal note');await page.locator('[data-panel-close]').click();
      await page.locator('[data-event-id="appointment-6"]').scrollIntoViewIfNeeded();assert.ok(await page.locator('[data-event-id="appointment-6"] .kind-pill').isVisible());await page.locator('[data-event-id="appointment-13"]').scrollIntoViewIfNeeded();assert.ok(await page.locator('[data-event-id="appointment-13"] .kind-pill').isVisible());
      await page.locator('[data-event-id="appointment-15"]').focus();await page.keyboard.press('Space');assert.equal(await page.locator('[data-details-time]').textContent(),'16:30–17:30');await page.locator('[data-details-done]').click();
      const sticky=await page.evaluate(()=>{const header=document.querySelector('.phone-staff-column-header').getBoundingClientRect(),surface=document.querySelector('.phone-day-scroll').getBoundingClientRect();return{header:header.top,surface:surface.top};});assert.ok(Math.abs(sticky.header-sticky.surface)<2,JSON.stringify(sticky));
      await page.screenshot({path:path.join(OUT,`scrolled-${width}.png`)});
      const a11y=await new AxeBuilder({page}).include('.calendar-view').analyze();assert.deepEqual(a11y.violations.filter(v=>['serious','critical'].includes(v.impact)),[]);fs.writeFileSync(path.join(OUT,`a11y-${width}.json`),JSON.stringify(a11y.violations,null,2));
      await page.locator('[data-phone-layout-choice="compact"]').click();await page.waitForTimeout(150);assert.equal(await page.locator('body').getAttribute('data-phone-layout'),'compact');assert.ok(!page.url().includes('phoneLayout'));assert.equal(await page.locator('[data-phone-staff-column-id]').count(),4);verifyGeometry(await geometry(page));
      for(const selection of ['51','none','all']){await page.goto(origin+'/?view=week&phoneLayout=roomier&phoneStaff='+selection);await page.waitForTimeout(150);assert.equal(await page.locator('[data-phone-staff-column-id]').count(),selection==='all'?6:selection==='none'?0:1);assert.ok((await geometry(page)).scrollWidth>=width-20);}
      await page.goto(origin+'/?view=week&phoneLayout=roomier&subset=1');await page.waitForTimeout(150);assert.equal(await page.locator('[data-phone-staff-column-id]').count(),1);
      // Empty taps after both scroll offsets must retain exact time AND last staff.
      for(const [minute,time] of [[420,'07:00'],[750,'12:30'],[1019,'16:30']]){
        await page.goto(origin+'/?view=week&phoneLayout=roomier&phoneStaff=all&empty=1');await page.waitForTimeout(150);
        const point=await page.evaluate(minute=>{const surface=document.querySelector('.phone-day-scroll'),column=document.querySelector('[data-phone-active-day="true"] .time-column');let rect=column.getBoundingClientRect();const relativeY=(minute-420)/600*rect.height;surface.scrollLeft=surface.scrollWidth;surface.scrollTop=Math.max(0,column.offsetTop+relativeY-80);rect=column.getBoundingClientRect();return{x:rect.left+rect.width*11/12,y:rect.top+Math.max(2,relativeY)};},minute);
        console.log('Checking scrolled tap',width,time,point);await page.mouse.click(point.x,point.y);await page.waitForURL(/\/calendar\/book/);const booked=new URL(page.url());assert.equal(booked.searchParams.get('time'),time);assert.equal(booked.searchParams.get('staff'),'56');
      }
      await page.goto(origin+'/?view=week&phoneLayout=roomier');await page.evaluate(()=>document.documentElement.style.fontSize='200%');await page.waitForTimeout(250);const enlarged=await geometry(page);assert.ok(enlarged.height>=4798,JSON.stringify(enlarged));assert.ok(enlarged.laneWidth>=359);verifyGeometry(enlarged);await page.screenshot({path:path.join(OUT,`large-text-${width}.png`)});await page.locator('.phone-day-scroll').focus();await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.querySelector('.phone-day-scroll').scrollTop>0);
      await page.goto(origin+'/?view=week&phoneLayout=roomier&phoneStaff=51,52,53,54&longNames=1');await page.waitForTimeout(150);assert.match(await page.locator('[data-phone-staff-column-id=\"51\"]').textContent(),/Synthetic long staff name/);assert.equal(await page.locator('[data-phone-staff-column-id]').count(),4);
      assert.deepEqual(errors,[]);results.push({width,height,metrics,largeText:enlarged,errors});await context.close();
    }
    fs.writeFileSync(path.join(OUT,'proof.json'),JSON.stringify(results,null,2));console.log('Roomier proof passed: phone geometry, scrolling, selections, navigation, keyboard, Notes, accessibility and exact taps.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
async function geometry(page){return page.evaluate(()=>{const column=document.querySelector('[data-phone-active-day="true"] .time-column'),rect=column.getBoundingClientRect(),surface=document.querySelector('.phone-day-scroll'),count=document.querySelectorAll('[data-phone-staff-column-id]').length;return{height:rect.height,laneWidth:rect.width/Math.max(1,count),scrollWidth:surface.scrollWidth,clientWidth:surface.clientWidth,scrollHeight:surface.scrollHeight,clientHeight:surface.clientHeight,events:[...document.querySelectorAll('.week-time-grid .positioned-event[data-phone-column-visible="true"]')].map(n=>({id:n.querySelector('.event-card').dataset.eventId,start:Math.max(420,Number(n.dataset.displayStart)),end:Math.min(1020,Number(n.dataset.displayEnd)),top:n.getBoundingClientRect().top-rect.top,height:n.getBoundingClientRect().height,lanes:n.dataset.phoneOverlapLanes}))};});}
function verifyGeometry(metrics){for(const event of metrics.events){assert.ok(Math.abs(event.top-(event.start-420)/600*metrics.height)<2,JSON.stringify(event));assert.ok(Math.abs(event.height-(event.end-event.start)/600*metrics.height)<2,JSON.stringify(event));}}
main().catch(error=>{console.error(error);process.exitCode=1;});
