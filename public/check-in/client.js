(function () {
  'use strict';
  var timer, heartbeat, transitioning=false;
  function reset() {
    var token=document.querySelector('[name="checkinFormToken"]');
    if(!token){window.location.replace('/check-in/');return;}
    var confirmation=document.querySelector('[name="confirmationToken"]');
    var form=document.createElement('form');form.method='post';form.action='/check-in/finish';
    var proof=document.createElement('input');proof.type='hidden';proof.name='checkinFormToken';proof.value=token.value;form.appendChild(proof);
    if(confirmation){var bound=document.createElement('input');bound.type='hidden';bound.name='confirmationToken';bound.value=confirmation.value;form.appendChild(bound);}
    transitioning=true;window.clearInterval(heartbeat);document.body.replaceChildren(form);form.submit();
  }
  function schedule() { window.clearTimeout(timer); timer = window.setTimeout(reset, 8 * 60 * 1000); }
  window.addEventListener('pageshow', function (event) { if (event.persisted) reset(); });
  ['pointerdown', 'keydown', 'input', 'scroll'].forEach(function (name) {
    document.addEventListener(name, schedule, { passive: true });
  });
  var handover = document.querySelector('[data-handover-expires]');
  if (handover && handover.dataset.handoverExpires) {
    window.setTimeout(reset, Math.max(0, Date.parse(handover.dataset.handoverExpires) - Date.now()));
    heartbeat=window.setInterval(async function(){
      if(transitioning)return;
      try {
        var response=await fetch('/check-in/handover-current',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkinFormToken:document.querySelector('[name="checkinFormToken"]').value,confirmationToken:document.querySelector('[name="confirmationToken"]').value})});
        var current=response.ok && (await response.json()).current;
        if(!transitioning && !current)reset();
      } catch(_error){if(!transitioning)reset();}
    },3000);
  }
  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function () {
      transitioning=true;window.clearInterval(heartbeat);
      // Keep the clicked submitter's name/value in the native POST.
      window.setTimeout(function () { form.querySelectorAll('button').forEach(function (button) { button.disabled = true; }); }, 0);
    });
  });
  schedule();
})();
