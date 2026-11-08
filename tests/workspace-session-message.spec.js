const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
for(const viewport of [{name:'phone',width:390,height:844},{name:'desktop',width:1440,height:900}]) {
  test(`Workspace sign-in recovery explains the next action on ${viewport.name}`,async({page},testInfo)=>{
    await page.setViewportSize(viewport);
    await page.goto('/iframe.html?id=staff-detail-sign-in--session-ended&viewMode=story');
    await expect(page.getByRole('heading',{name:'Sign in to continue'})).toBeVisible();
    await expect(page.locator('[data-workspace-session-notice]')).toContainText('Please sign in again.');
    await expect(page.getByRole('link',{name:'Sign in with WhatsApp',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Use a saved passkey',exact:true})).toBeVisible();
    await expect(page.locator('[data-staff-detail-signin]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
    await page.screenshot({path:testInfo.outputPath(`session-message-${viewport.name}.png`),fullPage:true});
  });
}
