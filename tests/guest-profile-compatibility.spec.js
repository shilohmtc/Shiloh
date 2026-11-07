const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {workspaceClientsManageClientScript}=require('../src/presentation/workspaceClientsManageUx');
for(const width of [390,1440])test(`canonical guest profile preserves an optional mobile at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 await page.goto('/iframe.html?id=workspace-clients--guest-without-mobile&viewMode=story',{waitUntil:'networkidle'});
 await expect(page.locator('[data-client-display="name"]')).toHaveText('Synthetic guest');
 await page.addScriptTag({content:workspaceClientsManageClientScript()});
 await page.getByRole('button',{name:'Edit profile',exact:true}).click();
 const mobile=page.locator('#edit-client-mobile');
 await expect(mobile).toBeVisible();
 await expect(mobile).toHaveValue('');
 expect(await mobile.evaluate(e=>e.required)).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`guest-profile-${width}.png`),fullPage:true});
});

test('ordinary client profile continues requiring its own mobile',async({page})=>{await page.goto('/iframe.html?id=workspace-clients--clinic-client-deletion&viewMode=story',{waitUntil:'networkidle'});await page.addScriptTag({content:workspaceClientsManageClientScript()});await page.getByRole('button',{name:'Edit profile',exact:true}).click();await expect(page.locator('#edit-client-mobile')).toBeVisible();expect(await page.locator('#edit-client-mobile').evaluate(e=>e.required)).toBe(true);});
