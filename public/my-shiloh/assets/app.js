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
  const authStatusHosts = [...document.querySelectorAll('[data-auth-status]')];
  let deferredInstallPrompt = null;
  let authPollTimer = null;

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

  function setAuthButtonsDisabled(disabled) {
    for (const button of [...authStartButtons, ...authLogoutButtons]) button.disabled = Boolean(disabled);
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
    setAuthButtonsDisabled(true);
    setAuthStatus('Opening WhatsApp for secure verification…', 'working');
    try {
      const response = await postJson('/my-shiloh/auth/start');
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.whatsappUrl) throw new Error(data.error || 'Secure sign-in is unavailable.');
      window.location.href = data.whatsappUrl;
    } catch (error) {
      setAuthStatus(error.message || 'Secure sign-in is unavailable. Please try again.', 'error');
      setAuthButtonsDisabled(false);
    }
  }

  async function checkClientAuthChallenge({ schedule = true } = {}) {
    if (appFrame?.dataset.clientAuthenticated === 'true') return;
    if (document.visibilityState === 'hidden') return;
    try {
      const response = await postJson('/my-shiloh/auth/status');
      if (response.status === 401) {
        setAuthStatus('');
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (response.status === 202) {
        setAuthStatus('Waiting for WhatsApp verification… Return here after Shiloh confirms you.', 'waiting');
        if (schedule) {
          window.clearTimeout(authPollTimer);
          authPollTimer = window.setTimeout(() => checkClientAuthChallenge({ schedule: true }), 2500);
        }
        return;
      }
      if (!response.ok || data.authenticated !== true) {
        setAuthStatus(data.error || 'That sign-in request is no longer available.', 'error');
        return;
      }
      setAuthStatus('Verified. Opening your My Shiloh…', 'success');
      window.location.replace('/my-shiloh/');
    } catch (_) {
      setAuthStatus('Secure sign-in will resume when your connection is available.', 'waiting');
    }
  }

  async function logoutClient() {
    setAuthButtonsDisabled(true);
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
      setAuthButtonsDisabled(false);
    }
  }

  authStartButtons.forEach((button) => button.addEventListener('click', beginClientAuth));
  authLogoutButtons.forEach((button) => button.addEventListener('click', logoutClient));

  window.addEventListener('pageshow', () => {
    if (appFrame?.dataset.clientAuthenticated !== 'true') checkClientAuthChallenge({ schedule: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && appFrame?.dataset.clientAuthenticated !== 'true') {
      checkClientAuthChallenge({ schedule: true });
    }
  });
  if (appFrame?.dataset.clientAuthenticated !== 'true') checkClientAuthChallenge({ schedule: true });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/my-shiloh/sw.js', { scope: '/my-shiloh/' }).catch(() => {
        // The PWA still works as a normal web app if registration is unavailable.
      });
    });
  }
})();
