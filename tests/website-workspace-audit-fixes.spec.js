const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const fs=require('node:fs');
const path=require('node:path');
const {renderWorkspaceWebsite}=require('../src/presentation/workspaceWebsite');
const {workspaceNavigationClientScript}=require('../src/presentation/workspaceShell');
const {workspaceErrorRecoveryClientScript}=require('../src/presentation/workspaceErrorRecovery');
const {renderEditorialUnavailable}=require('../src/services/publicWebsite');
const {calendarHtml}=require('../stories/fixtures/workspaceBrowserReview');
const a='b06a730c-30ec-4245-9f98-2dc8eebbb2d0',b='c674d720-8358-4d16-aeb0-c85a7c0f5a16';
function posts(){return[a,b].map((id,i)=>({id,kind:'episode',slug:'synthetic-'+i,revision:1,published:null,draft:{title:'Synthetic '+i,summary:'Synthetic introduction',body:'Synthetic article content.',episode:i+1,imageId:null,imageAlt:'',startsAt:null,endsAt:null}}));}
async function editor(page){
  const model=posts(),writes=[];let tokenCount=0,tokenStatus=200,writeStatus=200,saveGate=null,historyGate=null;
  await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
  await page.route('**/calendar/workspace/nav.js',r=>r.fulfill({contentType:'application/javascript',body:workspaceNavigationClientScript()}));
  await page.route('**/calendar/workspace/navigation',r=>r.fulfill({json:{website:{allowed:true,href:'/calendar/website'}}}));
  await page.route('**/calendar/website/client.js',r=>r.fulfill({contentType:'application/javascript',body:workspaceErrorRecoveryClientScript()+fs.readFileSync(path.resolve('public/workspace/website.js'),'utf8')}));
  await page.route('**/audit-editor',r=>r.fulfill({contentType:'text/html',body:renderWorkspaceWebsite({model:{posts:model},csrfToken:'expired-page-token',displayName:'Synthetic Owner'})}));
  await page.route('**/calendar/staff-auth/csrf',r=>{tokenCount++;return r.fulfill({status:tokenStatus,json:tokenStatus===200?{csrfToken:'fresh-'+tokenCount}:{error:'Unauthorized'}});});
  await page.route('**/calendar/website/*/history',async r=>{
    const id=r.request().url().split('/').at(-2);if(id===a&&historyGate)await historyGate;
    return r.fulfill({json:[{revision:id===a?11:22,action:id===a?'A history':'B history',created_at:'2026-11-02T10:00:00Z'}]});
  });
  await page.route(/\/calendar\/website\/[^/]+\/(save|publish|unpublish|restore)$/,async r=>{
    const payload=r.request().postDataJSON(),id=r.request().url().split('/').at(-2);writes.push({id,payload,token:r.request().headers()['x-shiloh-csrf-token']});
    if(saveGate)await saveGate;
    if(writeStatus!==200)return r.fulfill({status:writeStatus,json:{error:writeStatus===403?'Forbidden':'Synthetic unavailable'}});
    const old=model.find(p=>p.id===id);const post={...old,revision:old.revision+1,draft:payload.document||{...old.draft,title:'Restored synthetic draft'}};model[model.indexOf(old)]=post;return r.fulfill({json:post});
  });
  await page.goto('/audit-editor',{waitUntil:'networkidle'});return{writes,model,set tokenStatus(v){tokenStatus=v},set writeStatus(v){writeStatus=v},delaySave(){return new Promise(resolve=>{let release;saveGate=new Promise(r=>release=r);resolve(()=>{saveGate=null;release()})})},delayHistory(){let release;historyGate=new Promise(r=>release=r);return()=>{historyGate=null;release()}},get tokenCount(){return tokenCount}};
}
for(const width of [390,1440]){
  test(`Website protects unsaved switching, new items, restore and leaving at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});const f=await editor(page);const choice=page.locator('[data-post-choice]'),title=page.getByLabel('Title',{exact:true});
    await choice.selectOption(a);await title.fill('Unsaved first draft');await choice.selectOption(b);
    await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');await page.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(choice).toHaveValue(a);await expect(title).toHaveValue('Unsaved first draft');expect(f.writes).toHaveLength(0);
    await page.getByRole('button',{name:'New episode',exact:true}).click();await page.keyboard.press('Escape');await expect(title).toHaveValue('Unsaved first draft');
    await page.locator('[data-history]').evaluate(n=>n.open=true);await page.getByRole('button',{name:'Restore as draft',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Keep editing',exact:true}).click();expect(f.writes).toHaveLength(0);
    const leaving=page.waitForEvent('dialog');await page.evaluate(()=>{window.syntheticDraftMarker=true;setTimeout(()=>location.reload(),0)});const leaveDialog=await leaving;expect(leaveDialog.type()).toBe('beforeunload');await leaveDialog.dismiss();expect(await page.evaluate(()=>window.syntheticDraftMarker)).toBe(true);await expect(title).toHaveValue('Unsaved first draft');
    await choice.selectOption(b);await expect(page.getByRole('dialog')).toBeVisible();expect((await new AxeBuilder({page}).include('[data-shiloh-confirm]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({path:info.outputPath(`discard-review-${width}.png`)});await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(choice).toHaveValue(b);await expect(title).toHaveValue('Synthetic 1');expect(f.writes).toHaveLength(0);
    await title.fill('Keep this if the dialog helper is unavailable');await page.evaluate(()=>{window.ShilohConfirm=null});await choice.selectOption(a);await expect(choice).toHaveValue(b);await expect(title).toHaveValue('Keep this if the dialog helper is unavailable');await expect(page.locator('[data-editor-status]')).toContainText('unsaved changes are kept');expect(f.writes).toHaveLength(0);
  });
  test(`Website distinguishes submitted text from later edits and preserves failures at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});const f=await editor(page);await page.locator('[data-post-choice]').selectOption(a);const title=page.getByLabel('Title',{exact:true}),status=page.locator('[data-editor-status]');
    await title.fill('Submitted title');const release=await f.delaySave();await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect.poll(()=>f.writes.length).toBe(1);await title.fill('Newer title while saving');release();await expect(status).toContainText('newer unsaved changes');await expect(title).toHaveValue('Newer title while saving');expect(f.writes[0].payload.document.title).toBe('Submitted title');
    await status.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`newer-unsaved-${width}.png`)});
    await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(status).toHaveText('Draft saved. The published version is unchanged.');expect(f.writes[1].payload.document.title).toBe('Newer title while saving');
    await title.fill('Preserve this failed edit');f.writeStatus=503;await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(status).toContainText('Synthetic unavailable');await expect(title).toHaveValue('Preserve this failed edit');expect(f.writes).toHaveLength(3);
    await expect(status.getByRole('button',{name:'Review and retry'})).toBeVisible();await page.getByRole('button',{name:'New episode',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  });
  test(`Website ignores superseded history and binds restore to the selected item at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});const f=await editor(page);const release=f.delayHistory();await page.locator('[data-post-choice]').selectOption(a);await page.locator('[data-post-choice]').selectOption(b);const versions=page.locator('[data-history-choice]');await expect(versions).toContainText('B history');release();await page.waitForTimeout(150);await expect(versions).not.toContainText('A history');await expect(versions.locator('option')).toHaveCount(1);
    await page.locator('[data-history]').evaluate(n=>n.open=true);await page.getByRole('button',{name:'Restore as draft',exact:true}).click();await expect(page.locator('[data-editor-status]')).toContainText('Restored as a draft');expect(f.writes).toHaveLength(1);expect(f.writes[0].id).toBe(b);expect(f.writes[0].payload.restoreRevision).toBe(22);
    await page.screenshot({path:info.outputPath(`current-history-${width}.png`),fullPage:true});
  });
  test(`Website refreshes operation tokens and retains edits through 401 and 403 at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});const f=await editor(page);await page.locator('[data-post-choice]').selectOption(a);await page.getByLabel('Title',{exact:true}).fill('Retain across recovery');const status=page.locator('[data-editor-status]');
    await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(status).toContainText('Draft saved');expect(f.writes[0].token).toBe('fresh-1');expect(f.writes[0].token).not.toBe('expired-page-token');
    await page.getByLabel('Title',{exact:true}).fill('Unsaved recovery draft');f.tokenStatus=401;await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(status).toContainText('session has expired');await expect(status.getByRole('link',{name:'Sign in to Workspace'})).toHaveAttribute('target','_blank');expect(f.writes).toHaveLength(1);
    await status.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`session-recovery-${width}.png`)});
    f.tokenStatus=200;f.writeStatus=403;await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(status).toContainText('could not authorize');await expect(status.getByRole('link',{name:'Open Website in a new tab'})).toHaveAttribute('target','_blank');await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Unsaved recovery draft');expect(f.writes).toHaveLength(2);
    expect((await new AxeBuilder({page}).include('[data-website-editor]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
    f.writeStatus=200;await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(status).toHaveText('Draft saved. The published version is unchanged.');expect(f.writes[2].token).toBe('fresh-4');expect(f.writes[2].payload.document.title).toBe('Unsaved recovery draft');
  });
  test(`public unavailable and missing editorial pages retain useful navigation at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    for(const missing of [false,true]){
      await page.route('**/audit-unavailable',r=>r.fulfill({status:missing?404:503,contentType:'text/html',body:renderEditorialUnavailable({currentPath:'/offers',missing})}));await page.goto('/audit-unavailable',{waitUntil:'networkidle'});await expect(page.getByRole('heading',{level:1})).toContainText(missing?'no longer available':'couldn’t load');await expect(page.locator('main').getByRole('link',{name:'Contact Shiloh'})).toHaveAttribute('href','/contact');await expect(page.locator('main').getByRole('link',{name:'Home',exact:true})).toHaveAttribute('href','/');await expect(page.locator('main').getByRole('link',{name:'Try again'})).toHaveCount(missing?0:1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);await page.screenshot({path:info.outputPath(`editorial-${missing?'missing':'unavailable'}-${width}.png`),fullPage:true});
    }
  });
}
for(const width of [1180,1440])test(`whole desktop Calendar passes contrast in empty and populated Team day at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.resolve('public/assets/pwa/shiloh-pwa-192.png')}));
  for(const empty of [true,false]){await page.route('**/audit-calendar',r=>r.fulfill({contentType:'text/html',body:calendarHtml(empty)}));await page.goto('/audit-calendar',{waitUntil:'networkidle'});await expect(page.locator('.desktop-practitioner-grid')).toBeVisible();expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`calendar-${empty?'empty':'populated'}-${width}.png`),fullPage:true});}
});
