'use strict';
const { test, expect } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { createWorkspaceOperationalRouter } = require('../src/routes/workspaceOperational');
const { createWorkspaceDashboardService } = require('../src/services/workspaceDashboard');
const { createWorkspaceDepositAttentionService } = require('../src/services/workspaceDepositAttention');
const { cookieName } = require('../src/middleware/staffBrowserSession');
const fs = require('node:fs');
const path = require('node:path');
let db, server, base, failure, delay, reads, writes;
const now = new Date('2026-10-06T12:00:00Z');
const owner = {id:1,display_name:'Synthetic owner',permissions:{'payment:view':true,'appointment:view':true},calendarAuthority:{calendarScope:'all_business',serviceScope:'all_services',businessRole:'owner',capabilities:['appointment:view']}};
const own = {...owner,id:2,calendarAuthority:{...owner.calendarAuthority,calendarScope:'own_appointments',serviceScope:'own_services',linkedStaffId:11,businessRole:'employee_practitioner',allowedServiceIds:[21]}};
const denied = {...owner,id:3,permissions:{'appointment:view':true}};
const principals={owner,own,denied};
const env={NODE_ENV:'test',SHILOH_CALENDAR_READONLY_UX_ENABLED:'true',SHILOH_STAFF_BROWSER_SESSION_CALENDAR_BRIDGE_ENABLED:'true'};

test.beforeAll(async()=>{
  db=new PGlite();await db.exec(require('./helpers/workspaceDepositFixture'));
  const deposits=createWorkspaceDepositAttentionService({db:{async query(sql,args){reads++;if(failure)throw Error('synthetic unavailable');if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(!/^\/\* WorkspaceDepositAttention:read \*\/\s+SELECT/.test(sql)){writes++;throw Error('domain write');}return db.query(sql,args);}},deposits:{loadPolicy:async()=>({enabled:true,effectiveFrom:new Date('2026-09-01')})}});
  const service=createWorkspaceDashboardService({
    resolvePrincipal:async id=>Object.values(principals).find(p=>p.id===id),
    calendarService:{buildModel:async()=>({dateKey:'2026-10-06',timeline:{appointments:[],staff:[],closures:[]}})},
    messagesService:{resolveAccess:async()=>null,buildModel:async()=>null},depositAttentionService:deposits,
  });
  const dashboard={buildModel:input=>service.buildModel({...input,now}),depositQueue:input=>service.depositQueue({...input,now})};
  const app=express();app.use((req,res,next)=>{if(req.method!=='GET')writes++;next();});
  app.get('/calendar/pwa/icon-192.png',(_req,res)=>res.sendFile(path.resolve('public/assets/pwa/shiloh-pwa-192.png')));
  app.get('/calendar/staff/client.js',(_req,res)=>res.type('js').send(''));
  app.get('/calendar/read-only',(_req,res)=>res.send('<a href="/calendar/workspace">Dashboard</a>'));
  app.use('/calendar/workspace',createWorkspaceOperationalRouter({env,dashboardService:dashboard,sessionService:{async validateSessionToken(token){const p=principals[token];return p?{ok:true,adminId:p.id,viewer:{calendarScope:p===own?'own_staff':'business_all_staff',staffId:11}}:{ok:false};}}}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));await db.close();});
test.beforeEach(async()=>{failure=false;delay=0;reads=0;writes=0;await db.exec("DELETE FROM payment_ledger_entries; INSERT INTO payment_ledger_entries VALUES(1,null,'payment',200),(1,null,'refund',50)");});

for(const [name,viewport] of [['phone',{width:390,height:844}],['desktop',{width:1440,height:1000}]]){
  test(`deposit queue ${name}: authenticated reads, refresh, navigation, settlement, errors and boundaries`,async({page,context})=>{
    await page.setViewportSize(viewport);
    await context.addCookies([{name:cookieName(env),value:'owner',url:base}]);
    const response=await page.goto(base+'/calendar/workspace');expect(response.headers()['cache-control']).toContain('no-store');
    const section=page.locator('[data-dashboard-deposits]');
    await expect(section.locator('[data-deposit-account]')).toHaveCount(1);
    await expect(section).toContainText('R350 deposit outstanding');await expect(section).toContainText('Synthetic Fynbos');
    await expect(section.getByRole('link',{name:'Review payment'})).toHaveAttribute('href','/calendar/payments/appointments/1');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
    fs.mkdirSync('artifacts/workspace-deposits',{recursive:true});await page.screenshot({path:`artifacts/workspace-deposits/${name}-awaiting.png`,fullPage:true});
    await section.getByRole('link',{name:'View booking'}).click();await page.getByRole('link',{name:'Dashboard'}).click();await expect(section).toContainText('R350');
    delay=600;await section.getByRole('button',{name:'Refresh deposits'}).click();await expect(section).toContainText('Checking current deposits');await expect(section.locator('[data-deposit-account]')).toHaveCount(0);await expect(section).toContainText('R350');delay=0;
    await db.exec("INSERT INTO payment_ledger_entries VALUES(1,null,'payment',350)");
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(section).toContainText('No upcoming bookings');
    await page.screenshot({path:`artifacts/workspace-deposits/${name}-empty.png`,fullPage:true});
    failure=true;await section.getByRole('button',{name:'Refresh deposits'}).click();await expect(section).toContainText('temporarily unavailable');await expect(section.locator('[data-deposit-account]')).toHaveCount(0);
    await page.screenshot({path:`artifacts/workspace-deposits/${name}-error.png`,fullPage:true});
    failure=false;await db.exec("INSERT INTO payment_ledger_entries VALUES(1,null,'refund',25)");await section.getByRole('button',{name:'Refresh deposits'}).click();await expect(section).toContainText('R25 deposit outstanding');
    await context.addCookies([{name:cookieName(env),value:'own',url:base}]);await page.reload();await expect(section).toContainText('No upcoming bookings');await expect(page.getByText('Synthetic Fynbos')).toHaveCount(0);
    await context.addCookies([{name:cookieName(env),value:'denied',url:base}]);await page.reload();await expect(section).toHaveCount(0);const before=reads;
    expect((await page.request.get(base+'/calendar/workspace/deposits')).status()).toBe(200);expect(reads).toBe(before);
    await context.clearCookies();expect((await page.request.get(base+'/calendar/workspace/deposits')).status()).toBe(401);expect(writes).toBe(0);
  });
  test(`deposit Storybook states ${name}`,async({page})=>{
    await page.setViewportSize(viewport);
    for(const state of ['awaiting-deposits','deposits-empty','deposits-loading','deposits-unavailable','deposits-restricted']){
      await page.goto(`/iframe.html?id=workspace-production-surfaces--dashboard-${state}&viewMode=story`, { waitUntil: 'networkidle' });
      await expect(page.locator('.workspace-frame')).toHaveCount(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact))).toEqual([]);
      await page.screenshot({path:path.join('artifacts/workspace-deposits',`${name}-storybook-${state}.png`),fullPage:true});
    }
  });
}
