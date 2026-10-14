const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const review = require('../stories/fixtures/workspaceBrowserReview');
const root = path.resolve(__dirname,'..');
const output = path.join(root,'artifacts/workspace-browser-review');
const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const base = process.env.REVIEW_BASE_SHA || git('merge-base','HEAD','origin/main');
function baseline(file) {
  const filename=path.join(root,file), mod=new Module(filename,module);
  mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod._compile(git('show',`${base}:${file}`),filename);return mod.exports;
}
async function main() {
  const head=git('rev-parse','HEAD');
  if(process.env.EVIDENCE_EXPECTED_HEAD && head!==process.env.EVIDENCE_EXPECTED_HEAD) throw new Error('Evidence head mismatch');
  const dirty=git('status','--porcelain','--untracked-files=no').length>0;
  if(process.env.EVIDENCE_EXPECTED_HEAD && dirty) throw new Error('Evidence requires unchanged tracked source');
  fs.mkdirSync(output,{recursive:true});
  const beforeCalendar=baseline('src/presentation/calendarReadOnlyUx.js');
  const beforeMessages=baseline('src/presentation/workspaceMessagesUx.js');
  const beforeRewards=baseline('src/presentation/shilohRewardsUx.js');
  const beforeDashboard=baseline('src/presentation/workspaceDashboardUx.js');
  const beforeClients=baseline('src/presentation/workspaceClientsUx.js');
  const beforeManagement=baseline('src/presentation/workspaceClientsManageUx.js');
  const surfaces = [
    ['calendar-empty',review.calendarHtml(true,beforeCalendar.renderCalendarPage),review.calendarHtml(true)],
    ['calendar-populated',review.calendarHtml(false,beforeCalendar.renderCalendarPage),review.calendarHtml(false)],
    ['messages',review.messagesHtml(beforeMessages.renderMessagesPage),review.messagesHtml()],
    ['rewards',review.rewardsHtml(beforeRewards.renderWorkspaceRewardsPage),review.rewardsHtml()],
    ['dashboard',review.dashboardHtml(beforeDashboard.renderDashboardPage),review.dashboardHtml()],
    ['clients',review.clientsHtml(beforeClients.renderClientListPage,beforeManagement.injectClientListManagement),review.clientsHtml()],
    ...[false,true].map(linked=>{const {paymentFixture}=require('../tests/fixtures/bookingPaymentPresentation');const model=paymentFixture();model.subject.serviceName='Synthetic treatment';if(linked)model.subject.groupId=11;return [linked?'payment-linked':'payment-ordinary',baseline('src/presentation/calendarPaymentsUx.js').renderCalendarPaymentPage({model}),require('../src/presentation/calendarPaymentsUx').renderCalendarPaymentPage({model})];}),
  ];
  const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{}),args:['--no-sandbox']});
  const records=[];
  try {
    const page=await browser.newPage({locale:'en-ZA',timezoneId:'Africa/Johannesburg',reducedMotion:'reduce'});
    await page.route('**/calendar/pwa/icon-192.png*',r=>r.fulfill({path:path.join(root,'public/assets/pwa/shiloh-pwa-192.png')}));
    await page.route('**/calendar/**/*.js',r=>r.fulfill({contentType:'application/javascript',body:''}));
    await page.route('**/favicon.ico',r=>r.fulfill({status:204}));
    for(const [surface,before,after] of surfaces) for(const width of [1180,500]) for(const [stage,html] of [['before',before],['after',after]]) {
      const viewport={width,height:757};await page.setViewportSize(viewport);
      await page.route(`**/review-${surface}`,r=>r.fulfill({contentType:'text/html',body:html}));
      await page.goto(`http://127.0.0.1:6006/review-${surface}`,{waitUntil:'networkidle'});
      await page.locator('.workspace-main,[data-workspace-payment]').first().waitFor({state:'visible'});
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(img=>img.decode().catch(()=>{})));});
      const filename=`${stage}-${surface}-${width}.png`,htmlFile=`${stage}-${surface}.html`;
      fs.writeFileSync(path.join(output,htmlFile),html);
      await page.screenshot({path:path.join(output,filename),fullPage:true});
      records.push({surface,stage,viewport,filename,sha256:digest(fs.readFileSync(path.join(output,filename))),renderedHtml:htmlFile,renderedHtmlSha256:digest(html),data:'fabricated fixture only',browser:await browser.version()});
      await page.unroute(`**/review-${surface}`);
    }
    await page.setViewportSize({width:320,height:757});await page.route('**/review-zoom',r=>r.fulfill({contentType:'text/html',body:review.rewardsHtml()}));
    await page.goto('http://127.0.0.1:6006/review-zoom',{waitUntil:'networkidle'});await page.evaluate(()=>document.documentElement.style.fontSize='32px');
    const filename='after-rewards-320-text-200.png';await page.screenshot({path:path.join(output,filename),fullPage:true});
    records.push({surface:'rewards',stage:'after',viewport:{width:320,height:757},textScale:2,filename,sha256:digest(fs.readFileSync(path.join(output,filename))),data:'fabricated fixture only'});
  } finally {await browser.close();}
  const sourcePaths=git('diff','--name-only',base,'HEAD').split('\n').filter(Boolean);
  const sourceFiles=sourcePaths.filter(file=>fs.existsSync(path.join(root,file))).map(file=>({file,sha256:digest(fs.readFileSync(path.join(root,file)))}));
  const manifest={renderer:{fontconfigProfileSha256:process.env.FONTCONFIG_FILE ? digest(fs.readFileSync(process.env.FONTCONFIG_FILE)) : null,locale:'en-ZA',timezone:'Africa/Johannesburg'},baseCommit:base,baseTree:git('rev-parse',`${base}^{tree}`),sourceHead:head,sourceTree:git('rev-parse','HEAD^{tree}'),dirty,brandAsset:{path:'public/assets/pwa/shiloh-pwa-192.png',sha256:digest(fs.readFileSync(path.join(root,'public/assets/pwa/shiloh-pwa-192.png')))},patchSha256:digest(execFileSync('git',['diff',base],{cwd:root,maxBuffer:16*1024*1024})),sourceFiles,
    provenance:'Before: baseline presenters loaded from the recorded base using identical fabricated models and unchanged calendar enhancement scripts. After: working checkout production presenters. Both use the same locally installed Chromium and original repository logo. No live data or authenticated production UI. Only committed changed-source hashes are included; tracked source must be unchanged when an expected head is supplied. No installed app or physical device verification.',records};
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('Synthetic before/after evidence written with source, HTML and PNG digests.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
