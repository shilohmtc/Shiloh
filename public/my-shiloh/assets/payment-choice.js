/* global document, sessionStorage, location, crypto, fetch */
'use strict';
(() => {
  const root=document.querySelector('[data-payment-choice]'),form=root?.querySelector('[data-payment-choice-form]');
  if(!form)return;
  const submit=form.querySelector('[data-payment-submit]'),result=root.querySelector('[data-payment-result]'),status=root.querySelector('[data-payment-status]'),link=root.querySelector('[data-payment-continue]');
  const storageKey=`my-shiloh-payment-attempt:${root.dataset.appointment}`;
  let busy=false,attempt;
  try{attempt=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{attempt=null;}
  const selected=()=>form.querySelector('input[name=choice]:checked');
  const confirmed=()=>form.querySelector('input[name=confirmed]').checked;
  function update(){submit.disabled=busy||!selected()||!confirmed();}
  form.addEventListener('change',update);
  // Refresh/back may show an old form. The server still revalidates each attempt.
  addEventListener('pageshow',update);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!selected()||!confirmed())return;
    const choice=selected().value;
    if(attempt&&attempt.review===root.dataset.review&&attempt.choice!==choice){
      result.hidden=false;status.textContent='An earlier attempt must be reviewed before changing the amount. Refresh payment options or ask Reception.';return;
    }
    if(!attempt||attempt.review!==root.dataset.review)attempt={operationId:crypto.randomUUID(),choice,review:root.dataset.review};
    try{sessionStorage.setItem(storageKey,JSON.stringify(attempt));}catch{/* Server reservation also protects tabs without storage. */}
    busy=true;form.setAttribute('aria-busy','true');update();form.querySelectorAll('input').forEach(input=>{input.disabled=true;});result.hidden=false;link.hidden=true;status.textContent='Preparing your reviewed payment…';
    try{
      const response=await fetch('/my-shiloh/api/payments/collect',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-shiloh-csrf-token':root.dataset.csrf},body:JSON.stringify({...attempt,appointmentId:Number(root.dataset.appointment),confirmed:true})});
      const data=await response.json();
      if(!response.ok){status.textContent=String(data.error||'The payment could not be prepared. Refresh payment options before trying again.');return;}
      status.textContent=String(data.message||'Review the latest payment status before continuing.');
      if(data.status==='ready'&&/^\/pay\/[A-Za-z0-9_-]{8,100}$/.test(data.paymentPath||'')){
        link.href=data.paymentPath;link.hidden=false;
      }else if(data.status!=='paid')status.textContent='This attempt needs review before another amount can be prepared. Refresh payment options or ask Reception.';
    }catch(_){status.textContent='We could not confirm this attempt. The outcome may be unresolved. Refresh payment options or retry this same choice; do not start another amount.';}
    finally{busy=false;form.removeAttribute('aria-busy');form.querySelectorAll('input').forEach(input=>{input.disabled=false;});update();}
  });
})();
