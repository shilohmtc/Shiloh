'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const { fixtureHtml, STAFF, DATE } = require('./calendar-phone-working-day-fixture');
const OUT = path.join(process.cwd(),'artifacts/calendar-phone-working-day');
const BASELINE_ROOT=process.env.CALENDAR_BASELINE_ROOT||'/workspace/shiloh-phone-calendar-baseline';
const baselineAvailable=fs.existsSync(path.join(BASELINE_ROOT,'scripts/calendar-phone-working-day-fixture.js'));
const executablePath = [process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(candidate=>candidate&&fs.existsSync(candidate));
if(!executablePath)throw new Error('Working-day browser proof requires Chromium');
async function main() {
  fs.mkdirSync(OUT,{recursive:true});
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/calendar/pwa/icon-192.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(path.join(process.cwd(),'public/assets/pwa/shiloh-pwa-192.png')));return;}
    if(url.pathname.startsWith('/calendar/operations/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({notes:'Synthetic internal note',revision:'synthetic',label:'Synthetic availability',explanation:'Synthetic evidence only'}));return;}
    if(url.pathname==='/calendar/book'){res.end('<!doctype html><title>Synthetic booking destination</title>');return;}
    if(url.pathname.startsWith('/assets/')){const file=path.join(process.cwd(),'public',url.pathname);if(fs.existsSync(file)){res.end(fs.readFileSync(file));return;}}
    res.setHeader('Content-Type','text/html');const render=url.searchParams.has('baseline')?require(path.join(BASELINE_ROOT,'scripts/calendar-phone-working-day-fixture')).fixtureHtml:fixtureHtml;res.end(render({noOutliers:url.searchParams.has('normal'),staff:url.searchParams.get('subset')==='overflow'?STAFF.slice(-2):url.searchParams.has('subset')?STAFF.slice(0,1):STAFF,straddlers:url.searchParams.has('straddlers'),empty:url.searchParams.has('empty')}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath,args:['--no-sandbox']});
  const results=[];
  try {
    for(const [width,height] of [[320,740],[360,800],[390,844],[440,956],[700,800],[701,800],[667,375]]) {
      console.log('Checking viewport',width,height);
      const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/?view=week');
      await page.waitForTimeout(100);
      if(width===701){assert.equal(await page.locator('[data-phone-staff-column-id]').count(),0);await page.screenshot({path:path.join(OUT,'desktop-boundary.png')});await context.close();continue;}
      assert.equal(await page.locator('[data-phone-staff-column-id]').count(),4);
      const metrics=await page.evaluate(()=>{
        const column=document.querySelector('[data-phone-active-day="true"] .time-column');const grid=column.getBoundingClientRect();
        return {labelFont:parseFloat(getComputedStyle(document.querySelector('.time-rail span[data-phone-open-label="true"]')).fontSize),height:grid.height,width:grid.width,scroll:document.documentElement.scrollWidth,events:[...document.querySelectorAll('.week-view .positioned-event[data-phone-outside-hours="false"][data-phone-column-visible="true"]')].map(n=>({start:Number(n.dataset.displayStart),end:Number(n.dataset.displayEnd),top:n.getBoundingClientRect().top-grid.top,height:n.getBoundingClientRect().height,lanes:n.dataset.phoneOverlapLanes})),hours:[...document.querySelectorAll('.time-rail span')].filter(n=>getComputedStyle(n).display!=='none').map(n=>n.textContent.trim())};
      });
      assert.deepEqual(metrics.hours,Array.from({length:10},(_,i)=>String(i+8).padStart(2,'0')+':00'));
      assert.ok(metrics.scroll<=width+1);
      for(const event of metrics.events){assert.ok(Math.abs(event.top-(event.start-480)/540*metrics.height)<2,JSON.stringify(event));assert.ok(Math.abs(event.height-(event.end-event.start)/540*metrics.height)<2,JSON.stringify(event));}
      assert.equal(metrics.events.find(e=>e.start===540).lanes,'2');
      assert.equal(metrics.events.find(e=>e.start===480).lanes,'1');
      assert.equal(metrics.events.find(e=>e.start===495).lanes,'1');
      assert.ok(await page.locator('[data-event-id="appointment-13"] .kind-pill').isVisible());
      assert.equal(await page.locator('.phone-day-notices [data-event-id="operational_leave-30"]').count(),1);
      assert.equal(await page.locator('.phone-hours-exceptions .positioned-event').count(),2);
      await page.locator('.phone-hours-exceptions summary').click();
      assert.ok(await page.locator('[data-event-id="appointment-9"]').isVisible());
      await page.waitForTimeout(50);const openGeometry=await page.evaluate(()=>{const column=document.querySelector('[data-phone-active-day="true"] .time-column').getBoundingClientRect();const appointment=document.querySelector('[data-event-id="appointment-3"]').parentNode.getBoundingClientRect();return{column:column.height,event:appointment.height,top:appointment.top-column.top};});assert.ok(Math.abs(openGeometry.event-openGeometry.column/9)<2);assert.ok(Math.abs(openGeometry.top-openGeometry.column/9)<2);
      await page.locator('.phone-hours-exceptions summary').click();
      await page.screenshot({path:path.join(OUT,`phone-${width}-${height}.png`)});
      const a11y=await new AxeBuilder({page}).include('.calendar-view').analyze();fs.writeFileSync(path.join(OUT,`a11y-${width}-${height}.json`),JSON.stringify(a11y.violations,null,2));
      assert.deepEqual(a11y.violations.filter(v=>['serious','critical'].includes(v.impact)),[]);
      const card=page.locator('[data-event-id="appointment-5"]');
      const note=card.locator('[data-notes-indicator]'),noteBox=await note.boundingBox(),cardBox=await card.boundingBox();assert.ok(noteBox.x>=cardBox.x&&noteBox.y>=cardBox.y&&noteBox.x+noteBox.width<=cardBox.x+cardBox.width+1&&noteBox.y+noteBox.height<=cardBox.y+cardBox.height+1,JSON.stringify({width,height,noteBox,cardBox}));if(cardBox.width>=120&&cardBox.height>=88){assert.ok(noteBox.width>=44&&noteBox.height>=44);}assert.equal(await note.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(231, 238, 233)');await note.focus();assert.equal(await note.evaluate(n=>getComputedStyle(n).outlineWidth),'3px');

      await card.focus();await card.press('Enter');
      assert.ok(await page.locator('[data-appointment-details-dialog]').isVisible());
      assert.match(await page.locator('[data-details-client]').textContent(),/long surname/);
      assert.equal(await page.locator('[data-details-time]').textContent(),'12:00–13:30');
      await page.locator('[data-details-close]').click();
      assert.equal(await page.evaluate(()=>document.activeElement.dataset.eventId),'appointment-5');
      await card.press('Space');await page.locator('[data-details-done]').click();
      // Notes stays a separate native button; it must not open the details dialog.
      await page.locator('[data-event-id="appointment-5"] [data-notes-indicator]').click();
      assert.ok(!(await page.locator('[data-appointment-details-dialog]').isVisible()));
      await page.locator('[data-appointment-notes-form] textarea').waitFor({state:'visible'});assert.equal(await page.locator('[data-appointment-notes-form] textarea').inputValue(),'Synthetic internal note');
      await page.locator('[data-panel-close]').click();
      await page.locator('[data-phone-staff-menu-summary]').click();
      await page.locator('[data-phone-week-staff-id="55"]').click();
      assert.equal(await page.locator('[data-phone-staff-column-id]').count(),5);
      await page.locator('[data-phone-week-staff-id="56"]').click();
      assert.equal(await page.locator('[data-phone-staff-column-id]').count(),6);
      const retained=page.url();await page.reload();assert.equal(await page.locator('[data-phone-staff-column-id]').count(),6);assert.ok(retained.includes('phoneStaff=all'));
      await page.goto(origin+'/?view=week&staff=all');assert.equal(await page.locator('[data-phone-staff-column-id]').count(),6);
      await page.goto(origin+'/?view=week&staff=all&phoneStaff=default');assert.equal(await page.locator('[data-phone-staff-column-id]').count(),4);
      await page.goto(origin+'/?view=week&staff=55&phoneStaff=default');assert.equal(await page.locator('[data-phone-staff-column-id="55"]').count(),1);
      await page.goto(origin+'/?view=week&phoneStaff=999');assert.equal(await page.locator('[data-phone-staff-column-id]').count(),0);
      await page.goto(origin+'/?view=week&subset=overflow');assert.equal(await page.locator('[data-phone-staff-column-id]').count(),0);await page.locator('[data-phone-staff-menu-summary]').click();await page.locator('[data-phone-week-staff-id="55"]').click();assert.equal(await page.locator('[data-phone-staff-column-id]').count(),1);
      await page.goto(origin+'/?view=week&phoneStaff=51');assert.equal(await page.locator('[data-phone-staff-column-id]').count(),1);
      await page.goto(origin+'/?view=week&staff=55');assert.equal(await page.locator('[data-phone-staff-column-id="55"]').count(),1);
      await page.goto(origin+'/?view=week&phoneStaff=none');assert.equal(await page.locator('[data-phone-staff-column-id]').count(),0);
      await page.goto(origin+'/?view=week&subset=1');assert.equal(await page.locator('[data-phone-staff-column-id]').count(),1);
      await page.goto(origin+'/?view=week&empty=1');assert.equal(await page.locator('.positioned-event').count(),0);
      // Exact coordinates, fixed display interval and selected therapist.
      for(const [fraction,time] of [[0,'08:00'],[0.5,'12:30'],[0.999,'16:30']]){
        await page.goto(origin+'/?view=week&empty=1');await page.waitForTimeout(50);
        const rect=await page.locator('[data-phone-active-day="true"] .time-column').boundingBox();
        
        await page.mouse.click(rect.x+rect.width*0.6,rect.y+Math.max(1,rect.height*fraction));
        await page.waitForURL('**/calendar/book?**');const u=new URL(page.url());assert.equal(u.searchParams.get('time'),time);assert.equal(u.searchParams.get('staff'),'53');assert.equal(u.searchParams.get('date'),DATE);
      }
      // Partial outliers keep their occupied intersection, overlap lanes and original actions.
      await page.goto(origin+'/?view=week&straddlers=1');await page.waitForTimeout(100);
      for(const [id,start,end,before,after] of [['appointment-14',480,510,true,false],['appointment-15',990,1020,false,true],['calendar_block-32',480,510,true,false],['operational_leave-33',990,1020,false,true]]){
        const item=page.locator('.time-column [data-event-id="'+id+'"]').locator('..');
        const m=await item.evaluate(n=>{const r=n.getBoundingClientRect(),c=n.closest('.time-column').getBoundingClientRect();return{top:r.top-c.top,height:r.height,grid:c.height,before:n.dataset.phoneContinuesBefore,after:n.dataset.phoneContinuesAfter};});
        assert.ok(Math.abs(m.top-(start-480)/540*m.grid)<2,JSON.stringify(m));assert.ok(Math.abs(m.height-(end-start)/540*m.grid)<2,JSON.stringify(m));assert.equal(m.before,String(before));assert.equal(m.after,String(after));assert.ok(await item.locator('.phone-hours-continuation').isVisible());
      }
      assert.equal(await page.locator('[data-event-id="appointment-14"]').locator('..').getAttribute('data-phone-overlap-lanes'),'2');
      assert.equal(await page.locator('[data-event-id="appointment-15"]').locator('..').getAttribute('data-phone-overlap-lanes'),'2');
      const late=page.locator('[data-event-id="appointment-15"]');await late.click();assert.equal(await page.locator('[data-details-time]').textContent(),'16:30–17:30');await page.locator('[data-details-close]').click();
      const early=page.locator('[data-event-id="appointment-14"]');await early.focus();await early.press('Enter');assert.equal(await page.locator('[data-details-time]').textContent(),'07:30–08:30');await page.locator('[data-details-close]').click();
      // Even a blank lane gutter in occupied time must not suggest an empty booking slot.
      await page.evaluate(()=>{const c=document.querySelector('[data-phone-active-day="true"] .time-column'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*.60,clientY:r.top+r.height*525/540,button:0}));});assert.ok(page.url().includes('straddlers=1'));assert.equal(await page.locator('[data-details-time]').textContent(),'16:30–17:00');await page.locator('[data-details-close]').click();
      await page.locator('.phone-hours-exceptions summary').click();await page.locator('.phone-hours-reference').filter({hasText:'Synthetic Client 15'}).click();assert.equal(await page.locator('[data-details-time]').textContent(),'16:30–17:30');await page.locator('[data-details-close]').click();await page.locator('.phone-hours-reference').filter({hasText:'Synthetic early straddling block'}).click();assert.ok(await page.locator('[data-availability-form="block"]').isVisible());assert.equal(await page.locator('[data-availability-form="block"] input[name="starts"]').inputValue(),'07:30');assert.equal(await page.locator('[data-availability-form="block"] input[name="ends"]').inputValue(),'08:30');await page.locator('[data-availability-close]').click();await page.locator('.phone-hours-exceptions summary').click();await page.waitForTimeout(100);
      await page.screenshot({path:path.join(OUT,`straddlers-${width}-${height}.png`)});const straddlerA11y=await new AxeBuilder({page}).include('.calendar-view').analyze();fs.writeFileSync(path.join(OUT,`straddlers-a11y-${width}-${height}.json`),JSON.stringify(straddlerA11y.violations,null,2));assert.deepEqual(straddlerA11y.violations.filter(v=>['serious','critical'].includes(v.impact)),[]);
      if(width===390){await page.goto(origin+'/?view=week');await Promise.all([page.waitForEvent('load'),page.setViewportSize({width:701,height})]);assert.equal(await page.locator('[data-phone-staff-column-id]').count(),0);await Promise.all([page.waitForEvent('load'),page.setViewportSize({width:390,height})]);assert.equal(await page.locator('[data-phone-staff-column-id]').count(),4);}
      await page.goto(origin+'/?view=week');await page.addStyleTag({content:'html{font-size:200%}'});await page.waitForTimeout(100);
      const largeTextBounds=await page.evaluate(()=>{const rail=document.querySelector('.week-time-grid .time-rail').getBoundingClientRect(),column=document.querySelector('[data-phone-active-day="true"] .time-column').getBoundingClientRect(),header=document.querySelector('.phone-staff-column-header').getBoundingClientRect(),notice=document.querySelector('.phone-day-notices').getBoundingClientRect();const view=document.querySelector('.calendar-view').getBoundingClientRect();return{view:{top:view.top,bottom:view.bottom},largeTextScroll:document.body.dataset.phoneLargeTextScroll,rootFontSize:parseFloat(getComputedStyle(document.documentElement).fontSize),rail:{left:rail.left,right:rail.right,width:rail.width,top:rail.top,bottom:rail.bottom},column:{left:column.left,right:column.right},header:{left:header.left,right:header.right},notice:{left:notice.left},scroll:document.documentElement.scrollWidth,labels:[...document.querySelectorAll('.time-rail span')].filter(n=>getComputedStyle(n).display!=='none').map(n=>{const r=n.getBoundingClientRect();return{text:n.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,fontSize:getComputedStyle(n).fontSize};})};});
      assert.ok(largeTextBounds.rail.width>32,JSON.stringify(largeTextBounds));assert.equal(largeTextBounds.labels.length,10);for(const label of largeTextBounds.labels){assert.ok(label.top>=largeTextBounds.rail.top-.1&&label.bottom<=largeTextBounds.rail.bottom+.1,JSON.stringify({width,height,label,rail:largeTextBounds.rail}));assert.ok(label.left>=largeTextBounds.rail.left&&label.right<=largeTextBounds.rail.right,JSON.stringify({width,height,label,rail:largeTextBounds.rail}));assert.ok(Math.abs(parseFloat(label.fontSize)-metrics.labelFont*2)<.1,JSON.stringify({label,rootFontSize:largeTextBounds.rootFontSize}));}
      for(let i=1;i<largeTextBounds.labels.length;i++)assert.ok(largeTextBounds.labels[i].top>=largeTextBounds.labels[i-1].bottom-.1,JSON.stringify(largeTextBounds.labels));
      assert.ok(Math.abs(largeTextBounds.header.left-largeTextBounds.column.left)<2,JSON.stringify(largeTextBounds));assert.ok(Math.abs(largeTextBounds.notice.left-largeTextBounds.column.left)<2,JSON.stringify(largeTextBounds));assert.ok(largeTextBounds.scroll<=width+1);fs.writeFileSync(path.join(OUT,`large-font-bounds-${width}-${height}.json`),JSON.stringify(largeTextBounds,null,2));
      if(largeTextBounds.largeTextScroll==='true'){await page.locator('.calendar-view').evaluate(n=>{n.scrollTop=n.scrollHeight;});const closing=await page.locator('.time-rail span').filter({hasText:'17:00'}).boundingBox();assert.ok(closing.y>=largeTextBounds.view.top&&closing.y+closing.height<=largeTextBounds.view.bottom+1,JSON.stringify({closing,view:largeTextBounds.view}));await page.screenshot({path:path.join(OUT,`large-font-end-${width}-${height}.png`)});}
      // The resized rail cannot shift empty-cell staff or time conversion.
      await page.goto(origin+'/?view=week&empty=1');await page.addStyleTag({content:'html{font-size:200%}'});await page.waitForTimeout(100);const enlargedGrid=await page.locator('[data-phone-active-day="true"] .time-column').boundingBox();await page.mouse.click(enlargedGrid.x+enlargedGrid.width*.60,enlargedGrid.y+enlargedGrid.height*.5);await page.waitForURL('**/calendar/book?**');const enlargedTarget=new URL(page.url());assert.equal(enlargedTarget.searchParams.get('time'),'12:30');assert.equal(enlargedTarget.searchParams.get('staff'),'53');
      await page.goto(origin+'/?view=week');await page.addStyleTag({content:'html{font-size:200%}'});await page.waitForTimeout(100);await page.screenshot({path:path.join(OUT,`large-font-${width}-${height}.png`)});
      assert.deepEqual(errors,[]);results.push({width,height,events:metrics.events.length,hours:metrics.hours,checks:'geometry,adjacency,overlap,filters,details,notes,exact taps,straddling appointments/blocks/leave/occupied gutters,large font/label bounds/enlarged exact taps'});
      await context.close();
    }
    const compare=await browser.newPage({viewport:{width:390,height:844}});await compare.goto(origin+'/?view=week&normal=1');await compare.waitForTimeout(100);await compare.screenshot({path:path.join(OUT,'candidate.png')});if(baselineAvailable){await compare.goto(origin+'/?view=week&normal=1&baseline=1');await compare.waitForTimeout(100);await compare.screenshot({path:path.join(OUT,'expected.png')});}await compare.close();
    fs.writeFileSync(path.join(OUT,'proof.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length+1,results}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
