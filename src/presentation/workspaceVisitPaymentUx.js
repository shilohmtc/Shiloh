'use strict';
function visitPaymentScript() {
  return String.raw`(()=>{'use strict';
window.ShilohVisitPayment=function(id,complete){return new Promise(resolve=>{
 const previousFocus=document.activeElement,dialog=document.createElement('dialog');let completed=false,submitted=false,busy=false,pending=null;
 dialog.className='outcome-dialog visit-payment-dialog';dialog.setAttribute('aria-label','Complete visit and payment');
 dialog.innerHTML='<style>.visit-payment-dialog [hidden]{display:none!important}.visit-payment-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.visit-payment-heading h2{margin:0}.visit-payment-dialog [data-visit-payment-actions]{display:flex;flex-wrap:wrap;gap:10px}.visit-payment-dialog form{display:grid;gap:12px;width:100%}.visit-payment-dialog input:not([type=checkbox]),.visit-payment-dialog select{width:100%;min-width:0;min-height:44px;padding:10px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--ink);font:inherit}.visit-payment-dialog input[type=checkbox]{width:20px;height:20px;flex-shrink:0}.visit-payment-dialog .action-button{min-height:44px}.visit-payment-dialog details{width:100%}.visit-payment-dialog form button{background:var(--leaf-soft);color:var(--leaf-deep)}</style><div class="outcome-dialog-body"><div class="visit-payment-heading"><h2>Complete visit</h2><button class="action-button" type="button" data-visit-payment-close aria-label="Close payment window">Close</button></div><p data-visit-payment-copy>Checking recorded payments…</p><div data-visit-payment-actions></div><p role="status" data-visit-payment-status></p></div>';
 document.body.append(dialog);dialog.showModal();
 const copy=dialog.querySelector('[data-visit-payment-copy]'),actions=dialog.querySelector('[data-visit-payment-actions]'),status=dialog.querySelector('[data-visit-payment-status]');
 function close(){dialog.close();dialog.remove();if(previousFocus&&previousFocus.isConnected)previousFocus.focus();resolve({completed,uncertain:submitted&&!completed});}
 dialog.querySelector('[data-visit-payment-close]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 function button(label,action){const b=document.createElement('button');b.className='action-button';b.type='button';b.textContent=label;b.onclick=action;return b;}
 function options(){const details=document.createElement('details'),summary=document.createElement('summary'),link=document.createElement('a');summary.textContent='Other payment options';link.className='action-button';link.href='/calendar/payments/appointments/'+encodeURIComponent(id);link.textContent='Review payments, vouchers and credit';details.append(summary,link);actions.append(details);}
 async function finish(decision){if(busy||completed)return;if(typeof complete!=='function'){status.textContent='Refresh Workspace before completing this visit.';return;}busy=true;submitted=true;if(!pending)pending=decision;actions.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);status.textContent=pending.choice==='paid'?'Saving payment and completing visit…':'Completing visit…';
  try{const result=await complete(pending);completed=true;if(!dialog.isConnected)return;dialog.querySelector('h2').textContent='Visit completed';const payment=result?.paymentOutcome;
   copy.textContent=payment?.choice==='paid'?'R'+Number(payment.amount).toFixed(2)+' payment recorded.'+(Number(payment.outstanding)>0?' R'+Number(payment.outstanding).toFixed(2)+' remains outstanding.':' No balance remains.') : pending.choice==='settled'?'No balance remains. Existing payments and credits are already accounted for.':'Payment was left outstanding for follow-up. No receipt was created.';
   status.textContent='The visit and your financial choice have been saved.';actions.replaceChildren(button('Done',close));actions.querySelector('button').focus();
  }catch(error){if(!dialog.isConnected)return;status.textContent=(error.message||'The result could not be confirmed.')+' Retry this unchanged choice, or close and review the booking before another attempt.';actions.querySelector('[data-payment-retry]')?.remove();const retry=button('Retry same choice',()=>finish(pending));retry.dataset.paymentRetry='';actions.append(retry);}finally{busy=false;}
 }
 function outstanding(){actions.append(button('Payment outstanding',()=>finish({choice:'outstanding'})));}
 async function load(){try{
  const response=await fetch('/calendar/payments/appointments/'+encodeURIComponent(id)+'/completion-state',{credentials:'same-origin',cache:'no-store'});const model=await response.json();if(!dialog.isConnected)return;
  if(!response.ok||model.priceReview||model.payment?.outstanding==null)throw Error('Payment details need review.');const due=Number(model.payment.outstanding);if(!Number.isFinite(due)||due<0)throw Error('Payment details need review.');
  if(due===0){copy.textContent='No balance remains after recorded payments and credits. Confirm to complete this visit.';actions.append(button('Complete visit · no balance due',()=>finish({choice:'settled'})));actions.querySelector('button').focus();return;}
  copy.textContent='R'+due.toFixed(2)+' remains after recorded payments and credits. Choose Paid or Payment outstanding before completing this visit.';
  if(model.authority?.canCollect&&!model.subject?.final){const paid=button('Paid',()=>{
   if(model.subject.groupId){copy.textContent='This is a shared booking balance. Record the payment with its payer in Payments, then return to complete this person’s visit.';return;}
   paid.hidden=true;const form=document.createElement('form');form.noValidate=true;form.innerHTML='<label style="display:grid;gap:6px">Amount received (R)<input name="amount" type="number" min="0.01" step="0.01" required></label><label style="display:grid;gap:6px">Payment method<select name="method" required><option value="">Choose payment method</option><option value="cash">Cash</option><option value="card_machine">Card</option><option value="manual_eft">EFT</option></select></label><label style="display:flex;gap:8px;padding:12px 0"><input type="checkbox" required> I confirm this money was received.</label><button class="action-button" type="submit">Record payment and complete visit</button>';
   form.elements.amount.value=due.toFixed(2);form.elements.amount.max=due.toFixed(2);actions.prepend(form);form.elements.amount.focus();form.onsubmit=event=>{event.preventDefault();if(!form.checkValidity()){status.textContent='Enter the amount and method, and confirm that the money was received.';form.reportValidity();return;}finish({choice:'paid',amount:form.elements.amount.value,method:form.elements.method.value,confirmed:true,expectedRevision:model.subject.pricingRevision,operationId:crypto.randomUUID()});};
  });actions.append(paid);}
  outstanding();options();actions.querySelector('button').focus();
 }catch(_error){if(!dialog.isConnected)return;copy.textContent='Payment details are unavailable. Choose Payment outstanding to leave payment for review, or Close to keep the visit unfinished.';outstanding();options();actions.querySelector('button').focus();}}
 load();
});};
})();`;
}
module.exports = { visitPaymentScript };
