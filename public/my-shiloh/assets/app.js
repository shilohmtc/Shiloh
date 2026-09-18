(() => {
  'use strict';

  const viewNames = new Set(['home', 'bookings', 'shiloh', 'profile']);
  const views = [...document.querySelectorAll('[data-view]')];
  const navItems = [...document.querySelectorAll('[data-view-target]')];
  const installTrigger = document.querySelector('[data-install-trigger]');
  const installSheet = document.querySelector('[data-install-sheet]');
  const offlineBanner = document.querySelector('[data-offline-banner]');
  let deferredInstallPrompt = null;

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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/my-shiloh/sw.js', { scope: '/my-shiloh/' }).catch(() => {
        // The PWA still works as a normal web app if registration is unavailable.
      });
    });
  }
})();
