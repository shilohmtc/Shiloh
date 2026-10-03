'use strict';

// Shared by every Workspace menu and by the staff sign-in landing page.
// Binding is idempotent because both scripts can be present on one page.
function workspaceSignoutClientScript() {
  return `(()=>{
'use strict';
var AUTH_BASE='/calendar/staff-auth';
var ACCESS_PATH='/calendar/staff';
function select(selector){return document.querySelector(selector);}
function setStatus(state,message){var node=select('[data-shiloh-status]');if(!node)return;node.dataset.state=state;node.textContent=message;}
function setBusy(button,busy){if(button)button.disabled=!!busy;}
function postJson(url,payload,extraHeaders){return fetch(url,{method:'POST',credentials:'same-origin',cache:'no-store',headers:Object.assign({'Content-Type':'application/json','Accept':'application/json'},extraHeaders||{}),body:JSON.stringify(payload||{})});}
function safeJson(response){return response.json().catch(function(){return {};});}
async function logout(button){
  if(button.disabled)return;
  var status=select('[data-shiloh-calendar-access-status]');
  function workspaceStatus(message){if(status)status.textContent=message;else setStatus('pending',message);}
  setBusy(button,true);
  workspaceStatus('Signing out…');
  var csrfToken=null;
  try{
    var csrfResponse=await postJson(AUTH_BASE+'/csrf',{});
    if(csrfResponse.status===401){window.location.replace(ACCESS_PATH+'?reason=session');return;}
    if(!csrfResponse.ok){workspaceStatus('Could not start secure sign-out. Refresh and try again.');return;}
    var csrfBody=await safeJson(csrfResponse);
    csrfToken=String(csrfBody.csrfToken||'');
    if(!csrfToken){workspaceStatus('Could not start secure sign-out. Refresh and try again.');return;}
    var logoutResponse=await postJson(AUTH_BASE+'/logout',{}, {'x-shiloh-csrf-token':csrfToken});
    csrfToken=null;
    if(logoutResponse.status===204){window.location.replace(ACCESS_PATH+'?reason=logout');return;}
    if(logoutResponse.status===401){window.location.replace(ACCESS_PATH+'?reason=session');return;}
    workspaceStatus('Could not complete secure sign-out. Refresh and try again.');
  }catch(_error){
    csrfToken=null;
    workspaceStatus('Could not complete secure sign-out. Check your connection and try again.');
  }finally{setBusy(button,false);}
}


document.querySelectorAll('[data-shiloh-logout]').forEach(function(button){
  if(button.dataset.shilohLogoutBound==='true')return;
  button.dataset.shilohLogoutBound='true';
  button.addEventListener('click',function(){logout(button);});
});
})();`;
}

module.exports = { workspaceSignoutClientScript };
