'use strict';

function workspaceBadgeWorkerScript() {
  return `
// Keep badge writes in the worker so a late foreground count cannot erase a newer push flag.
let badgeRevision=Date.now()+':'+Math.random();
function invalidateBadgeCount(){badgeRevision=Date.now()+':'+Math.random();}
async function updateAppBadge(count){try{const nav=self.navigator;if(!nav)return;if(count===0){if(typeof nav.clearAppBadge==='function')await nav.clearAppBadge();else if(typeof nav.setAppBadge==='function')await nav.setAppBadge(0);}else if(typeof nav.setAppBadge==='function'){if(count===undefined)await nav.setAppBadge();else await nav.setAppBadge(count);}}catch(_error){/* Optional OS cue; never interrupt visible notifications. */}}
self.addEventListener('message',event=>{const data=event.data||{};if(data.type==='SHILOH_BADGE_SNAPSHOT'&&event.ports&&event.ports[0])event.ports[0].postMessage(badgeRevision);if(data.type==='SHILOH_BADGE_CLEAR'){invalidateBadgeCount();event.waitUntil(updateAppBadge(0));}if(data.type==='SHILOH_BADGE_COUNT'&&data.revision===badgeRevision&&Number.isSafeInteger(data.count)&&data.count>=0)event.waitUntil(updateAppBadge(data.count));});
`;
}

// Included inside the existing notification control closure. No enrollment, polling, or stored count.
function workspaceBadgeClientScript() {
  return `
let badgeStopped=false,badgeRequest=0;
async function clearBadge(){badgeRequest++;try{const worker=navigator.serviceWorker&&navigator.serviceWorker.controller;if(worker)worker.postMessage({type:'SHILOH_BADGE_CLEAR'});}catch(_error){}try{if(typeof navigator.clearAppBadge==='function')await navigator.clearAppBadge();else if(typeof navigator.setAppBadge==='function')await navigator.setAppBadge(0);}catch(_error){}}
async function refreshBadge(){if(badgeStopped||document.visibilityState==='hidden'||typeof navigator.setAppBadge!=='function')return;try{const requestNumber=++badgeRequest;const worker=navigator.serviceWorker.controller;if(!worker)return;const revision=await new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve(null);},1000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};worker.postMessage({type:'SHILOH_BADGE_SNAPSHOT'},[channel.port2]);});if(!revision||badgeStopped)return;const response=await request('/calendar/workspace/attention-count',{credentials:'same-origin',cache:'no-store'});if(response.status===401||response.status===403){await clearBadge();return;}if(!response.ok)return;const body=await response.json();if(requestNumber===badgeRequest&&!badgeStopped&&document.visibilityState!=='hidden'&&Notification.permission==='granted'&&Number.isSafeInteger(body.count)&&body.count>=0)worker.postMessage({type:'SHILOH_BADGE_COUNT',revision,count:body.count});}catch(_error){/* Keep the existing cue on an unavailable count; never invent zero. */}}
document.addEventListener('click',event=>{if(event.target.closest&&event.target.closest('[data-shiloh-logout]')){badgeStopped=true;clearBadge();}},true);
if(location.pathname==='/calendar/staff'){badgeStopped=true;clearBadge();}
`;
}

module.exports = { workspaceBadgeWorkerScript, workspaceBadgeClientScript };
