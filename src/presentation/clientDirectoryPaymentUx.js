'use strict';
function directoryPaymentLabel(result) {
  if (result?.state === 'restricted') return { text: 'Payment details restricted', attention: false };
  const keys = ['completedVisits','outstandingVisits','sharedBookings','reviewNeeded','upcomingDeposits'];
  if (result?.state !== 'known' || keys.some(key => !Number.isSafeInteger(result[key]) || result[key] < 0)) return { text: 'Payment review unavailable', attention: false };
  const labels = [];
  if (result.outstandingVisits) labels.push('Completed visit: payment outstanding');
  if (result.sharedBookings) labels.push('Shared booking: review payment');
  if (result.reviewNeeded) labels.push('Payment needs review');
  if (result.upcomingDeposits) labels.push('Upcoming deposit to review');
  const attention = labels.length > 0;
  if (!attention) labels.push(result.completedVisits ? 'Linked completed visits: no balance remaining' : 'No linked completed visits');
  return { text: labels.join(' · '), attention };
}
function directoryPaymentScript() {
  return `(()=>{'use strict';
${directoryPaymentLabel.toString()}
const root=document.querySelector('[data-client-search-results]');if(!root||!window.fetch||!window.AbortController||!window.MutationObserver)return;
let controller,sequence=0;
async function review(){const current=++sequence;if(controller)controller.abort();controller=new AbortController();
const cards=[...root.querySelectorAll('[data-client-payment-id]')];if(!cards.length)return;
cards.forEach(card=>{card.textContent='Checking linked payments…';delete card.dataset.attention;});
const timeout=setTimeout(()=>{if(current===sequence){cards.forEach(card=>{card.textContent='Payment review unavailable';});controller.abort();}},10000);
try{const ids=cards.map(card=>card.dataset.clientPaymentId).join(',');const response=await fetch('/calendar/clients/payment-review?ids='+encodeURIComponent(ids),{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
if(!response.ok||response.redirected)throw Error('unavailable');const data=await response.json();if(current!==sequence)return;
for(const card of cards){const label=directoryPaymentLabel(data.reviews?.[card.dataset.clientPaymentId]);card.textContent=label.text;if(label.attention)card.dataset.attention='true';}

}catch(error){if(current!==sequence||error.name==='AbortError')return;cards.forEach(card=>{card.textContent='Payment review unavailable';});}finally{clearTimeout(timeout);}}
new MutationObserver(review).observe(root,{childList:true});review();
})();`;
}
module.exports = { directoryPaymentScript, directoryPaymentLabel };
