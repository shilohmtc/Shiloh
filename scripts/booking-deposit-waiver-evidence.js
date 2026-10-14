'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const {execFileSync}=require('node:child_process'),{chromium}=require('@playwright/test');
const {waiverFixture}=require('../stories/fixtures/bookingDepositWaiverPresentation');
const {renderCalendarPaymentPage}=require('../src/presentation/calendarPaymentsUx');
const root=path.resolve(__dirname,'..'),output=path.join(root,'artifacts/deposit-waiver/capture');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function main(){
 const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),dirty=Boolean(git('status','--porcelain','--untracked-files=no')),base=process.env.REVIEW_BASE_SHA||git('merge-base','HEAD','origin/main');
 if(process.env.EVIDENCE_EXPECTED_HEAD&&(head!==process.env.EVIDENCE_EXPECTED_HEAD||dirty))throw Error('Exact clean source required');
 const filename=path.join(root,'src/presentation/calendarPaymentsUx.js'),baseline=new Module(filename,module);baseline.filename=filename;baseline.paths=Module._nodeModulePaths(path.dirname(filename));baseline._compile(git('show',`${base}:src/presentation/calendarPaymentsUx.js`),filename);
 fs.mkdirSync(output,{recursive:true});const records=[],browser=await chromium.launch({...process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{},args:['--no-sandbox']});
 try{const page=await browser.newPage({locale:'en-ZA',timezoneId:'Africa/Johannesburg',reducedMotion:'reduce'});
 for(const shared of [false,true])for(const width of [1180,1440,390,500])for(const stage of ['before','after-pending','after-waived']){
  const kind=shared?'shared':'ordinary',model=waiverFixture({shared,waived:stage==='after-waived'}),html=(stage==='before'?baseline.exports.renderCalendarPaymentPage:renderCalendarPaymentPage)({model,csrfToken:'synthetic-csrf'}),name=`${kind}-${stage}-${width}.png`,renderedHtml=`${kind}-${stage}.html`;
  await page.setViewportSize({width,height:757});await page.route('**/synthetic-waiver-review',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('http://127.0.0.1/synthetic-waiver-review',{waitUntil:'networkidle'});await page.screenshot({path:path.join(output,name),fullPage:true});fs.writeFileSync(path.join(output,renderedHtml),html);
  const metrics=await page.evaluate(()=>({documentHeight:document.documentElement.scrollHeight,horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),waiverForms:document.querySelectorAll('[data-deposit-waiver-form]').length,waivedEvidence:document.querySelector('[data-deposit-waiver-evidence]')?.textContent||null,balances:[...document.querySelectorAll('.balance>span')].map(n=>n.textContent.trim()),controls:[...document.querySelectorAll('[data-deposit-waiver-form] button')].map(n=>({text:n.textContent,height:n.getBoundingClientRect().height,fontSize:getComputedStyle(n).fontSize}))}));
  if(metrics.horizontalOverflow>0||metrics.controls.some(c=>c.height<44))throw Error('Synthetic waiver layout guard failed');
  records.push({kind,stage,viewport:{width,height:757},filename:name,sha256:hash(fs.readFileSync(path.join(output,name))),renderedHtml,renderedHtmlSha256:hash(html),metrics});await page.unroute('**/synthetic-waiver-review');
 }
 const files=git('diff','--no-renames','--name-only',base,'HEAD').split('\n').filter(Boolean),deletedSourceFiles=files.filter(file=>!fs.existsSync(path.join(root,file)));const manifest={sourceHead:head,sourceTree:tree,baseCommit:base,dirty,browser:await browser.version(),fontProfileSha256:process.env.FONTCONFIG_FILE?hash(fs.readFileSync(process.env.FONTCONFIG_FILE)):null,patchSha256:hash(execFileSync('git',['diff','--no-renames',base,'HEAD'],{cwd:root,maxBuffer:16*1024*1024})),sourceFiles:files.filter(f=>!deletedSourceFiles.includes(f)).map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))})),deletedSourceFiles,provenance:'Synthetic ordinary/shared models only. Before and after-pending use identical financial values. After-waived changes only fabricated requirement/request status plus synthetic audit evidence; all actual financial values remain the same. Browser viewports, not installed-app or physical-device/live UI proof. Clean source/complete raw diff/image/HTML hashes bound to recorded head/tree.',records};fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Synthetic deposit waiver source-bound evidence captured.');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
