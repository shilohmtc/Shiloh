(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', '/forms/test');
    const status = document.getElementById('trial-entry-status');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      status.textContent = 'Please reopen the complete private test link that Shiloh shared with you.';
      return;
    }
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/forms/test/open';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'access_token';
    input.value = token;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  });
})();
