(() => {
  'use strict';
  function render(root, quote) {
    const panel=root.querySelector('[data-offer-price]');if(!panel)return;
    const source=quote?.offerPricing || quote;
    if(!source?.items){panel.hidden=true;return;}
    const rand=value=>new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(Number(value));
    const subtotal=source.items.reduce((sum,item)=>sum+Math.round(Number(item.subtotal)*100),0)/100;
    const available=source.items.some(item=>Number(item.availableDiscount)>0);
    panel.querySelector('[data-offer-subtotal]').textContent=rand(subtotal);
    panel.querySelector('[data-offer-saving]').textContent=rand(source.discount);
    panel.querySelector('[data-offer-total]').textContent=rand(source.total);
    panel.querySelector('[data-offer-choice-wrapper]').hidden=!available;
    panel.querySelector('[data-offer-help]').textContent=available
      ? '20% off eligible first-visit treatments starting from 08:00 and before 12:00, excluding Saturdays.'
      : 'Your current treatment total is shown above. No Morning Welcome Offer saving applies to this selection.';
    panel.hidden=false;
  }
  window.ShilohOfferPricing={render};
})();
