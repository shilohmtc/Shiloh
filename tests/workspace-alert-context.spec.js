const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
for(const width of [390,1440])test(`Workspace alert wording is readable at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/iframe.html?id=workspace-alert-context--examples&viewMode=story');
  const surface=page.locator('.alert-examples');
  await expect(surface).toBeVisible();
  await expect(surface.locator('article')).toHaveCount(4);
  await expect(surface.locator('article').first()).toContainText('Booking request update. Open Workspace to review.');
  await expect(surface.locator('article').last()).toContainText('Open Workspace to review updates.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.alert-examples').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`workspace-alert-context-${width}.png`),fullPage:true});
});
