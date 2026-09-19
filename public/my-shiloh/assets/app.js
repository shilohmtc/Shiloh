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
  const experienceHome = document.querySelector('[data-client-experience-home]');
  const experienceBookings = document.querySelector('[data-client-experience-bookings]');
  const experiencePrompts = document.querySelector('[data-client-experience-prompts]');
  const shilohMessages = document.querySelector('[data-shiloh-messages]');
  const shilohChatForm = document.querySelector('[data-shiloh-chat-form]');
  const shilohChatInput = document.querySelector('[data-shiloh-chat-input]');
  const shilohChatSend = document.querySelector('[data-shiloh-chat-send]');
  const shilohPromptButtons = [...document.querySelectorAll('[data-shiloh-prompt]')];
  let deferredInstallPrompt = null;
  let authActionInFlight = false;
  let shilohMessageInFlight = false;

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

  function safeExperienceHref(value) {
    const href = String(value || '');
    if (href === '/book' || /^\/pay\/[A-Za-z0-9_-]{8,100}$/.test(href) || /^#[a-z-]+$/.test(href)) return href;
    return '#shiloh';
  }

  function renderClientExperience(experience) {
    if (!experience || experience.version !== 'my_shiloh_client_experience_v1') return;

    if (experienceHome && experience.home) {
      const eyebrow = experienceHome.querySelector('.eyebrow');
      const heading = experienceHome.querySelector('h2');
      const summary = experienceHome.querySelector(':scope > p');
      const status = experienceHome.querySelector('.status-pill');
      if (eyebrow) eyebrow.textContent = String(experience.home.eyebrow || 'Your Shiloh');
      if (heading) heading.textContent = String(experience.home.headline || 'Your Shiloh is ready.');
      if (summary) summary.textContent = String(experience.home.summary || '');
      if (status) status.textContent = String(experience.home.status || 'Ready');

      const facts = Array.isArray(experience.home.facts) ? experience.home.facts.slice(0, 3) : [];
      experienceHome.querySelectorAll('.focus-grid > div').forEach((item, index) => {
        const fact = facts[index];
        if (!fact) return;
        const label = item.querySelector('span');
        const value = item.querySelector('strong');
        if (label) label.textContent = String(fact.label || '');
        if (value) value.textContent = String(fact.value || '');
      });

      let action = experienceHome.querySelector('[data-client-experience-primary]');
      if (!action) {
        action = document.createElement('a');
        action.className = 'button button--primary experience-primary';
        action.dataset.clientExperiencePrimary = '';
        experienceHome.appendChild(action);
      }
      action.textContent = String(experience.home.primaryAction?.label || 'Ask Shiloh');
      action.href = safeExperienceHref(experience.home.primaryAction?.href);
    }

    const upcoming = Array.isArray(experience.bookings?.upcoming) ? experience.bookings.upcoming[0] : null;
    if (experienceBookings) {
      const primary = experienceBookings.querySelector('.action-card');
      if (primary) {
        const heading = primary.querySelector('h2');
        const copy = primary.querySelector('p');
        const action = primary.querySelector('.button');
        if (upcoming) {
          if (heading) heading.textContent = String(upcoming.service || 'Upcoming appointment');
          if (copy) copy.textContent = [upcoming.date, upcoming.time, upcoming.practitioner].filter(Boolean).join(' · ');
          if (action) {
            action.textContent = 'Ask Shiloh about this booking';
            action.href = '#shiloh';
          }
        } else {
          if (heading) heading.textContent = 'Book something new';
          if (copy) copy.textContent = 'There is no upcoming appointment linked to your secure client profile right now.';
          if (action) {
            action.textContent = 'Start booking';
            action.href = '/book';
          }
        }
      }
    }

    if (experiencePrompts) {
      const prompts = Array.isArray(experience.assistant?.prompts) ? experience.assistant.prompts.slice(0, 4) : [];
      experiencePrompts.querySelectorAll('article strong').forEach((node, index) => {
        if (prompts[index]) node.textContent = String(prompts[index]);
      });
    }
  }

  function renderExperienceUnavailable() {
    if (!experienceHome) return;
    const heading = experienceHome.querySelector('h2');
    const summary = experienceHome.querySelector(':scope > p');
    const status = experienceHome.querySelector('.status-pill');
    if (heading) heading.textContent = 'Your private details are temporarily unavailable.';
    if (summary) summary.textContent = 'You can still book or continue with Shiloh while this reconnects.';
    if (status) status.textContent = 'Reconnect';
  }

  async function loadClientExperience() {
    if (appFrame?.dataset.clientAuthenticated !== 'true') return;
    try {
      const response = await fetch('/my-shiloh/api/experience', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('experience unavailable');
      const experience = await response.json();
      renderClientExperience(experience);
    } catch (_error) {
      renderExperienceUnavailable();
    }
  }

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

  function appendShilohMessage(role, message, { pending = false } = {}) {
    if (!shilohMessages) return null;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble--${role === 'user' ? 'user' : 'shiloh'}`;
    if (pending) bubble.dataset.pending = 'true';

    if (role !== 'user') {
      const label = document.createElement('span');
      label.textContent = 'Shiloh';
      bubble.appendChild(label);
    }

    const copy = document.createElement('p');
    copy.textContent = String(message || '');
    bubble.appendChild(copy);
    shilohMessages.appendChild(bubble);
    bubble.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    return bubble;
  }

  function setShilohBusy(busy) {
    shilohMessageInFlight = Boolean(busy);
    if (shilohChatInput) shilohChatInput.disabled = Boolean(busy);
    if (shilohChatSend) shilohChatSend.disabled = Boolean(busy);
    for (const button of shilohPromptButtons) button.disabled = Boolean(busy);
  }

  async function sendShilohMessage(value) {
    if (shilohMessageInFlight || appFrame?.dataset.clientAuthenticated !== 'true') return;
    const message = String(value || '').trim();
    if (!message || message.length > 1000) return;

    appendShilohMessage('user', message);
    if (shilohChatInput) shilohChatInput.value = '';
    setShilohBusy(true);
    const pending = appendShilohMessage('shiloh', 'Thinking about that…', { pending: true });

    try {
      const response = await postJson('/my-shiloh/api/shiloh/message', { message });
      const data = await response.json().catch(() => ({}));
      pending?.remove();
      if (!response.ok || !data.reply) {
        throw new Error(data.error || 'Shiloh could not answer that just now.');
      }
      appendShilohMessage('shiloh', data.reply);
    } catch (error) {
      pending?.remove();
      appendShilohMessage('shiloh', error.message || 'Shiloh could not answer that just now. Please try again.');
    } finally {
      setShilohBusy(false);
      shilohChatInput?.focus();
    }
  }

  shilohChatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendShilohMessage(shilohChatInput?.value || '');
  });

  shilohPromptButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = button.querySelector('strong')?.textContent || '';
      sendShilohMessage(prompt);
    });
  });

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

  loadClientExperience();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/my-shiloh/sw.js', { scope: '/my-shiloh/' }).catch(() => {
        // The PWA still works as a normal web app if registration is unavailable.
      });
    });
  }
})();
