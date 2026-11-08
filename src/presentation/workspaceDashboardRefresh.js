'use strict';

// Read the canonical projection after a confirmed save. Requests and their drafts
// are deliberately outside these sections and remain untouched.
function dashboardOutcomeRefreshScript() {
  return `(()=>{'use strict';window.ShilohDashboardSavedOutcome=async function(card){
    const section=card.closest('[data-dashboard-carryover-panel],[data-dashboard-today],[data-dashboard-attention-panel]');
    const target=section?.querySelector('[data-dashboard-section-status]')||document.querySelector('[data-dashboard-operation-status]');
    card.dataset.outcomeSaved='true';
    card.querySelectorAll('button').forEach(button=>{button.disabled=true;});
    if(target)target.textContent='Visit outcome saved. Updating the list…';
    try {
      const response=await fetch('/calendar/workspace',{credentials:'same-origin',cache:'no-store',headers:{Accept:'text/html'},signal:AbortSignal.timeout(15000)});
      if(!response.ok||response.redirected)throw Error('unavailable');
      const next=new DOMParser().parseFromString(await response.text(),'text/html');
      const selectors=['[data-dashboard-today]','[data-dashboard-carryover-panel]','[data-dashboard-activity-panel]'];
      if(!next.querySelector('[data-workspace-dashboard]')||selectors.some(selector=>!next.querySelector(selector)))throw Error('unavailable');
      const focusWasHere=section?.contains(document.activeElement)||document.activeElement===document.body;
      const sectionSelector=section?.matches('[data-dashboard-carryover-panel]')?'[data-dashboard-carryover-panel]':'[data-dashboard-today]';
      selectors.forEach(selector=>{const current=document.querySelector(selector);if(current)current.replaceWith(next.querySelector(selector));});
      // Exceptional outcome cards have no request inputs. Refresh those pieces
      // without replacing booking/enquiry drafts in Needs attention.
      if(card.isConnected){
        for(const selector of ['[data-dashboard-attention-queue]','[data-dashboard-attention-panel] .attention-summary','[data-dashboard-attention-panel]>.panel-head>.summary-pill']){
          const current=document.querySelector(selector),replacement=next.querySelector(selector);
          if(current){if(replacement)current.replaceWith(replacement);else current.remove();}
        }
        if(card.isConnected)card.remove();
      }
      const destination=document.querySelector(sectionSelector);
      const message=destination?.querySelector('[data-dashboard-section-status],[data-dashboard-operation-status]');
      if(message)message.textContent='Visit outcome saved. The list is up to date.';
      if(focusWasHere)destination?.focus({preventScroll:true});
    } catch(_error) {
      if(target){target.textContent='Visit outcome saved, but the list could not be refreshed. Review the booking before trying another outcome. ';const retry=document.createElement('button');retry.type='button';retry.className='button';retry.textContent='Refresh visit list';retry.addEventListener('click',()=>window.ShilohDashboardSavedOutcome(card));target.append(retry);target.focus({preventScroll:true});}
    }
  };})();`;
}

module.exports = { dashboardOutcomeRefreshScript };
