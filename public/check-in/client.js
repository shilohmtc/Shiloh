(function () {
  'use strict';
  var timer;
  function reset() {
    var token=document.querySelector('[name="checkinFormToken"]');
    if(!token){window.location.replace('/check-in/');return;}
    var form=document.createElement('form');form.method='post';form.action='/check-in/finish';
    var proof=document.createElement('input');proof.type='hidden';proof.name='checkinFormToken';proof.value=token.value;form.appendChild(proof);
    document.body.replaceChildren(form);form.submit();
  }
  function schedule() { window.clearTimeout(timer); timer = window.setTimeout(reset, 8 * 60 * 1000); }
  window.addEventListener('pageshow', function (event) { if (event.persisted) reset(); });
  ['pointerdown', 'keydown', 'input', 'scroll'].forEach(function (name) {
    document.addEventListener(name, schedule, { passive: true });
  });
  var handover = document.querySelector('[data-handover-expires]');
  if (handover && handover.dataset.handoverExpires) {
    window.setTimeout(reset, Math.max(0, Date.parse(handover.dataset.handoverExpires) - Date.now()));
  }
  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function () {
      // Keep the clicked submitter's name/value in the native POST.
      window.setTimeout(function () { form.querySelectorAll('button').forEach(function (button) { button.disabled = true; }); }, 0);
    });
  });
  schedule();
})();
