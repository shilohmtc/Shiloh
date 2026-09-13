const CLIENT_BROWSE_QUERY = '__shiloh_calendar_active_clients_v1__';

function calendarCreateBookingClientChoiceScript() {
  return `(function(){
'use strict';
var BROWSE_QUERY='${CLIENT_BROWSE_QUERY}';
var search=document.getElementById('client-search');
if(!search)return;
var field=search.closest('.field.wide');
if(!field)return;
var searchLabel=field.querySelector('label[for="client-search"]');
var searchActions=search.parentElement;
var searchAction=field.querySelector('[data-client-search]');
var results=field.querySelector('[data-client-results]');
var selected=field.querySelector('[data-selected-client]');
var newPanel=field.querySelector('[data-new-client-panel]');
var useNew=field.querySelector('[data-select-new-client]');
var newName=document.getElementById('new-client-name');
var newMobile=document.getElementById('new-client-mobile');
var review=document.querySelector('[data-review-booking]');
var status=document.querySelector('[data-booking-status]');
if(!searchLabel||!searchActions||!searchAction||!results||!newPanel)return;
var normalGuard=status&&status.nextElementSibling&&status.nextElementSibling.classList&&status.nextElementSibling.classList.contains('guard-note')?status.nextElementSibling:null;
if(normalGuard)normalGuard.remove();
var useNewActions=useNew&&useNew.closest?useNew.closest('.actions'):null;
if(useNewActions)useNewActions.hidden=true;
var newHint=newPanel.querySelector('.hint');
if(newHint)newHint.hidden=true;
var modeHeading=document.createElement('div');
modeHeading.className='hint';
modeHeading.textContent='Client';
modeHeading.style.fontWeight='750';
modeHeading.style.fontSize='.82rem';
var modeActions=document.createElement('div');
modeActions.className='actions';
modeActions.style.marginTop='6px';
modeActions.setAttribute('role','group');
modeActions.setAttribute('aria-label','Choose client');
var existingButton=document.createElement('button');
existingButton.type='button';
existingButton.className='button';
existingButton.textContent='Existing clients';
existingButton.setAttribute('data-client-mode-existing','');
existingButton.setAttribute('aria-pressed','true');
var searchButton=document.createElement('button');
searchButton.type='button';
searchButton.className='button secondary';
searchButton.textContent='Search clients';
searchButton.setAttribute('data-client-mode-search','');
searchButton.setAttribute('aria-pressed','false');
var newButton=document.createElement('button');
newButton.type='button';
newButton.className='button secondary';
newButton.textContent='Add new client';
newButton.setAttribute('data-client-mode-new','');
newButton.setAttribute('aria-pressed','false');
modeActions.appendChild(existingButton);
modeActions.appendChild(searchButton);
modeActions.appendChild(newButton);
var existingPanel=document.createElement('div');
existingPanel.setAttribute('data-existing-client-panel','');
field.insertBefore(modeHeading,searchLabel);
field.insertBefore(modeActions,searchLabel);
field.insertBefore(existingPanel,searchLabel);
existingPanel.appendChild(searchLabel);
existingPanel.appendChild(searchActions);
existingPanel.appendChild(results);
searchLabel.textContent='Search by name or mobile number';
function setStatus(message){if(!status)return;status.hidden=false;status.textContent=message;status.classList.remove('error','ready','warn');}
function hideStatus(){if(!status)return;status.hidden=true;status.textContent='';status.classList.remove('error','ready','warn');}
function clearVisibleSelection(){if(!selected)return;selected.hidden=true;selected.textContent='';selected.removeAttribute('data-client-selection');}
function buttonClass(active){return active?'button':'button secondary';}
function setMode(mode,preserveSelection){var isBrowse=mode==='browse';var isSearch=mode==='search';var isNew=mode==='new';existingPanel.hidden=isNew;newPanel.hidden=!isNew;searchLabel.hidden=!isSearch;searchActions.hidden=!isSearch;existingButton.className=buttonClass(isBrowse);searchButton.className=buttonClass(isSearch);newButton.className=buttonClass(isNew);existingButton.setAttribute('aria-pressed',isBrowse?'true':'false');searchButton.setAttribute('aria-pressed',isSearch?'true':'false');newButton.setAttribute('aria-pressed',isNew?'true':'false');if(!preserveSelection)window.dispatchEvent(new CustomEvent('calendar-client-mode',{detail:{mode:mode}}));}
function loadExistingClients(){setStatus('Loading existing clients…');search.value=BROWSE_QUERY;searchAction.click();search.value='';}
function syncModeDisabled(){searchButton.disabled=existingButton.disabled===true;}
function syncNewClientDraftFromFields(){if(!useNew||!newName||!newMobile)return;window.dispatchEvent(new CustomEvent('calendar-client-mode',{detail:{mode:'new'}}));clearVisibleSelection();var name=String(newName.value||'').trim().replace(/\\s+/g,' ');var mobile=String(newMobile.value||'').trim();if(name.length>=2&&mobile){useNew.click();clearVisibleSelection();if(review)review.disabled=false;}else if(review)review.disabled=false;hideStatus();}
existingButton.addEventListener('click',function(){if(existingButton.disabled)return;clearVisibleSelection();if(review)review.disabled=false;setMode('browse');loadExistingClients();});
searchButton.addEventListener('click',function(){if(existingButton.disabled)return;clearVisibleSelection();if(review)review.disabled=false;setMode('search');setStatus('Search for a client by name or mobile number, then explicitly select one result.');search.focus();});
newButton.addEventListener('click',function(){clearVisibleSelection();if(review)review.disabled=false;setMode('new');syncNewClientDraftFromFields();if(newName)newName.focus();});
if(newName)newName.addEventListener('input',syncNewClientDraftFromFields);
if(newMobile)newMobile.addEventListener('input',syncNewClientDraftFromFields);
results.addEventListener('click',function(event){var target=event.target.closest?event.target.closest('.client-result'):null;if(!target)return;window.setTimeout(function(){if(selected&&!selected.hidden&&selected.getAttribute('data-client-selection')==='existing'){setMode('browse',true);if(review)review.disabled=false;hideStatus();}},0);});
if(typeof MutationObserver==='function'){new MutationObserver(syncModeDisabled).observe(existingButton,{attributes:true,attributeFilter:['disabled']});}
syncModeDisabled();
setMode('browse');
loadExistingClients();
})();`;
}

module.exports = {
  CLIENT_BROWSE_QUERY,
  calendarCreateBookingClientChoiceScript,
};
