'use strict';

const PWA_VERSION = '960-v1';
const PWA_BASE = '/calendar/pwa';
const STATIC_CACHE_PREFIX = 'shiloh-pwa-static-';
const STATIC_CACHE_NAME = `${STATIC_CACHE_PREFIX}${PWA_VERSION}`;
const ICON_URLS = Object.freeze([
  `${PWA_BASE}/icon-192.png?v=${PWA_VERSION}`,
  `${PWA_BASE}/icon-512.png?v=${PWA_VERSION}`,
  `${PWA_BASE}/icon-maskable-512.png?v=${PWA_VERSION}`,
]);
const SVG_ICON_URLS = Object.freeze([
  `${PWA_BASE}/icon-192.svg?v=${PWA_VERSION}`,
  `${PWA_BASE}/icon-512.svg?v=${PWA_VERSION}`,
]);

function workspacePwaManifest() {
  return {
    name: 'Shiloh',
    short_name: 'Shiloh',
    description: 'Shiloh Workspace for authorized clinic staff.',
    id: `${PWA_BASE}/launch`,
    start_url: `${PWA_BASE}/launch`,
    scope: '/calendar/',
    display: 'standalone',
    background_color: '#f7f5ef',
    theme_color: '#17382d',
    icons: [
      { src: ICON_URLS[0], sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: ICON_URLS[1], sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: ICON_URLS[2], sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

function workspacePwaIconSvg(size = 192) {
  const dimension = Number(size) === 512 ? 512 : 192;
  const inset = Math.round(dimension * 0.06);
  const radius = Math.round(dimension * 0.22);
  const markSize = Math.round(dimension * 0.4);
  const markX = Math.round((dimension - markSize) / 2);
  const markY = Math.round(dimension * 0.27);
  const stemWidth = Math.max(10, Math.round(dimension * 0.085));
  const stemX = Math.round((dimension - stemWidth) / 2);
  const stemY = Math.round(dimension * 0.48);
  const stemHeight = Math.round(dimension * 0.27);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" role="img" aria-label="Shiloh"><rect width="${dimension}" height="${dimension}" rx="${radius}" fill="#17382d"/><rect x="${inset}" y="${inset}" width="${dimension - inset * 2}" height="${dimension - inset * 2}" rx="${Math.round(radius * 0.78)}" fill="#f7f5ef"/><circle cx="${Math.round(dimension / 2)}" cy="${Math.round(dimension * 0.35)}" r="${Math.round(markSize / 2)}" fill="#496b5a"/><rect x="${stemX}" y="${stemY}" width="${stemWidth}" height="${stemHeight}" rx="${Math.round(stemWidth / 2)}" fill="#496b5a"/></svg>`;
}

function workspaceIosInstallGuideStyles() {
  return `.shiloh-ios-install{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));left:max(14px,env(safe-area-inset-left));z-index:130;color:#20322b;font:400 .94rem/1.42 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shiloh-ios-invite{box-sizing:border-box;display:grid;grid-template-columns:46px minmax(0,1fr);gap:12px;width:min(100%,430px);margin-left:auto;padding:14px;border:1px solid #cfdbd3;border-radius:18px;background:#fffdf9;box-shadow:0 14px 42px rgba(20,45,35,.2)}.shiloh-ios-mark{display:grid;place-items:center;width:46px;height:46px;border-radius:13px;background:#17382d;color:#fff;font-size:1.35rem;font-weight:850}.shiloh-ios-copy{min-width:0}.shiloh-ios-eyebrow{margin:0 0 2px;color:#496b5a;font-size:.68rem;font-weight:850;letter-spacing:.11em}.shiloh-ios-title{display:block;margin:0 0 2px;font-size:1.02rem}.shiloh-ios-description{margin:0;color:#5e7067;font-size:.88rem}.shiloh-ios-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px}.shiloh-ios-button{min-height:44px;border:1px solid #496b5a;border-radius:999px;padding:9px 15px;background:#496b5a;color:#fff;font:inherit;font-weight:800;cursor:pointer}.shiloh-ios-button.secondary{background:#fffdf9;color:#294c3c}.shiloh-ios-layer[hidden]{display:none}.shiloh-ios-layer{position:fixed;inset:0;z-index:131;display:grid;align-items:end}.shiloh-ios-backdrop{position:absolute;inset:0;width:100%;height:100%;border:0;background:rgba(14,31,25,.48);cursor:pointer}.shiloh-ios-sheet{position:relative;box-sizing:border-box;width:min(100%,520px);max-height:min(88vh,720px);margin:0 auto;padding:20px 20px max(20px,env(safe-area-inset-bottom));overflow:auto;border-radius:24px 24px 0 0;background:#fffdf9;box-shadow:0 -12px 44px rgba(14,31,25,.24)}.shiloh-ios-sheet-head{display:flex;align-items:start;justify-content:space-between;gap:16px}.shiloh-ios-sheet h2{margin:3px 0 6px;font-size:1.32rem;line-height:1.18}.shiloh-ios-sheet-intro{margin:0;color:#5e7067}.shiloh-ios-close{flex:0 0 44px;width:44px;height:44px;border:1px solid #d6dfd8;border-radius:999px;background:#fff;color:#20322b;font:700 1.4rem/1 system-ui;cursor:pointer}.shiloh-ios-steps{display:grid;gap:12px;margin:20px 0;padding:0;list-style:none;counter-reset:install-step}.shiloh-ios-step{counter-increment:install-step;display:grid;grid-template-columns:38px minmax(0,1fr);gap:12px;align-items:start;padding:13px;border:1px solid #dfe5df;border-radius:14px;background:#f5f8f5}.shiloh-ios-step:before{content:counter(install-step);display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#dfeae3;color:#294c3c;font-weight:850}.shiloh-ios-step strong{display:block;margin-bottom:2px}.shiloh-ios-step span{color:#5e7067;font-size:.88rem}.shiloh-ios-sheet .shiloh-ios-button{width:100%}@media(min-width:560px){.shiloh-ios-install{left:auto}.shiloh-ios-layer{align-items:center;padding:24px}.shiloh-ios-sheet{border-radius:24px}}@media(max-width:360px){.shiloh-ios-invite{grid-template-columns:40px minmax(0,1fr);padding:12px}.shiloh-ios-mark{width:40px;height:40px}.shiloh-ios-actions{display:grid;grid-template-columns:1fr 1fr}.shiloh-ios-button{padding-inline:10px}}`;
}

function workspaceIosInstallGuideMarkup({ open = false } = {}) {
  return `<div class="shiloh-ios-install" data-shiloh-ios-install><aside class="shiloh-ios-invite" aria-label="Install Shiloh"><div class="shiloh-ios-mark" aria-hidden="true">S</div><div class="shiloh-ios-copy"><p class="shiloh-ios-eyebrow">SHILOH APP</p><strong class="shiloh-ios-title">Keep Shiloh close</strong><p class="shiloh-ios-description">Open Calendar faster from your Home Screen.</p><div class="shiloh-ios-actions"><button class="shiloh-ios-button" type="button" data-shiloh-ios-install-open aria-controls="shiloh-ios-install-sheet" aria-expanded="${open}">Show me how</button><button class="shiloh-ios-button secondary" type="button" data-shiloh-ios-install-dismiss>Not now</button></div></div></aside><div class="shiloh-ios-layer" data-shiloh-ios-install-layer${open ? '' : ' hidden'}><button class="shiloh-ios-backdrop" type="button" tabindex="-1" aria-label="Close installation guide" data-shiloh-ios-install-close></button><section class="shiloh-ios-sheet" id="shiloh-ios-install-sheet" role="dialog" aria-modal="true" aria-labelledby="shiloh-ios-install-title"><header class="shiloh-ios-sheet-head"><div><p class="shiloh-ios-eyebrow">THREE QUICK STEPS</p><h2 id="shiloh-ios-install-title">Install Shiloh on iPhone</h2><p class="shiloh-ios-sheet-intro">Safari adds Shiloh securely to your Home Screen.</p></div><button class="shiloh-ios-close" type="button" aria-label="Close installation guide" data-shiloh-ios-install-close>×</button></header><ol class="shiloh-ios-steps"><li class="shiloh-ios-step"><div><strong>Tap Share</strong><span>Use the Share button in Safari’s toolbar.</span></div></li><li class="shiloh-ios-step"><div><strong>Choose Add to Home Screen</strong><span>Scroll through the actions if it is not immediately visible.</span></div></li><li class="shiloh-ios-step"><div><strong>Tap Add</strong><span>Then open Shiloh from its new Home Screen icon.</span></div></li></ol><button class="shiloh-ios-button" type="button" data-shiloh-ios-install-dismiss>Got it</button></section></div></div>`;
}

function workspacePwaHeadMarkup() {
  return [
    `<link rel="manifest" href="${PWA_BASE}/manifest.webmanifest?v=${PWA_VERSION}">`,
    '<meta name="theme-color" content="#17382d">',
    '<meta name="application-name" content="Shiloh">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<meta name="apple-mobile-web-app-title" content="Shiloh">',
    `<link rel="icon" href="${SVG_ICON_URLS[0]}" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" sizes="192x192" href="${ICON_URLS[0]}">`,
    `<script src="${PWA_BASE}/client.js?v=${PWA_VERSION}" defer></script>`,
  ].join('');
}

function decorateWorkspacePwaHtml(html) {
  const source = String(html || '');
  if (!source.includes('</head>') || source.includes(`${PWA_BASE}/manifest.webmanifest`)) return source;
  return source.replace('</head>', `${workspacePwaHeadMarkup()}</head>`);
}

function augmentWorkspacePwaCsp(value) {
  const original = String(value || '').trim();
  if (!original) return original;
  const additions = [];
  if (!/(?:^|;)\s*manifest-src\s+/i.test(original)) additions.push("manifest-src 'self'");
  if (!/(?:^|;)\s*worker-src\s+/i.test(original)) additions.push("worker-src 'self'");
  if (!additions.length) return original;
  return `${original.replace(/;?\s*$/, ';')} ${additions.join('; ')};`;
}

function workspacePwaOfflineDocument() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#17382d"><title>Shiloh — connection required</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#20322b;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.offline-shell{min-height:100vh;display:grid;place-items:center;padding:24px}.offline-card{width:min(440px,100%);padding:24px;border:1px solid #dfe5df;border-radius:18px;background:#fffdf9;box-shadow:0 8px 28px rgba(32,50,43,.08)}h1{margin:0 0 10px;font-size:1.5rem}p{margin:0 0 18px;color:#6c7d75;line-height:1.5}.retry{min-height:44px;border:1px solid #496b5a;border-radius:999px;padding:10px 16px;background:#496b5a;color:#fff;font:inherit;font-weight:750;cursor:pointer}</style></head><body><main class="offline-shell"><section class="offline-card" data-shiloh-pwa-offline><h1>Shiloh needs a live connection</h1><p>Protected Workspace information is not stored for offline use. Reconnect, then retry to refresh current clinic data and access.</p><button class="retry" type="button" onclick="location.reload()">Retry</button></section></main></body></html>`;
}

function workspacePwaServiceWorkerScript() {
  const iconUrls = JSON.stringify(ICON_URLS);
  const offline = JSON.stringify(workspacePwaOfflineDocument());
  return `'use strict';\nconst CACHE_NAME=${JSON.stringify(STATIC_CACHE_NAME)};\nconst CACHE_PREFIX=${JSON.stringify(STATIC_CACHE_PREFIX)};\nconst STATIC_URLS=${iconUrls};\nconst OFFLINE_HTML=${offline};\nself.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(STATIC_URLS)));});\nself.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});\nself.addEventListener('message',event=>{if(event.data&&event.data.type==='SHILOH_ACTIVATE_UPDATE')self.skipWaiting();});\nself.addEventListener('fetch',event=>{const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(url.origin!==self.location.origin)return;if(STATIC_URLS.includes(url.pathname+url.search)){event.respondWith(caches.open(CACHE_NAME).then(async cache=>(await cache.match(request))||fetch(request)));return;}if(request.mode==='navigate'&&url.pathname.startsWith('/calendar/')){event.respondWith(fetch(request).catch(()=>new Response(OFFLINE_HTML,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}})));}});\n`;
}

function workspacePwaClientScript() {
  const iosInstallStyles = JSON.stringify(workspaceIosInstallGuideStyles());
  const iosInstallMarkup = JSON.stringify(workspaceIosInstallGuideMarkup());
  return `(()=>{'use strict';
const PWA_BASE=${JSON.stringify(PWA_BASE)};
const SW_URL=PWA_BASE+'/sw.js?v=${PWA_VERSION}';
const SESSION_URL='/calendar/staff-auth/session';
const STAFF_ENTRY='/calendar/staff';
const PROTECTED_PREFIXES=['/calendar/workspace','/calendar/clients','/calendar/messages','/calendar/team','/calendar/services','/calendar/reports','/calendar/clinic-hours','/calendar/read-only','/calendar/book','/calendar/operations'];
const IOS_INSTALL_PATHS=['/calendar/workspace','/calendar/read-only'];
const INSTALL_DISMISS_KEY='shiloh-ios-install-dismissed-v1';
const IOS_INSTALL_STYLES=${iosInstallStyles};
const IOS_INSTALL_MARKUP=${iosInstallMarkup};
let revalidating=false,lastRevalidation=0,reloadingForUpdate=false,deferredInstallPrompt=null;
function standalone(){return (window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;}
function iosDevice(){const ua=String(window.navigator.userAgent||'');return /iPhone|iPad|iPod/i.test(ua)||(window.navigator.platform==='MacIntel'&&Number(window.navigator.maxTouchPoints||0)>1);}
function androidDevice(){return /Android/i.test(String(window.navigator.userAgent||''));}
function protectedPath(){return PROTECTED_PREFIXES.some(prefix=>location.pathname===prefix||location.pathname.startsWith(prefix+'/'));}
function removeInstallCard(selector){const node=document.querySelector(selector);if(node)node.remove();}
function installDismissed(){try{return sessionStorage.getItem(INSTALL_DISMISS_KEY)==='1';}catch(_error){return false;}}
function dismissInstallGuidance(){try{sessionStorage.setItem(INSTALL_DISMISS_KEY,'1');}catch(_error){}removeInstallCard('[data-shiloh-ios-install]');}
function installGuidanceEligible(){return iosDevice()&&!standalone()&&IOS_INSTALL_PATHS.includes(location.pathname)&&!installDismissed();}
function installGuidance(){if(!installGuidanceEligible()){removeInstallCard('[data-shiloh-ios-install]');return;}if(document.querySelector('[data-shiloh-ios-install]'))return;const container=document.createElement('div');container.innerHTML='<style>'+IOS_INSTALL_STYLES+'</style>'+IOS_INSTALL_MARKUP;const host=container.querySelector('[data-shiloh-ios-install]');const style=container.querySelector('style');const layer=host.querySelector('[data-shiloh-ios-install-layer]');const opener=host.querySelector('[data-shiloh-ios-install-open]');const closeButtons=host.querySelectorAll('[data-shiloh-ios-install-close]');const dismissButtons=host.querySelectorAll('[data-shiloh-ios-install-dismiss]');function setOpen(open){layer.hidden=!open;opener.setAttribute('aria-expanded',String(open));if(open){const close=host.querySelector('.shiloh-ios-close');if(close)close.focus();}else opener.focus();}opener.addEventListener('click',()=>setOpen(true));closeButtons.forEach(button=>button.addEventListener('click',()=>setOpen(false)));dismissButtons.forEach(button=>button.addEventListener('click',dismissInstallGuidance));host.addEventListener('keydown',event=>{if(event.key==='Escape'&&!layer.hidden){event.preventDefault();setOpen(false);}});host.prepend(style);document.body.appendChild(host);}
function installAction(){if(!androidDevice()||standalone()||!deferredInstallPrompt){removeInstallCard('[data-shiloh-browser-install]');return;}let card=document.querySelector('[data-shiloh-browser-install]');if(card)return;card=document.createElement('section');card.setAttribute('data-shiloh-browser-install','');card.setAttribute('role','note');card.style.cssText='box-sizing:border-box;margin:14px auto 0;width:min(calc(100% - 28px),680px);padding:16px 18px 16px 44px;border:1px solid #cfdad3;border-radius:16px;background:#f4f8f5;color:#20322b;box-shadow:0 6px 20px rgba(20,45,35,.08);font:400 .94rem/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';const eyebrow=document.createElement('div');eyebrow.textContent='INSTALL SHILOH';eyebrow.style.cssText='margin-bottom:5px;color:#496b5a;font-size:.72rem;font-weight:800;letter-spacing:.12em';const title=document.createElement('strong');title.textContent='Install Shiloh on this Android phone';title.style.cssText='display:block;margin-bottom:8px;font-size:1.05rem';const button=document.createElement('button');button.type='button';button.textContent='Install Shiloh';button.style.cssText='min-height:44px;border:1px solid #496b5a;border-radius:999px;padding:9px 15px;background:#496b5a;color:#fff;font:700 .9rem/1.2 system-ui,sans-serif;cursor:pointer';button.addEventListener('click',async()=>{const prompt=deferredInstallPrompt;if(!prompt)return;deferredInstallPrompt=null;removeInstallCard('[data-shiloh-browser-install]');await prompt.prompt();const choice=await prompt.userChoice.catch(()=>null);if(choice&&choice.outcome!=='accepted')deferredInstallPrompt=prompt;installAction();});card.append(eyebrow,title,button);const target=document.body.firstElementChild;document.body.insertBefore(card,target||null);}
function banner(){let node=document.querySelector('[data-shiloh-pwa-status]');if(node)return node;node=document.createElement('div');node.setAttribute('data-shiloh-pwa-status','');node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.hidden=true;node.style.cssText='position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));z-index:120;max-width:min(92vw,520px);transform:translateX(-50%);padding:10px 12px;border:1px solid #dfe5df;border-radius:12px;background:#fffdf9;color:#20322b;box-shadow:0 8px 26px rgba(20,45,35,.18);font:700 .78rem/1.35 system-ui,sans-serif;text-align:center';document.body.appendChild(node);return node;}
function status(message,action){const node=banner();node.textContent='';if(!message){node.hidden=true;return;}node.hidden=false;node.append(document.createTextNode(message));if(action){const button=document.createElement('button');button.type='button';button.textContent=action.label;button.style.cssText='margin-left:8px;border:1px solid #496b5a;border-radius:999px;padding:5px 9px;background:#496b5a;color:#fff;font:inherit;cursor:pointer';button.addEventListener('click',action.run);node.appendChild(button);}}
function viewerPermitsWorkspace(viewer){return !!(viewer&&typeof viewer==='object'&&(viewer.calendarScope==='own_staff'||viewer.calendarScope==='business_all_staff'));}
async function revalidate(){if(!standalone()||!protectedPath()||revalidating)return;const now=Date.now();if(now-lastRevalidation<15000)return;lastRevalidation=now;revalidating=true;try{const response=await fetch(SESSION_URL,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(response.status===401){location.replace(STAFF_ENTRY+'?reason=session');return;}if(!response.ok){status('Shiloh could not verify your live session. Retry when connected.');return;}const body=await response.json().catch(()=>({}));if(body.recoveryRequired===true){location.replace(STAFF_ENTRY+'?reason=session');return;}if(!viewerPermitsWorkspace(body.viewer)){location.replace(STAFF_ENTRY+'?reason=access');return;}status('');}catch(_error){status('Shiloh is offline. Protected Workspace data will refresh only after reconnection.');}finally{revalidating=false;}}
function updateReady(registration){const worker=registration&&registration.waiting;if(!worker)return;status('A Shiloh update is ready.',{label:'Update now',run:()=>{worker.postMessage({type:'SHILOH_ACTIVATE_UPDATE'});}});}
async function register(){if(!('serviceWorker'in navigator))return;try{const registration=await navigator.serviceWorker.register(SW_URL,{scope:'/calendar/',updateViaCache:'none'});updateReady(registration);registration.addEventListener('updatefound',()=>{const installing=registration.installing;if(!installing)return;installing.addEventListener('statechange',()=>{if(installing.state==='installed'&&navigator.serviceWorker.controller)updateReady(registration);});});navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloadingForUpdate)return;reloadingForUpdate=true;location.reload();});}catch(_error){status('Shiloh app updates are temporarily unavailable. Workspace still requires the live server.');}}
if(standalone())document.documentElement.dataset.shilohPwaMode='standalone';
addEventListener('beforeinstallprompt',event=>{if(!androidDevice()||standalone())return;event.preventDefault();deferredInstallPrompt=event;removeInstallCard('[data-shiloh-browser-install]');installAction();});
addEventListener('appinstalled',()=>{deferredInstallPrompt=null;removeInstallCard('[data-shiloh-browser-install]');removeInstallCard('[data-shiloh-ios-install]');document.documentElement.dataset.shilohPwaMode='standalone';});
installGuidance();installAction();
addEventListener('offline',()=>status('Shiloh is offline. Protected Workspace data is not available from cache.'));
addEventListener('online',()=>{status('Connection restored. Refreshing Shiloh…');lastRevalidation=0;revalidate();});
addEventListener('pageshow',()=>{installGuidance();installAction();lastRevalidation=0;revalidate();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){installGuidance();installAction();revalidate();}});
register();revalidate();
})();`;
}

module.exports = {
  PWA_VERSION,
  PWA_BASE,
  STATIC_CACHE_PREFIX,
  STATIC_CACHE_NAME,
  ICON_URLS,
  SVG_ICON_URLS,
  workspacePwaManifest,
  workspacePwaIconSvg,
  workspaceIosInstallGuideStyles,
  workspaceIosInstallGuideMarkup,
  workspacePwaHeadMarkup,
  decorateWorkspacePwaHtml,
  augmentWorkspacePwaCsp,
  workspacePwaOfflineDocument,
  workspacePwaServiceWorkerScript,
  workspacePwaClientScript,
};
