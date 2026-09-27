(function () {
  'use strict';
  var timer;
  function reset() { window.location.replace('/check-in/'); }
  function schedule() { window.clearTimeout(timer); timer = window.setTimeout(reset, 5 * 60 * 1000); }
  window.addEventListener('pageshow', function (event) { if (event.persisted) reset(); });
  ['pointerdown', 'keydown', 'input', 'scroll'].forEach(function (name) {
    document.addEventListener(name, schedule, { passive: true });
  });
  schedule();
})();
