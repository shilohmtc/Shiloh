(() => {
  'use strict';

  const viewNames = new Set(['home', 'bookings', 'shiloh', 'profile']);
  const views = [...document.querySelectorAll('[data-view]')];
  const navItems = [...document.querySelectorAll('[data-view-target]')];
  const installTrigger = document.querySelector('[data-install-trigger]');
  const installSheet = document.querySelector('[data-install-sheet]');
  const offlineBanner = document.querySelector('[data-offline-banner]');
  const appFrame = document.querySelector('[data-app-frame]');
  const authStartButtons = [...document.querySelectorAll('[data-client-auth-start]')];
  const authLogoutButtons = [...document.querySelectorAll('[data-client-auth-logout]')];
  const authCodeForms = [...document.querySelectorAll('[data-client-auth-code-form]')];
  const authStatusHosts = [...document.querySelectorAll('[data-auth-status]')];
  let deferredInstallPrompt = null;
  let authActionInFlight = false;

  function completionCodeFromHash() {
    const match = String(window.location.hash || '').match(/^#verify=(\d{6})$/);
    if (!match) return null;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return match[1];
  }

  const completionCode = completionCodeFromHash();

  function selectedView() {
    const fromHash = String(window.location.hash || '').replace(/^#/, '');
    return viewNames.has(fromHash) ? fromHash : 'home';
  }

  function activateView(name) {
    const target = viewNames.has(name) ? name : 'home';
    for (const view of views) {
      const active = view.dataset.view === target;
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    }
    for (const item of navItems) {
      if (item.dataset.viewTarget === target) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    const heading = document.querySelector(`[data-view="${target}"] h1`);
    if (heading && window.location.hash) heading.focus?.({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  window.addEventListener('hashchange', () => activateView(selectedView()));
  activateView(selectedView());

  function standalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches === true
      || window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
  }

  function showInstallButton() {
    if (installTrigger && !standalone()) installTrigger.hidden = false;
  }

  function openInstallGuide() {
    if (!installSheet) return;
    installSheet.hidden = false;
    document.body.style.overflow = 'hidden';
    installSheet.querySelector('.install-sheet__close')?.focus();
  }

  function closeInstallGuide() {
    if (!installSheet) return;
    installSheet.hidden = true;
    document.body.style.overflow = '';
    installTrigger?.focus();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButton();
  });

  if (isIos() && !standalone()) showInstallButton();

  installTrigger?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (standalone()) installTrigger.hidden = true;
      return;
    }
    openInstallGuide();
  });

  document.querySelectorAll('[data-install-close]').forEach((button) => {
    button.addEventListener('click', closeInstallGuide);
  });

  installSheet?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeInstallGuide();
  });

  window.addEventListener('appinstalled', () => {
    if (installTrigger) installTrigger.hidden = true;
    deferredInstallPrompt = null;
  });

  function syncNetworkState() {
    if (!offlineBanner) return;
    offlineBanner.hidden = window.navigator.onLine !== false;
  }
  window.addEventListener('online', syncNetworkState);
  window.addEventListener('offline', syncNetworkState);
  syncNetworkState();

  function setAuthStatus(message = '', state = '') {
    for (const host of authStatusHosts) {
      host.textContent = message;
      host.dataset.state = state;
    }
  }

  function setAuthControlsDisabled(disabled) {
    for (const button of [...authStartButtons, ...authLogoutButtons]) button.disabled = Boolean(disabled);
    for (const form of authCodeForms) {
      form.querySelectorAll('button,input').forEach((control) => { control.disabled = Boolean(disabled); });
    }
  }

  async function postJson(url, body = {}, extraHeaders = {}) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  }

  async function beginClientAuth() {
    if (authActionInFlight) return;
    authActionInFlight = true;
    setAuthControlsDisabled(true);
    setAuthStatus('Opening WhatsApp for secure verification…', 'working');
    try {
      const response = await postJson('/my-shiloh/auth/start');
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.whatsappUrl) throw new Error(data.error || 'Secure sign-in is unavailable.');
      window.location.href = data.whatsappUrl;
    } catch (error) {
      setAuthStatus(error.message || 'Secure sign-in is unavailable. Please try again.', 'error');
      setAuthControlsDisabled(false);
      authActionInFlight = false;
    }
  }

  async function completeClientAuth(code) {
    if (authActionInFlight || appFrame?.dataset.clientAuthenticated === 'true') return;
    const cleanCode = String(code || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      setAuthStatus('Enter the 6-digit code Shiloh sent you in WhatsApp.', 'error');
      return;
    }
    authActionInFlight = true;
    setAuthControlsDisabled(true);
    setAuthStatus('Finishing your secure sign-in…', 'working');
    try {
      const response = await postJson('/my-shiloh/auth/complete', { code: cleanCode });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.authenticated !== true) throw new Error(data.error || 'That one-time code could not be verified.');
      setAuthStatus('Verified. Opening your My Shiloh…', 'success');
      window.location.replace('/my-shiloh/');
    } catch (error) {
      setAuthStatus(error.message || 'That one-time code could not be verified.', 'error');
      setAuthControlsDisabled(false);
      authActionInFlight = false;
    }
  }

  async function logoutClient() {
    if (authActionInFlight) return;
    authActionInFlight = true;
    setAuthControlsDisabled(true);
    setAuthStatus('Signing out securely…', 'working');
    try {
      const csrfResponse = await postJson('/my-shiloh/auth/csrf');
      const csrf = await csrfResponse.json().catch(() => ({}));
      if (!csrfResponse.ok || !csrf.csrfToken) throw new Error('Could not start secure sign-out.');
      const response = await postJson('/my-shiloh/auth/logout', {}, {
        'x-shiloh-csrf-token': csrf.csrfToken,
      });
      if (!response.ok && response.status !== 204) throw new Error('Could not sign out.');
      window.location.replace('/my-shiloh/');
    } catch (error) {
      setAuthStatus(error.message || 'Could not sign out. Please try again.', 'error');
      setAuthControlsDisabled(false);
      authActionInFlight = false;
    }
  }

  authStartButtons.forEach((button) => button.addEventListener('click', beginClientAuth));
  authLogoutButtons.forEach((button) => button.addEventListener('click', logoutClient));
  authCodeForms.forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector('[data-client-auth-code]');
    completeClientAuth(input?.value || '');
  }));

  if (completionCode && appFrame?.dataset.clientAuthenticated !== 'true') {
    for (const input of document.querySelectorAll('[data-client-auth-code]')) {
      input.value = completionCode.replace(/^(\d{3})(\d{3})$/, '$1 $2');
    }
    completeClientAuth(completionCode);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/my-shiloh/sw.js', { scope: '/my-shiloh/' }).catch(() => {
        // The PWA still works as a normal web app if registration is unavailable.
      });
    });
  }
})();
