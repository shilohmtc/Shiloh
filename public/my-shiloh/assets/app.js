(() => {
  'use strict';

  const viewNames = new Set(['home', 'bookings', 'shiloh', 'wallet', 'profile']);
  const views = [...document.querySelectorAll('[data-view]')];
  const navItems = [...document.querySelectorAll('[data-view-target]')];
  const installSheet = document.querySelector('[data-install-sheet]');
  const installGate = document.querySelector('[data-install-gate]');
  const installVerificationGate = document.querySelector('[data-install-verification-gate]');
  const installGateAction = document.querySelector('[data-install-gate-action]');
  const installGateTitle = document.querySelector('[data-install-gate-title]');
  const installGateCopy = document.querySelector('[data-install-gate-copy]');
  const installGateStatus = document.querySelector('[data-install-gate-status]');
  const websiteTreatmentHandoff = document.querySelector('[data-website-treatment-handoff]');
  const treatmentCodeCopy = document.querySelector('[data-copy-treatment-code]');
  const treatmentCopyStatus = document.querySelector('[data-copy-treatment-status]');
  const websiteTreatmentForm = document.querySelector('[data-website-treatment-form]');
  const installEyebrow = document.querySelector('[data-install-eyebrow]');
  const installTitle = document.querySelector('[data-install-title]');
  const installLead = document.querySelector('[data-install-lead]');
  const installStepTitles = [...document.querySelectorAll('[data-install-step-title]')];
  const installStepCopies = [...document.querySelectorAll('[data-install-step-copy]')];
  const installStepExtra = document.querySelector('[data-install-step-extra]');
  const installTip = document.querySelector('[data-install-tip]');
  const clientGreeting = document.querySelector('[data-client-greeting]');
  const INSTALL_VERIFIED_KEY = 'my-shiloh-install-whatsapp-verified-v1';
  const offlineBanner = document.querySelector('[data-offline-banner]');
  const appUpdateBanner = document.querySelector('[data-app-update]');
  const appUpdateAction = document.querySelector('[data-app-update-action]');
  const pushToggle = document.querySelector('[data-push-toggle]');
  const pushStatus = document.querySelector('[data-push-status]');
  const pushInvite = document.querySelector('[data-push-invite]');
  const appFrame = document.querySelector('[data-app-frame]');
  const authStartButtons = [...document.querySelectorAll('[data-client-auth-start]')];
  const passkeySignInButtons = [...document.querySelectorAll('[data-passkey-sign-in]')];
  const passkeyEnrollButton = document.querySelector('[data-passkey-enroll]');
  const passkeyEnrollStatus = document.querySelector('[data-passkey-enroll-status]');
  const authLogoutButtons = [...document.querySelectorAll('[data-client-auth-logout]')];
  const authCodeForms = [...document.querySelectorAll('[data-client-auth-code-form]')];
  const authStatusHosts = [...document.querySelectorAll('[data-auth-status]')];
  const experienceHome = document.querySelector('[data-client-experience-home]');
  const experienceFactButtons = [...document.querySelectorAll('[data-client-experience-fact]')];
  const experienceFactStatus = document.querySelector('[data-client-experience-fact-status]');
  const experienceBookings = document.querySelector('[data-client-experience-bookings]');
  const experiencePrompts = document.querySelector('[data-client-experience-prompts]');
  const shilohMessages = document.querySelector('[data-shiloh-messages]');
  const shilohChatForm = document.querySelector('[data-shiloh-chat-form]');
  const shilohChatInput = document.querySelector('[data-shiloh-chat-input]');
  const shilohChatSend = document.querySelector('[data-shiloh-chat-send]');
  const whatsappContinuation = document.querySelector('[data-whatsapp-continuation]');
  const whatsappContinuationAccept = document.querySelector('[data-whatsapp-continuation-accept]');
  const whatsappContinuationStatus = document.querySelector('[data-whatsapp-continuation-status]');
  const shilohPromptButtons = [...document.querySelectorAll('[data-shiloh-prompt]')];
  const clientProfileForm = document.querySelector('[data-client-profile-form]');
  const clientProfileStatus = document.querySelector('[data-client-profile-status]');
  const clientProfileMobile = document.querySelector('[data-client-profile-mobile]');
  const welcomeVoucherHost = document.querySelector('[data-welcome-voucher]');
  const welcomeVoucherCopy = document.querySelector('[data-welcome-voucher-copy]');
  const welcomeVoucherSteps = document.querySelector('[data-welcome-voucher-steps]');
  const welcomeVoucherBookings = document.querySelector('[data-welcome-voucher-bookings]');
  const welcomeVoucherTerms = document.querySelector('[data-welcome-voucher-terms]');
  const welcomeVoucherStatus = document.querySelector('[data-welcome-voucher-status]');
  const clientProblemReportForm = document.querySelector('[data-client-problem-report-form]');
  const clientProblemReportStatus = document.querySelector('[data-client-problem-report-status]');
  const clientProblemReportList = document.querySelector('[data-client-problem-report-list]');
  const clientNotificationList = document.querySelector('[data-client-notification-list]');
  const clientArchiveToggle = document.querySelector('[data-client-archive-toggle]');
  const notificationArchiveKey = appFrame?.dataset.notificationClientId
    ? `my-shiloh-archived-updates-v1:${appFrame.dataset.notificationClientId}` : null;
  let archivedUpdateIds = new Set();
  let showArchivedUpdates = false;
  let latestNotifications = [];
  if (notificationArchiveKey) {
    try {
      const stored = JSON.parse(localStorage.getItem(notificationArchiveKey) || '[]');
      if (Array.isArray(stored)) archivedUpdateIds = new Set(stored.filter(id => typeof id === 'string').slice(-100));
    } catch (_) {}
  }
  let deferredInstallPrompt = null;
  let authActionInFlight = false;
  let passkeyEnrollBusy = false;
  let authStatusCheckInFlight = false;
  let authStatusTimer = null;
  let shilohMessageInFlight = false;
  let whatsappHandoffStarted = false;
  let whatsappFallbackTimer = null;
  let whatsappExternalOpened = false;
  let welcomeVoucherRedeemedThisView = false;
  let clientProfileRevision = null;
  let clientRefreshInFlight = false;
  let serviceWorkerRegistration = null;
  let updateReloadPending = false;
  let pushBusy = false;

  function completionCodeFromHash() {
    const match = String(window.location.hash || '').match(/^#verify=(\d{6})$/);
    if (!match) return null;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return match[1];
  }

  const completionCode = completionCodeFromHash();

  function selectedView() {
    const fromHash = String(window.location.hash || '').replace(/^#/, '');
    if (fromHash === 'welcome-voucher') return 'wallet';
    if (fromHash === 'profile-notifications') return 'profile';
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
    if (target === 'shiloh') loadWhatsAppContinuation();
    const notificationTitle = target === 'profile' && window.location.hash === '#profile-notifications' && !appFrame?.hidden
      ? document.querySelector('#notifications-title') : null;
    if (notificationTitle) {
      notificationTitle.focus({ preventScroll: true });
      notificationTitle.scrollIntoView({ block: 'start', behavior: 'auto' });
    } else {
      const heading = document.querySelector(`[data-view="${target}"] h1`);
      if (heading && window.location.hash) heading.focus?.({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  window.addEventListener('hashchange', () => activateView(selectedView()));
  document.querySelector('[data-booking-steps-link]')?.addEventListener('click', (event) => {
    const steps = document.querySelector('#how-booking-works');
    if (!steps) return;
    event.preventDefault();
    steps.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    steps.querySelector('h2')?.focus({ preventScroll: true });
  });
  activateView(selectedView());
  refreshClientGreeting();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshClientGreeting();
  });

  function standalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches === true
      || window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
  }

  function isAndroid() {
    return /android/i.test(window.navigator.userAgent || '');
  }

  function isIosChrome() {
    return isIos() && /crios/i.test(window.navigator.userAgent || '');
  }

  function isIosSafari() {
    if (!isIos()) return false;
    const userAgent = window.navigator.userAgent || '';
    return /safari/i.test(userAgent)
      && !/(crios|fxios|edgios|opios|duckduckgo|gsa)/i.test(userAgent);
  }

  function johannesburgGreetingNow() {
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Johannesburg',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()));
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function refreshClientGreeting() {
    if (!clientGreeting) return;
    const firstName = String(clientGreeting.dataset.firstName || '').trim();
    if (!firstName) return;
    clientGreeting.replaceChildren(`${johannesburgGreetingNow()}, `);
    const name = document.createElement('span');
    name.textContent = `${firstName}.`;
    clientGreeting.appendChild(name);
  }

  function browserNeedsInstall() {
    return !standalone();
  }

  function installationVerificationComplete() {
    try {
      return window.localStorage.getItem(INSTALL_VERIFIED_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function markInstallationVerified() {
    try {
      window.localStorage.setItem(INSTALL_VERIFIED_KEY, '1');
    } catch (_) {
      // This marker is installation convenience only; the server session is authority.
    }
  }

  function resetInstallationVerification() {
    try {
      window.localStorage.removeItem(INSTALL_VERIFIED_KEY);
    } catch (_) {
      // Installation still works if browser storage is unavailable.
    }
  }

  function installationVerificationRequired() {
    return standalone()
      && appFrame?.dataset.clientAuthenticated === 'true'
      && !installationVerificationComplete();
  }

  function renderAppMode() {
    const browserGated = browserNeedsInstall();
    const verificationGated = !browserGated && installationVerificationRequired();
    document.documentElement.dataset.myShilohMode = browserGated
      ? 'browser'
      : verificationGated
        ? 'verification'
        : 'standalone';
    if (installGate) installGate.hidden = !browserGated;
    const showWebsiteTreatment = browserGated && window.location.hash === '#book-online'
      && /^[1-9]\d{0,11}$/.test(websiteTreatmentHandoff?.dataset.serviceCode || '');
    if (websiteTreatmentHandoff) websiteTreatmentHandoff.hidden = !showWebsiteTreatment;
    if (installGateStatus) installGateStatus.hidden = showWebsiteTreatment;
    if (installVerificationGate) installVerificationGate.hidden = !verificationGated;
    if (appFrame) appFrame.hidden = browserGated || verificationGated;
    if (!appFrame?.hidden && window.location.hash === '#profile-notifications') activateView('profile');

    if (!browserGated) return;

    installGateAction?.classList.toggle('button--primary', !showWebsiteTreatment);
    installGateAction?.classList.toggle('button--soft', showWebsiteTreatment);

    if (showWebsiteTreatment) {
      if (installGateTitle) installGateTitle.textContent = 'Continue your chosen treatment in My Shiloh.';
      if (installGateCopy) installGateCopy.textContent = 'Already have My Shiloh? Copy the code below, then open your Home Screen app.';
      if (installGateAction) {
        installGateAction.textContent = 'New here? Show install steps';
      }
      return;
    }

    if (isIos()) {
      if (installGateTitle) installGateTitle.textContent = 'Add My Shiloh to your iPhone.';
      if (installGateCopy) {
        installGateCopy.textContent = isIosSafari()
          ? 'You’re in Safari. Add My Shiloh to your Home Screen in three quick steps.'
          : isIosChrome()
            ? 'You’re in Chrome. Use Share to add My Shiloh to your Home Screen.'
            : 'Use your browser’s Share menu to add My Shiloh to your Home Screen.';
      }
      if (installGateAction) installGateAction.textContent = 'Show iPhone steps';
      return;
    }

    if (isAndroid()) {
      if (installGateTitle) installGateTitle.textContent = 'Add My Shiloh to your phone.';
      if (installGateCopy) {
        installGateCopy.textContent = deferredInstallPrompt
          ? 'Tap below and Android will add My Shiloh to your Home Screen.'
          : 'Your browser can add My Shiloh to your Home Screen in a few quick steps.';
      }
      if (installGateAction) {
        installGateAction.textContent = deferredInstallPrompt ? 'Install My Shiloh' : 'Show Android steps';
      }
      return;
    }

    if (installGateTitle) installGateTitle.textContent = 'Add My Shiloh to your Home Screen.';
    if (installGateCopy) installGateCopy.textContent = 'Keep bookings, Wallet, notifications and Shiloh support one tap away.';
    if (installGateAction) installGateAction.textContent = 'Show install steps';
  }

  function shareIcon() {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    const path = document.createElementNS(namespace, 'path');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.classList.add('install-share-icon');
    path.setAttribute('d', 'M12 15V3m0 0-4 4m4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    icon.appendChild(path);
    return icon;
  }

  function setInstallStep(index, title, copy) {
    const titleNode = installStepTitles.find((node) => node.dataset.installStepTitle === String(index));
    const copyNode = installStepCopies.find((node) => node.dataset.installStepCopy === String(index));
    if (titleNode) {
      titleNode.textContent = title;
      if (/^Tap Share/.test(title)) {
        titleNode.textContent = '';
        titleNode.append(shareIcon(), document.createTextNode(' Tap Share'));
      }
    }
    if (copyNode) copyNode.textContent = copy;
  }

  function resetInstallGuideExtras() {
    if (installStepExtra) installStepExtra.hidden = true;
    if (installTip) installTip.hidden = true;
  }

  function renderInstallGuide() {
    resetInstallGuideExtras();

    if (isIos() && !isIosSafari()) {
      if (installEyebrow) installEyebrow.textContent = 'Install My Shiloh on iPhone';
      if (installTitle) installTitle.textContent = 'Three quick steps.';
      if (installLead) {
        installLead.textContent = isIosChrome()
          ? 'You can add My Shiloh straight from Chrome — no App Store download is needed.'
          : 'Use your browser’s Share menu — no App Store download is needed.';
      }
      setInstallStep(1, 'Tap Share', isIosChrome() ? 'Use the Share button beside the address bar.' : 'Use your browser’s Share button.');
      setInstallStep(2, 'Choose Add to Home Screen', 'Scroll if you do not see it straight away.');
      setInstallStep(3, 'Tap Add', 'My Shiloh will appear on your Home Screen.');
      return;
    }

    if (isIosSafari()) {
      if (installEyebrow) installEyebrow.textContent = 'Install My Shiloh on iPhone';
      if (installTitle) installTitle.textContent = 'Three quick steps.';
      if (installLead) installLead.textContent = 'Stay in Safari — no App Store download is needed.';
      setInstallStep(1, 'Tap Share', 'Use Safari’s Share button.');
      setInstallStep(2, 'Choose Add to Home Screen', 'Scroll if you do not see it straight away.');
      setInstallStep(3, 'Turn on Open as Web App, then tap Add', 'My Shiloh will appear on your Home Screen.');
      return;
    }

    if (isAndroid()) {
      if (installEyebrow) installEyebrow.textContent = 'Install My Shiloh on Android';
      if (installTitle) installTitle.textContent = 'Three quick steps.';
      if (installLead) installLead.textContent = 'Your browser can add My Shiloh directly to your phone.';
      setInstallStep(1, 'Open your browser menu ⋮', 'Look for the menu at the top or bottom of your browser.');
      setInstallStep(2, 'Choose Install app or Add to Home screen', 'Android will show the installation option.');
      setInstallStep(3, 'Open My Shiloh', 'Tap the new My Shiloh icon on your Home Screen.');
      return;
    }

    if (installEyebrow) installEyebrow.textContent = 'Install My Shiloh';
    if (installTitle) installTitle.textContent = 'Add My Shiloh to your Home Screen.';
    if (installLead) installLead.textContent = 'It only takes a moment, and you’ll be able to open My Shiloh like any other app.';
    setInstallStep(1, 'Open your browser menu or Share button', 'Use your browser’s sharing or install menu.');
    setInstallStep(2, 'Choose Add to Home Screen or Install app', 'Your browser will show the installation option.');
    setInstallStep(3, 'Open My Shiloh', 'Tap the new My Shiloh icon on your Home Screen.');
  }

  function openInstallGuide() {
    if (!installSheet) return;
    renderInstallGuide();
    installSheet.hidden = false;
    document.body.style.overflow = 'hidden';
    installSheet.querySelector('.install-sheet__close')?.focus();
  }

  function closeInstallGuide() {
    if (!installSheet) return;
    installSheet.hidden = true;
    document.body.style.overflow = '';
    installGateAction?.focus();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    renderAppMode();
  });

  renderAppMode();

  function planningServiceQuery() {
    const id = new URLSearchParams(window.location.search).get('service') || '';
    return /^[1-9]\d*$/.test(id) ? `?service=${encodeURIComponent(id)}` : '';
  }

  function signedInLanding() {
    if (window.location.hash === '#book-online') {
      return `/my-shiloh/${planningServiceQuery()}#book-online`;
    }
    return window.location.hash === '#plan-visit'
      ? `/my-shiloh/${planningServiceQuery()}#plan-visit` : '/my-shiloh/';
  }

  function continueOnlineBooking() {
    if (window.location.hash !== '#book-online' || !standalone()
      || installationVerificationRequired() || appFrame?.dataset.clientAuthenticated !== 'true') return false;
    window.location.replace(`/my-shiloh/book${planningServiceQuery()}`);
    return true;
  }

  function continuePlanningVisit() {
    if (window.location.hash !== '#plan-visit' || !standalone()
      || installationVerificationRequired() || appFrame?.dataset.clientAuthenticated !== 'true') return false;
    window.location.replace(`/my-shiloh/request${planningServiceQuery()}`);
    return true;
  }
  continuePlanningVisit();
  continueOnlineBooking();

  installGateAction?.addEventListener('click', async () => {
    if (deferredInstallPrompt && isAndroid()) {
      const prompt = deferredInstallPrompt;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') resetInstallationVerification();
      deferredInstallPrompt = null;
      renderAppMode();
      return;
    }
    openInstallGuide();
  });

  treatmentCodeCopy?.addEventListener('click', async () => {
    const code = websiteTreatmentHandoff?.dataset.serviceCode || '';
    if (!/^[1-9]\d{0,11}$/.test(code)) return;
    try {
      await navigator.clipboard.writeText(code);
      if (treatmentCopyStatus) treatmentCopyStatus.textContent = 'Code copied. Open My Shiloh from your Home Screen, tap Bookings, then paste it into the website treatment field.';
    } catch (_) {
      if (treatmentCopyStatus) treatmentCopyStatus.textContent = `Copy code ${code} manually, then open My Shiloh from your Home Screen.`;
    }
  });

  websiteTreatmentForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = String(websiteTreatmentForm.elements.treatmentCode?.value || '').trim();
    if (!/^[1-9]\d{0,11}$/.test(code)) {
      const status = websiteTreatmentForm.querySelector('[data-website-treatment-status]');
      if (status) status.textContent = 'Enter the treatment code shown on the website.';
      return;
    }
    window.location.assign(`/my-shiloh/book?service=${encodeURIComponent(code)}`);
  });

  document.querySelectorAll('[data-install-close]').forEach((button) => {
    button.addEventListener('click', closeInstallGuide);
  });

  installSheet?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeInstallGuide();
  });

  window.addEventListener('appinstalled', () => {
    resetInstallationVerification();
    deferredInstallPrompt = null;
    if (installGateAction) installGateAction.hidden = true;
    if (installGateStatus) installGateStatus.textContent = 'Open the My Shiloh icon on your Home Screen to continue.';
  });

  function safeExperienceHref(value) {
    const href = String(value || '');
    if (href === '/book') return '/my-shiloh/book';
    if (href === '/my-shiloh/book' || href === '/my-shiloh/book?welcomeVoucher=1' || href === '/my-shiloh/forms/complete' || /^\/pay\/[A-Za-z0-9_-]{8,100}$/.test(href) || /^#[a-z-]+$/.test(href)) return href;
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
      experienceFactButtons.forEach((item, index) => {
        const fact = facts.find((candidate) => candidate?.key === item.dataset.factKey) || facts[index];
        if (!fact) return;
        const label = item.querySelector('span');
        const value = item.querySelector('strong');
        const safeHref = fact.href ? safeExperienceHref(fact.href) : '';
        if (label) label.textContent = String(fact.label || '');
        if (value) value.textContent = String(fact.value || '');
        item.dataset.factHref = safeHref === '#shiloh' && fact.href !== '#shiloh' ? '' : safeHref;
        item.dataset.factMessage = String(fact.message || '');
        item.setAttribute(
          'aria-label',
          `${String(fact.label || 'Summary')}: ${String(fact.value || '')}. ${item.dataset.factHref ? 'Open details' : 'Check details'}`,
        );
      });

      const action = experienceHome.querySelector('[data-client-experience-primary]');
      action.textContent = String(experience.home.primaryAction?.label || 'Ask Shiloh');
      action.href = safeExperienceHref(experience.home.primaryAction?.href);
    }

    const upcoming = Array.isArray(experience.bookings?.upcoming) ? experience.bookings.upcoming[0] : null;
    if (experienceBookings) {
      const primary = experienceBookings.querySelector('.action-card');
      if (primary) {
        experienceBookings.querySelectorAll('[data-experience-extra-booking]').forEach((card) => card.remove());
        const renderBooking = (card, booking, index) => {
          const number = card.querySelector('.action-number');
          const heading = card.querySelector('h2');
          const copy = card.querySelector('p');
          const action = card.querySelector('.button');
          if (number) number.textContent = String(index + 1).padStart(2, '0');
          const isRequest = booking.status === 'Requested' || booking.status === 'Planning' || booking.status === 'Awaiting your response' || booking.status === 'Change requested';
          if (heading) heading.textContent = isRequest ? String(booking.status) : String(booking.service || 'Upcoming appointment');
          if (copy) copy.textContent = [[booking.service, booking.date, booking.time, booking.practitioner].filter(Boolean).join(' · '), booking.nextAction].filter(Boolean).join(' — ');
          if (action) {
            const clinicNumber = String(appFrame?.dataset.clientPaymentWhatsapp || '').replace(/\D/g, '');
            const canAskForLink = !isRequest && booking.paymentHelpNeeded === true && Number.isSafeInteger(Number(booking.id)) && Number(booking.id) > 0 && clinicNumber;
            action.textContent = canAskForLink ? 'Request a new payment link' : isRequest ? 'Ask Shiloh about this request' : 'Ask Shiloh about this booking';
            action.href = canAskForLink
              ? `https://wa.me/${clinicNumber}?text=${encodeURIComponent(`Hi Shiloh, please help me with a payment link for booking #${booking.id}. Please check the payment status first.`)}`
              : '#shiloh';
            if (canAskForLink) { action.target = '_blank'; action.rel = 'noopener noreferrer'; }
            else { action.removeAttribute('target'); action.removeAttribute('rel'); }
          }
        };
        if (upcoming) {
          renderBooking(primary, upcoming, 0);
          let precedingCard = primary;
          experience.bookings.upcoming.slice(1).forEach((booking, index) => {
            const card = primary.cloneNode(true);
            card.dataset.experienceExtraBooking = '';
            renderBooking(card, booking, index + 1);
            precedingCard.after(card);
            precedingCard = card;
          });
        } else {
          const heading = primary.querySelector('h2');
          const copy = primary.querySelector('p');
          const action = primary.querySelector('.button');
          if (heading) heading.textContent = 'Book something new';
          if (copy) copy.textContent = 'You don’t have an upcoming appointment at the moment.';
          if (action) {
            action.textContent = 'Start booking';
            action.href = '/my-shiloh/book';
          }
        }
        const history = Array.isArray(experience.bookings?.history) ? experience.bookings.history : [];
        history.forEach((booking) => {
          const card = document.createElement('article');
          card.className = 'action-card';
          card.dataset.experienceExtraBooking = '';
          const details = document.createElement('div');
          const heading = document.createElement('h2');
          heading.textContent = String(booking.status || 'Past request');
          const copy = document.createElement('p');
          copy.textContent = [[booking.service, booking.date, booking.time, booking.practitioner].filter(Boolean).join(' · '), booking.nextAction].filter(Boolean).join(' — ');
          details.append(heading, copy);
          card.append(details);
          primary.parentElement.append(card);
        });
      }
    }

    if (experiencePrompts) {
      const prompts = Array.isArray(experience.assistant?.prompts) ? experience.assistant.prompts.slice(0, 4) : [];
      experiencePrompts.querySelectorAll('article strong').forEach((node, index) => {
        if (prompts[index]) node.textContent = String(prompts[index]);
      });
    }
  }

  experienceFactButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const href = String(button.dataset.factHref || '');
      const message = String(button.dataset.factMessage || '');
      if (experienceFactStatus) experienceFactStatus.textContent = message;
      if (!href) return;
      if (href.startsWith('#')) {
        const target = href.slice(1);
        window.location.hash = href;
        activateView(target);
        return;
      }
      window.location.href = href;
    });
  });

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

  function setClientProfileStatus(message = '', state = '') {
    if (!clientProfileStatus) return;
    clientProfileStatus.textContent = message;
    clientProfileStatus.dataset.state = state;
  }

  function setClientProfileBusy(busy) {
    if (!clientProfileForm) return;
    clientProfileForm.querySelectorAll('button,input,select').forEach((control) => {
      control.disabled = Boolean(busy);
    });
  }

  function renderClientProfile(profile) {
    if (!clientProfileForm || !profile || !/^[a-f0-9]{64}$/.test(String(profile.revision || ''))) return false;
    clientProfileForm.elements.name.value = String(profile.name || '');
    clientProfileForm.elements.dateOfBirth.value = String(profile.dateOfBirth || '');
    clientProfileForm.elements.gender.value = String(profile.gender || '');
    if (clientProfileMobile) clientProfileMobile.textContent = String(profile.mobile || 'Verified with WhatsApp');
    clientProfileRevision = profile.revision;
    setClientProfileBusy(false);
    if (profile.registrationComplete === true) {
      setClientProfileStatus('Your registration details are complete.', 'success');
    } else {
      const missing = [
        !profile.dateOfBirth ? 'date of birth' : '',
        !profile.gender ? 'gender' : '',
      ].filter(Boolean);
      setClientProfileStatus(
        `Add your ${missing.join(' and ') || 'missing details'} to finish registration and unlock your R100 voucher.`,
        'error',
      );
    }
    return true;
  }

  async function loadClientProfile() {
    if (!clientProfileForm || appFrame?.dataset.clientAuthenticated !== 'true') return;
    setClientProfileBusy(true);
    try {
      const response = await fetch('/my-shiloh/api/profile', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !renderClientProfile(data.profile)) {
        throw new Error(data.error || 'Your personal details could not be loaded.');
      }
    } catch (error) {
      setClientProfileStatus(error.message || 'Your personal details could not be loaded.', 'error');
    }
  }

  function setWelcomeVoucherStatus(message = '', state = '') {
    if (!welcomeVoucherStatus) return;
    welcomeVoucherStatus.textContent = message;
    welcomeVoucherStatus.dataset.state = state;
  }

  function welcomeVoucherErrorMessage(data, fallback) {
    const steps = Array.isArray(data?.resolution) ? data.resolution.filter(Boolean) : [];
    return [data?.error || fallback, steps.length ? `What to do: ${steps.join(' ')}` : ''].filter(Boolean).join(' ');
  }

  function renderWelcomeVoucher(model) {
    if (!welcomeVoucherHost || model?.version !== 'my_shiloh_welcome_voucher_v1') return false;
    const voucher = model.voucher;
    const termsDetails = welcomeVoucherTerms?.closest('details');
    welcomeVoucherHost.hidden = false;
    welcomeVoucherHost.classList.remove('welcome-voucher--redeemed-now');
    if (termsDetails) termsDetails.hidden = false;

    if (voucher?.state === 'redeemed' && !welcomeVoucherRedeemedThisView) {
      welcomeVoucherHost.hidden = true;
      return true;
    }

    welcomeVoucherSteps.textContent = '';
    for (const step of model.eligibility?.steps || []) {
      const item = document.createElement('li');
      item.textContent = String(step.label || 'Registration step');
      item.classList.toggle('is-complete', step.complete === true);
      welcomeVoucherSteps.appendChild(item);
    }
    welcomeVoucherTerms.textContent = '';
    for (const term of model.terms || []) {
      const item = document.createElement('li'); item.textContent = String(term); welcomeVoucherTerms.appendChild(item);
    }
    welcomeVoucherBookings.textContent = '';
    if (!model.eligibility?.complete) {
      welcomeVoucherCopy.textContent = 'Complete the steps below to unlock your once-off R100 voucher.';
      const link = document.createElement('a'); link.className = 'button button--primary'; link.href = '#profile'; link.textContent = 'Complete registration'; welcomeVoucherBookings.appendChild(link);
    } else if (voucher?.state === 'available') {
      const expiry = new Intl.DateTimeFormat('en-ZA', { day:'numeric', month:'short', year:'numeric' }).format(new Date(voucher.expiresAt));
      welcomeVoucherCopy.textContent = `Unlocked — R${voucher.amount.toFixed(0)} is ready to use until ${expiry}. Choose a qualifying booking below.`;
      const bookings = Array.isArray(model.eligibleBookings) ? model.eligibleBookings : [];
      if (!bookings.length) {
        const empty = document.createElement('p'); empty.textContent = `No eligible upcoming booking yet. Book a treatment of R${voucher.minimumBookingValue.toFixed(0)} or more, then return here.`; welcomeVoucherBookings.appendChild(empty);
        const link = document.createElement('a'); link.className = 'button button--soft'; link.href = '/my-shiloh/book?welcomeVoucher=1'; link.textContent = 'Find a qualifying treatment'; welcomeVoucherBookings.appendChild(link);
      }
      for (const booking of bookings) {
        const card = document.createElement('div'); card.className = 'welcome-voucher__booking';
        const details = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = String(booking.service || 'Shiloh treatment');
        const meta = document.createElement('span'); meta.textContent = `${new Intl.DateTimeFormat('en-ZA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(booking.startsAt))} · R${Number(booking.total).toFixed(0)}`;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button button--primary'; button.textContent = 'Apply R100 to this booking';
        button.addEventListener('click', async () => {
          button.disabled = true; setWelcomeVoucherStatus('Applying your voucher…', 'working');
          try {
            const csrfToken = await freshCsrfToken();
            const response = await postJson('/my-shiloh/api/welcome-voucher/redeem', { appointmentId:booking.id, operationId:crypto.randomUUID() }, { 'x-shiloh-csrf-token':csrfToken });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(welcomeVoucherErrorMessage(data, 'Your voucher could not be applied.'));
            welcomeVoucherRedeemedThisView = true;
            setWelcomeVoucherStatus('R100 applied. Your booking balance has been updated.', 'success');
            await loadWelcomeVoucher(); await loadClientExperience();
          } catch (error) { button.disabled = false; setWelcomeVoucherStatus(error.message || 'Your voucher could not be applied. Reload My Shiloh and try again.', 'error'); }
        });
        details.append(title, meta); card.append(details, button); welcomeVoucherBookings.appendChild(card);
      }
    } else if (voucher?.state === 'redeemed') {
      welcomeVoucherHost.classList.add('welcome-voucher--redeemed-now');
      if (termsDetails) termsDetails.hidden = true;
      welcomeVoucherCopy.textContent = 'Your R100 welcome voucher has been applied successfully.';
      setWelcomeVoucherStatus('✓ Your R100 welcome voucher has been redeemed.', 'success');
    } else if (voucher?.state === 'expired') {
      welcomeVoucherCopy.textContent = 'This welcome voucher has expired.';
      setWelcomeVoucherStatus('The 60-day validity period has ended.', 'error');
    } else {
      welcomeVoucherCopy.textContent = 'Your registration is complete. Your voucher is being prepared.';
    }
    if (window.location.hash === '#welcome-voucher' && !welcomeVoucherHost.hidden) {
      window.setTimeout(() => welcomeVoucherHost.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
    }
    return true;
  }

  async function loadWelcomeVoucher() {
    if (!welcomeVoucherHost || appFrame?.dataset.clientAuthenticated !== 'true') return;
    try {
      const response = await fetch('/my-shiloh/api/welcome-voucher', { method:'GET', credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !renderWelcomeVoucher(data)) throw new Error(welcomeVoucherErrorMessage(data, 'Your welcome voucher could not be loaded.'));
    } catch (error) { setWelcomeVoucherStatus(error.message || 'Your welcome voucher could not be loaded. Reload My Shiloh and try again.', 'error'); }
  }

  async function refreshAuthenticatedClientState() {
    if (!standalone() || installationVerificationRequired() || appFrame?.dataset.clientAuthenticated !== 'true' || clientRefreshInFlight) return;
    clientRefreshInFlight = true;
    try {
      await Promise.all([loadClientExperience(), loadClientProfile(), loadWelcomeVoucher()]);
    } finally {
      clientRefreshInFlight = false;
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
    for (const button of [...authStartButtons, ...passkeySignInButtons, ...authLogoutButtons]) button.disabled = Boolean(disabled);
    setAuthCodeControlsDisabled(disabled);
  }

  function setAuthCodeControlsDisabled(disabled) {
    for (const form of authCodeForms) {
      form.querySelectorAll('button,input').forEach((control) => { control.disabled = Boolean(disabled); });
    }
  }
  function clearWhatsAppFallback() {
    if (whatsappFallbackTimer) {
      window.clearTimeout(whatsappFallbackTimer);
      whatsappFallbackTimer = null;
    }
  }

  function openWhatsAppDirect(appUrl, fallbackUrl) {
    const direct = String(appUrl || '').trim();
    const fallback = String(fallbackUrl || '').trim();
    if (!direct) throw new Error('WhatsApp could not be opened.');

    whatsappExternalOpened = false;
    clearWhatsAppFallback();

    const markExternalOpened = () => {
      whatsappExternalOpened = true;
      clearWhatsAppFallback();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') markExternalOpened();
    };
    document.addEventListener('visibilitychange', onVisibility, { once: true });
    window.addEventListener('pagehide', markExternalOpened, { once: true });

    if (fallback && fallback !== direct) {
      whatsappFallbackTimer = window.setTimeout(() => {
        if (!whatsappExternalOpened && document.visibilityState !== 'hidden') {
          window.location.href = fallback;
        }
      }, 1800);
    }

    const link = document.createElement('a');
    link.href = direct;
    link.rel = 'noopener noreferrer';
    link.hidden = true;
    link.dataset.whatsappDirect = 'true';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }


  function scheduleAuthStatusCheck(delay = 1500) {
    window.clearTimeout(authStatusTimer);
    if (appFrame?.dataset.clientAuthenticated === 'true' && !installationVerificationRequired()) return;
    authStatusTimer = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') checkClientAuthStatus({ announce: true });
    }, delay);
  }

  async function checkClientAuthStatus({ announce = false } = {}) {
    if (authStatusCheckInFlight || authActionInFlight
      || (appFrame?.dataset.clientAuthenticated === 'true' && !installationVerificationRequired())) return;
    authStatusCheckInFlight = true;
    try {
      const response = await postJson('/my-shiloh/auth/status');
      const data = await response.json().catch(() => ({}));
      if (response.status === 204) return;
      if (response.ok && data.authenticated === true) {
        window.clearTimeout(authStatusTimer);
        whatsappHandoffStarted = false;
        markInstallationVerified();
        renderAppMode();
        setAuthStatus('Verified. Opening your My Shiloh…', 'success');
        window.location.replace(signedInLanding());
        return;
      }
      if (response.status === 202 && data.status === 'waiting_for_whatsapp') {
        whatsappHandoffStarted = true;
        setAuthControlsDisabled(false);
        for (const form of authCodeForms) form.classList.add('is-waiting');
        if (announce) {
          setAuthStatus('Waiting for your WhatsApp message…', 'waiting');
        }
        scheduleAuthStatusCheck();
        return;
      }
      if (response.status === 410) {
        whatsappHandoffStarted = false;
        setAuthControlsDisabled(false);
        setAuthStatus(data.error || 'This sign-in has expired. Please start again.', 'error');
        return;
      }
      if (!response.ok && whatsappHandoffStarted) {
        setAuthControlsDisabled(false);
        for (const form of authCodeForms) form.closest('[data-client-auth-code-disclosure]')?.setAttribute('open', '');
        setAuthStatus('Automatic sign-in did not finish. Enter the 6-digit fallback code from Shiloh.', 'error');
      }
    } catch (_) {
      if (whatsappHandoffStarted) scheduleAuthStatusCheck(2500);
    } finally {
      authStatusCheckInFlight = false;
    }
  }

  function welcomeBackFromWhatsApp() {
    clearWhatsAppFallback();
    if (!standalone()
      || (appFrame?.dataset.clientAuthenticated === 'true' && !installationVerificationRequired())) return;
    if (whatsappHandoffStarted) {
      window.clearTimeout(authStatusTimer);
      authStatusCheckInFlight = false;
    }
    authActionInFlight = false;
    setAuthControlsDisabled(false);
    if (whatsappHandoffStarted) {
      for (const form of authCodeForms) form.classList.add('is-waiting');
      setAuthStatus('Welcome back. Checking for your message…', 'waiting');
    }
    checkClientAuthStatus({ announce: whatsappHandoffStarted });
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

  async function freshCsrfToken() {
    const response = await postJson('/my-shiloh/auth/csrf');
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.csrfToken) throw new Error('Secure confirmation could not be started.');
    return data.csrfToken;
  }

  function passkeySupported() {
    return Boolean(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
  }

  function bytesFromBase64url(value) {
    const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = window.atob(text.padEnd(Math.ceil(text.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function base64urlFromBytes(value) {
    const bytes = new Uint8Array(value);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function publicKeyOptions(options, registration = false) {
    const publicKey = { ...options, challenge: bytesFromBase64url(options.challenge) };
    if (registration) {
      publicKey.user = { ...options.user, id: bytesFromBase64url(options.user.id) };
      publicKey.excludeCredentials = (options.excludeCredentials || []).map((item) => ({
        ...item, id: bytesFromBase64url(item.id),
      }));
    } else {
      publicKey.allowCredentials = (options.allowCredentials || []).map((item) => ({
        ...item, id: bytesFromBase64url(item.id),
      }));
    }
    return publicKey;
  }

  function serializePasskey(credential, registration = false) {
    const response = {
      clientDataJSON: base64urlFromBytes(credential.response.clientDataJSON),
    };
    if (registration) {
      response.attestationObject = base64urlFromBytes(credential.response.attestationObject);
      response.transports = credential.response.getTransports?.() || [];
    } else {
      response.authenticatorData = base64urlFromBytes(credential.response.authenticatorData);
      response.signature = base64urlFromBytes(credential.response.signature);
      if (credential.response.userHandle) response.userHandle = base64urlFromBytes(credential.response.userHandle);
    }
    return { id: credential.id, rawId: base64urlFromBytes(credential.rawId), type: credential.type, response };
  }

  function passkeyError(error, fallback) {
    if (error?.name === 'NotAllowedError') return 'Passkey check was cancelled. You can try again.';
    if (error?.name === 'InvalidStateError') return 'This passkey is already saved. You can use it to sign in.';
    return error?.message || fallback;
  }

  async function enrollClientPasskey() {
    if (!passkeySupported() || passkeyEnrollBusy || appFrame?.dataset.clientAuthenticated !== 'true') return;
    passkeyEnrollBusy = true;
    passkeyEnrollButton.disabled = true;
    if (passkeyEnrollStatus) passkeyEnrollStatus.textContent = 'Preparing your passkey…';
    try {
      const csrfToken = await freshCsrfToken();
      const headers = { 'x-shiloh-csrf-token': csrfToken };
      const start = await postJson('/my-shiloh/auth/passkeys/registration/options', {}, headers);
      const startData = await start.json().catch(() => ({}));
      if (!start.ok || !startData.options) throw new Error(startData.error || 'Passkey setup is unavailable.');
      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions(startData.options, true),
      });
      if (!credential) throw new Error('Passkey setup was cancelled.');
      // CSRF is rotated on demand; use a fresh token for the finishing action.
      const finishToken = await freshCsrfToken();
      const finish = await postJson('/my-shiloh/auth/passkeys/registration/finish',
        { response: serializePasskey(credential, true) }, { 'x-shiloh-csrf-token': finishToken });
      const result = await finish.json().catch(() => ({}));
      if (!finish.ok || result.registered !== true) throw new Error(result.error || 'Passkey setup could not be completed.');
      if (passkeyEnrollStatus) passkeyEnrollStatus.textContent = 'Your passkey is ready. Use it next time you sign in.';
    } catch (error) {
      if (passkeyEnrollStatus) passkeyEnrollStatus.textContent = passkeyError(error, 'Passkey setup could not be completed.');
    } finally {
      passkeyEnrollBusy = false;
      passkeyEnrollButton.disabled = false;
    }
  }

  async function signInWithPasskey() {
    if (!standalone() || !passkeySupported() || authActionInFlight) return;
    authActionInFlight = true;
    setAuthControlsDisabled(true);
    setAuthStatus('Opening your passkey…', 'working');
    try {
      const start = await postJson('/my-shiloh/auth/passkeys/sign-in/options');
      const startData = await start.json().catch(() => ({}));
      if (!start.ok || !startData.options) throw new Error(startData.error || 'Passkey sign-in is unavailable.');
      const credential = await navigator.credentials.get({ publicKey: publicKeyOptions(startData.options) });
      if (!credential) throw new Error('Passkey sign-in was cancelled.');
      const finish = await postJson('/my-shiloh/auth/passkeys/sign-in/finish',
        { response: serializePasskey(credential) });
      const result = await finish.json().catch(() => ({}));
      if (!finish.ok || result.authenticated !== true) throw new Error(result.error || 'We could not verify this passkey.');
      whatsappHandoffStarted = false;
      window.clearTimeout(authStatusTimer);
      markInstallationVerified();
      renderAppMode();
      setAuthStatus('Welcome back. Opening My Shiloh…', 'success');
      window.location.replace(signedInLanding());
    } catch (error) {
      setAuthStatus(passkeyError(error, 'Passkey sign-in could not be completed. You can use WhatsApp.'), 'error');
      authActionInFlight = false;
      setAuthControlsDisabled(false);
    }
  }

  function setPushStatus(message = '', state = '') {
    if (!pushStatus) return;
    pushStatus.textContent = String(message || '');
    pushStatus.dataset.state = state || '';
  }

  function pushSupported() {
    return standalone()
      && appFrame?.dataset.clientAuthenticated === 'true'
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
  }

  function urlBase64ToUint8Array(value) {
    const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = text.padEnd(Math.ceil(text.length / 4) * 4, '=');
    const raw = window.atob(padded);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  }

  async function pushRegistration() {
    if (serviceWorkerRegistration) return serviceWorkerRegistration;
    if (!('serviceWorker' in navigator)) return null;
    serviceWorkerRegistration = await navigator.serviceWorker.ready;
    return serviceWorkerRegistration;
  }

  async function fetchPushConfig() {
    const response = await fetch('/my-shiloh/api/push/config', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('Notifications are temporarily unavailable.');
    return data;
  }

  async function refreshPushUi() {
    if (!pushToggle) return;
    if (pushInvite) pushInvite.hidden = true;
    if (!pushSupported()) {
      pushToggle.disabled = true;
      pushToggle.textContent = standalone()
        ? 'Notifications unavailable'
        : 'Open the installed app for notifications';
      setPushStatus(standalone()
        ? 'This phone or browser does not currently support My Shiloh notifications.'
        : 'Notifications can be turned on from the installed My Shiloh app.');
      return;
    }
    if (Notification.permission === 'denied') {
      pushToggle.disabled = true;
      pushToggle.textContent = 'Notifications blocked';
      setPushStatus('Notifications are blocked in your phone settings.', 'error');
      return;
    }
    try {
      const registration = await pushRegistration();
      if (registration?.waiting && navigator.serviceWorker.controller) {
        pushToggle.disabled = true;
        pushToggle.textContent = 'Update My Shiloh first';
        setPushStatus('Install the ready My Shiloh update, then turn on notifications.');
        return;
      }
      const [subscription, config] = await Promise.all([
        registration?.pushManager?.getSubscription(),
        fetchPushConfig(),
      ]);
      if (!config.configured || !config.publicKey) {
        pushToggle.disabled = true;
        pushToggle.textContent = 'Notifications unavailable';
        setPushStatus('My Shiloh notifications are not configured yet.');
        return;
      }
      pushToggle.disabled = false;
      pushToggle.dataset.enabled = subscription ? 'true' : 'false';
      pushToggle.textContent = subscription ? 'Turn off notifications' : 'Turn on notifications';
      if (pushInvite) pushInvite.hidden = Boolean(subscription);
      setPushStatus(subscription
        ? 'Notifications are on for this phone.'
        : 'Notifications are off. Turn them on when you’re ready.', subscription ? 'success' : '');
    } catch (_) {
      pushToggle.disabled = true;
      pushToggle.textContent = 'Notifications unavailable';
      setPushStatus('Notifications could not be checked right now.');
    }
  }

  async function enablePushNotifications() {
    // iOS requires the permission request to remain inside the client's tap gesture.
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications were not allowed on this phone.');
    const registration = await pushRegistration();
    const config = await fetchPushConfig();
    if (!registration || !config.configured || !config.publicKey) throw new Error('Notifications are temporarily unavailable.');
    if (registration.waiting && navigator.serviceWorker.controller) throw new Error('Update My Shiloh first, then turn on notifications.');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });
    }
    const csrfToken = await freshCsrfToken();
    const response = await postJson('/my-shiloh/api/push/subscribe', {
      subscription: subscription.toJSON(),
    }, { 'x-shiloh-csrf-token': csrfToken });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.enabled !== true) {
      await subscription.unsubscribe().catch(() => {});
      throw new Error(data.error || 'Notifications could not be turned on.');
    }
  }

  async function disablePushNotifications() {
    const registration = await pushRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    try {
      const csrfToken = await freshCsrfToken();
      await postJson('/my-shiloh/api/push/unsubscribe', {
        endpoint: subscription.endpoint,
      }, { 'x-shiloh-csrf-token': csrfToken });
    } finally {
      await subscription.unsubscribe().catch(() => {});
    }
  }

  pushToggle?.addEventListener('click', async () => {
    if (pushBusy || !pushSupported()) return;
    pushBusy = true;
    pushToggle.disabled = true;
    setPushStatus(pushToggle.dataset.enabled === 'true'
      ? 'Turning off notifications…'
      : 'Turning on notifications…', 'working');
    try {
      if (pushToggle.dataset.enabled === 'true') await disablePushNotifications();
      else await enablePushNotifications();
      await refreshPushUi();
    } catch (error) {
      if (Notification.permission === 'denied') await refreshPushUi();
      else {
        setPushStatus(error.message || 'Notifications could not be changed.', 'error');
        pushToggle.disabled = false;
      }
    } finally {
      pushBusy = false;
    }
  });

  function revealAppUpdate(registration) {
    if (!appUpdateBanner || !registration?.waiting || !navigator.serviceWorker.controller) return;
    serviceWorkerRegistration = registration;
    appUpdateBanner.hidden = false;
    if (pushToggle) refreshPushUi();
  }

  function watchServiceWorkerRegistration(registration) {
    serviceWorkerRegistration = registration;
    clearHomeScreenAppBadge();
    if (registration.waiting) revealAppUpdate(registration);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          revealAppUpdate(registration);
        }
      });
    });
    refreshPushUi();
  }

  appUpdateAction?.addEventListener('click', async () => {
    const registration = serviceWorkerRegistration || await pushRegistration();
    if (!registration?.waiting) {
      await registration?.update?.();
      return;
    }
    updateReloadPending = true;
    appUpdateAction.disabled = true;
    appUpdateAction.textContent = 'Updating…';
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  });

  clientProfileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!clientProfileRevision) return;
    setClientProfileBusy(true);
    setClientProfileStatus('Saving your personal details…', 'working');
    const form = new FormData(clientProfileForm);
    try {
      const csrfToken = await freshCsrfToken();
      const response = await postJson('/my-shiloh/api/profile/update', {
        expectedRevision: clientProfileRevision,
        name: form.get('name'),
        dateOfBirth: form.get('dateOfBirth') || null,
        gender: form.get('gender') || null,
      }, {
        'x-shiloh-csrf-token': csrfToken,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !renderClientProfile(data.profile)) {
        throw new Error(data.error || 'Your personal details could not be saved.');
      }
      if (data.welcomeVoucher) renderWelcomeVoucher(data.welcomeVoucher);
      setClientProfileStatus(data.status === 'unchanged' ? 'Your details are already up to date.' : 'Your personal details have been saved.', 'success');
      if (data.status === 'updated') window.setTimeout(() => window.location.replace('/my-shiloh/#profile'), 700);
    } catch (error) {
      setClientProfileBusy(false);
      setClientProfileStatus(error.message || 'Your personal details could not be saved.', 'error');
    }
  });

  async function screenshotData(file) {
    if (!file) return null;
    if (file.size > 1024 * 1024) throw new Error('The screenshot must be smaller than 1 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Please choose a JPG, PNG or WebP image.');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('That screenshot could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  function problemStatusLabel(status) {
    return ({ new: 'Received', investigating: 'Investigating', fixed: 'Resolved', closed: 'Closed' })[status] || status;
  }

  function renderProblemReports(reports) {
    if (!clientProblemReportList) return;
    clientProblemReportList.replaceChildren();
    if (!Array.isArray(reports) || reports.length === 0) {
      const empty = document.createElement('p'); empty.className = 'problem-report-copy'; empty.textContent = 'You have not reported any problems yet.'; clientProblemReportList.append(empty); return;
    }
    for (const report of reports) {
      const card = document.createElement('div'); card.className = 'profile-mobile';
      const heading = document.createElement('div');
      const label = document.createElement('span'); label.textContent = report.reference;
      const status = document.createElement('strong'); status.textContent = problemStatusLabel(report.status);
      heading.append(label, status); card.append(heading);
      if (report.resolutionNote) { const note = document.createElement('p'); note.textContent = `Update: ${report.resolutionNote}`; card.append(note); }
      clientProblemReportList.append(card);
    }
  }

  function renderClientNotifications(notifications) {
    if (!clientNotificationList) return;
    latestNotifications = Array.isArray(notifications) ? notifications : [];
    const centre = clientNotificationList.closest('[data-client-notification-centre]');
    if (centre) centre.hidden = latestNotifications.length === 0;
    clientNotificationList.replaceChildren();
    const archived = latestNotifications.filter(notification => archivedUpdateIds.has(String(notification.id)));
    const visible = latestNotifications.filter(notification => archivedUpdateIds.has(String(notification.id)) === showArchivedUpdates);
    if (clientArchiveToggle) {
      clientArchiveToggle.hidden = archived.length === 0 && !showArchivedUpdates;
      clientArchiveToggle.textContent = showArchivedUpdates ? 'Show current updates' : `Show archived (${archived.length})`;
    }
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'notification-centre__empty';
      empty.textContent = showArchivedUpdates ? 'No archived updates on this phone.' : 'No current updates. Your booking details are still available in Bookings.';
      clientNotificationList.append(empty);
    }
    for (const notification of visible) {
      const row = document.createElement('div');
      row.className = 'notification-centre__row';
      const card = document.createElement('a');
      card.className = 'notification-centre__item';
      card.href = String(notification.targetPath || '/my-shiloh/');
      card.dataset.notificationId = String(notification.id || '');
      const title = document.createElement('strong'); title.textContent = String(notification.title || 'My Shiloh update');
      const body = document.createElement('span'); body.textContent = String(notification.body || '');
      card.append(title, body);
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'notification-centre__archive';
      action.textContent = showArchivedUpdates ? 'Restore' : 'Archive';
      action.setAttribute('aria-label', `${action.textContent} ${title.textContent}`);
      action.addEventListener('click', () => {
        const id = String(notification.id);
        if (showArchivedUpdates) archivedUpdateIds.delete(id);
        else archivedUpdateIds.add(id);
        if (notificationArchiveKey) {
          try { localStorage.setItem(notificationArchiveKey, JSON.stringify([...archivedUpdateIds].slice(-100))); } catch (_) {}
        }
        renderClientNotifications(latestNotifications);
      });
      row.append(card, action);
      clientNotificationList.append(row);
    }
  }

  clientArchiveToggle?.addEventListener('click', () => {
    showArchivedUpdates = !showArchivedUpdates;
    renderClientNotifications(latestNotifications);
  });

  async function clearHomeScreenAppBadge() {
    if (!standalone()) return;
    try {
      if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
    } catch (_) {}
    try {
      if (!('serviceWorker' in navigator)) return;
      const registration = serviceWorkerRegistration || await navigator.serviceWorker.ready;
      const worker = navigator.serviceWorker.controller || registration?.active;
      worker?.postMessage({ type: 'CLEAR_APP_BADGE' });
    } catch (_) {}
  }

  async function loadClientNotifications() {
    if (!clientNotificationList || !standalone() || installationVerificationRequired()
      || appFrame?.dataset.clientAuthenticated !== 'true') return;
    try {
      const response = await fetch('/my-shiloh/api/notifications', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Your updates could not be loaded.');
      renderClientNotifications(data.notifications);
    } catch (_) {
      const centre = clientNotificationList.closest('[data-client-notification-centre]');
      if (centre) centre.hidden = false;
      const message = document.createElement('p');
      message.className = 'notification-centre__empty';
      message.textContent = 'Your latest updates are temporarily unavailable.';
      clientNotificationList.replaceChildren(message);
    }
  }

  loadClientNotifications();

  async function loadProblemReports() {
    if (!clientProblemReportList || !standalone() || installationVerificationRequired()
      || appFrame?.dataset.clientAuthenticated !== 'true') return;
    try {
      const response = await fetch('/my-shiloh/api/problem-reports', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Your reports could not be loaded.');
      renderProblemReports(data.reports);
    } catch (error) {
      clientProblemReportList.replaceChildren(); const message = document.createElement('p'); message.className = 'problem-report-copy'; message.textContent = error.message; clientProblemReportList.append(message);
    }
  }

  loadProblemReports();

  clientProblemReportForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = clientProblemReportForm.querySelector('button[type="submit"]');
    const form = new FormData(clientProblemReportForm);
    button.disabled = true;
    clientProblemReportStatus.dataset.state = '';
    clientProblemReportStatus.textContent = 'Sending your report…';
    try {
      const file = form.get('screenshot');
      const csrfToken = await freshCsrfToken();
      const response = await postJson('/my-shiloh/api/problem-reports', {
        category: form.get('category'),
        description: form.get('description'),
        expectedBehavior: form.get('expectedBehavior'),
        relatedAppointmentId: form.get('relatedAppointmentId'),
        screenshotDataUrl: file?.size ? await screenshotData(file) : null,
        pagePath: window.location.pathname,
        diagnosticContext: {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          online: navigator.onLine,
          userAgent: navigator.userAgent,
        },
      }, { 'x-shiloh-csrf-token': csrfToken });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.report?.reference) throw new Error(data.error || 'Your report could not be sent.');
      clientProblemReportForm.reset();
      clientProblemReportStatus.dataset.state = 'success';
      clientProblemReportStatus.textContent = `Thank you — your report has been logged as ${data.report.reference}. Our technical support team will investigate the issue and let you know once it has been resolved. 🌿`;
      await loadProblemReports();
    } catch (error) {
      clientProblemReportStatus.dataset.state = 'error';
      clientProblemReportStatus.textContent = error.message || 'Your report could not be sent. Please try again.';
    } finally {
      button.disabled = false;
    }
  });

  function setActionCardBusy(card, busy) {
    card?.querySelectorAll('button').forEach((button) => { button.disabled = Boolean(busy); });
  }

  async function confirmClientAction(action, card) {
    if (!action || !/^[A-Za-z0-9_-]{43}$/.test(String(action.token || ''))) return;
    setActionCardBusy(card, true);
    try {
      const csrfToken = await freshCsrfToken();
      const response = await postJson('/my-shiloh/api/actions/confirm', {
        actionToken: action.token,
      }, {
        'x-shiloh-csrf-token': csrfToken,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !['cancelled', 'pending_approval'].includes(String(data.status || ''))) {
        throw new Error(data.error || 'That request could not be confirmed.');
      }
      card?.remove();
      const appointment = data.appointment || {};
      if (data.status === 'pending_approval') {
        const details = [appointment.service, appointment.proposedDate, appointment.proposedTime].filter(Boolean).join(' · ');
        appendShilohMessage('shiloh', data.message || (details
          ? `Your time-change request for ${details} is with Reception for planning. Your current appointment stays unchanged until the new arrangement is confirmed.`
          : 'Your time-change request is with Reception for planning. Your current appointment stays unchanged until the new arrangement is confirmed.'));
      } else {
        const details = [appointment.service, appointment.date, appointment.time].filter(Boolean).join(' · ');
        appendShilohMessage('shiloh', details
          ? `Your appointment has been cancelled. ${details}`
          : 'Your appointment has been cancelled.');
      }
      await loadClientExperience();
    } catch (error) {
      card?.remove();
      appendClientRecovery(error.message || 'That request could not be confirmed. Your current appointment is unchanged.');
    }
  }

  async function declineClientAction(action, card) {
    if (!action || !/^[A-Za-z0-9_-]{43}$/.test(String(action.token || ''))) {
      card?.remove();
      return;
    }
    setActionCardBusy(card, true);
    try {
      const csrfToken = await freshCsrfToken();
      await postJson('/my-shiloh/api/actions/decline', {
        actionToken: action.token,
      }, {
        'x-shiloh-csrf-token': csrfToken,
      });
    } catch (_) {
      // Declining locally is safe; an unconsumed proposal also expires automatically.
    }
    card?.remove();
    appendShilohMessage('shiloh', action.type === 'reschedule_appointment'
      ? 'No problem — your current appointment time is unchanged.'
      : 'No problem — your appointment is unchanged.');
  }

  function renderClientAction(action) {
    if (!shilohMessages || !['cancel_appointment', 'reschedule_appointment', 'consultation_form', 'profile_details', 'planning_request'].includes(action?.type)) return null;
    if (!['consultation_form', 'profile_details', 'planning_request'].includes(action.type) && !/^[A-Za-z0-9_-]{43}$/.test(String(action.token || ''))) return null;
    if (action.type === 'consultation_form' && String(action.href || '') !== '/my-shiloh/forms/complete') return null;
    if (action.type === 'profile_details' && String(action.href || '') !== '#profile') return null;
    if (action.type === 'planning_request' && String(action.href || '') !== '/my-shiloh/request') return null;

    shilohMessages.querySelector('[data-client-action-card]')?.remove();

    const card = document.createElement('section');
    card.className = 'client-action-card';
    card.dataset.clientActionCard = '';
    card.setAttribute('aria-label', ['consultation_form', 'profile_details', 'planning_request'].includes(action.type)
      ? (action.type === 'profile_details' ? 'Open personal details' : action.type === 'planning_request' ? 'Open Reception planning request' : 'Open consultation form')
      : action.type === 'reschedule_appointment'
        ? 'Confirm appointment reschedule request'
        : 'Confirm appointment cancellation');

    const eyebrow = document.createElement('span');
    eyebrow.className = 'client-action-card__eyebrow';
    eyebrow.textContent = ['consultation_form', 'profile_details', 'planning_request'].includes(action.type) ? 'Action available' : 'Confirmation required';

    const heading = document.createElement('h3');
    heading.textContent = String(action.title || (action.type === 'profile_details' ? 'Update your personal details' : action.type === 'consultation_form' ? 'Complete your consultation form' : 'Cancel this appointment?'));

    const detail = document.createElement('p');
    detail.className = 'client-action-card__detail';
    detail.textContent = action.type === 'profile_details'
      ? String(action.detail || 'Review your private profile details in My Shiloh.')
      : action.type === 'planning_request'
      ? String(action.detail || 'Tell Reception about your flexible or group visit.')
      : action.type === 'consultation_form'
      ? String(action.detail || 'A consultation form is waiting for you in My Shiloh.')
      : action.type === 'reschedule_appointment'
      ? [
        action.service,
        action.practitioner,
        `Current: ${[action.currentDate, action.currentTime].filter(Boolean).join(' · ')}`,
        `Requested: ${[action.proposedDate, action.proposedTime].filter(Boolean).join(' · ')}`,
      ].filter(Boolean).join(' · ')
      : [
        action.service,
        action.practitioner,
        [action.date, action.time].filter(Boolean).join(' · '),
      ].filter(Boolean).join(' · ');

    const policy = document.createElement('p');
    policy.className = 'client-action-card__policy';
    policy.textContent = String(action.type === 'profile_details'
      ? action.note || 'Your verified WhatsApp number cannot be changed here.'
      : action.type === 'planning_request'
      ? action.note || 'Reception will review your request. No appointment is booked yet.'
      : action.type === 'consultation_form'
      ? 'Open your form to continue safely.'
      : action.type === 'reschedule_appointment' ? action.note || '' : action.policy || '');

    const payment = document.createElement('p');
    payment.className = 'client-action-card__note';
    payment.textContent = String(action.type === 'profile_details'
      ? 'Nothing changes until you review and save the form.'
      : action.type === 'planning_request'
      ? 'Nothing is submitted until you review and send the request form.'
      : action.type === 'consultation_form'
      ? 'Only you can open this form after signing in.'
      : action.type === 'reschedule_appointment'
      ? 'Submitting this request does not move the appointment immediately. Reception will review the arrangement and confirm any change.'
      : action.paymentNote || '');

    const actions = document.createElement('div');
    actions.className = 'client-action-card__actions';

    if (['consultation_form', 'profile_details', 'planning_request'].includes(action.type)) {
      const open = document.createElement('a');
      open.className = 'button button--primary';
      if (action.type === 'planning_request') {
        open.href = '/my-shiloh/request';
        open.textContent = String(action.label || 'Open request form');
      } else if (action.type === 'profile_details') {
        open.href = '#profile';
        open.textContent = String(action.label || 'Open personal details');
      } else {
        open.href = '/my-shiloh/forms/complete';
        open.textContent = String(action.label || 'Complete form');
      }
      open.addEventListener('click', () => { card.remove(); });
      actions.append(open);
    } else {
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'button button--soft';
      keep.textContent = String(action.declineLabel || 'Keep appointment');

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = action.type === 'reschedule_appointment'
        ? 'button button--primary'
        : 'button button--danger';
      confirm.textContent = String(action.confirmLabel || (action.type === 'reschedule_appointment' ? 'Request reschedule' : 'Cancel appointment'));

      keep.addEventListener('click', () => declineClientAction(action, card));
      confirm.addEventListener('click', () => confirmClientAction(action, card));
      actions.append(keep, confirm);
    }
    card.append(eyebrow, heading, detail, policy, payment, actions);
    shilohMessages.appendChild(card);
    card.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    return card;
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

  async function loadWhatsAppContinuation() {
    if (!whatsappContinuation || appFrame?.dataset.clientAuthenticated !== 'true') return;
    try {
      const response = await fetch('/my-shiloh/api/shiloh/whatsapp-continuation', {
        credentials:'same-origin', cache:'no-store', headers:{ Accept:'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      whatsappContinuation.hidden = !response.ok || data.available !== true;
    } catch (_) { whatsappContinuation.hidden = true; }
  }

  whatsappContinuationAccept?.addEventListener('click', async () => {
    whatsappContinuationAccept.disabled = true;
    if (whatsappContinuationStatus) whatsappContinuationStatus.textContent = 'Bringing your recent conversation here…';
    try {
      const token = await freshCsrfToken();
      const response = await postJson('/my-shiloh/api/shiloh/whatsapp-continuation', {}, {
        'x-shiloh-csrf-token':token,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.exchange?.clientMessage || !data.exchange?.shilohReply) {
        throw new Error(data.error || 'Your recent conversation could not be brought here.');
      }
      whatsappContinuation.hidden = true;
      appendShilohMessage('shiloh', 'Here is our last exchange on WhatsApp. You can continue here in My Shiloh.');
      appendShilohMessage('user', data.exchange.clientMessage);
      appendShilohMessage('shiloh', data.exchange.shilohReply);
    } catch (error) {
      if (whatsappContinuationStatus) whatsappContinuationStatus.textContent = error.message || 'Please try again.';
    } finally { whatsappContinuationAccept.disabled = false; }
  });

  function appendClientRecovery(message) {
    appendShilohMessage('shiloh', `${String(message || 'That did not work.')}\n\nNothing has been changed. Try once more, or report the problem if it continues.`);
    if (!shilohMessages) return;
    const card = document.createElement('section');
    card.className = 'client-action-card';
    card.setAttribute('aria-label', 'Help resolve this problem');
    const heading = document.createElement('h3');
    heading.textContent = 'What would you like to do?';
    const actions = document.createElement('div');
    actions.className = 'client-action-card__actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button--soft';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => {
      card.remove();
      shilohChatInput?.focus();
    });
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'button button--primary';
    report.textContent = 'Report a problem';
    report.addEventListener('click', () => {
      if (clientProblemReportForm) {
        clientProblemReportForm.elements.category.value = 'booking';
        clientProblemReportForm.elements.description.value = String(message || 'A My Shiloh booking action did not work.').slice(0, 2000);
        clientProblemReportForm.elements.expectedBehavior.value = 'I expected Shiloh to help me complete this booking action.';
      }
      window.location.hash = 'profile';
      window.setTimeout(() => clientProblemReportForm?.elements.description?.focus(), 0);
      card.remove();
    });
    actions.append(retry, report);
    card.append(heading, actions);
    shilohMessages.append(card);
    card.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  function setShilohBusy(busy) {
    shilohMessageInFlight = Boolean(busy);
    if (shilohChatInput) shilohChatInput.disabled = Boolean(busy);
    if (shilohChatSend) shilohChatSend.disabled = Boolean(busy);
    for (const button of shilohPromptButtons) button.disabled = Boolean(busy);
  }

  function resizeShilohComposer() {
    if (!shilohChatInput) return;
    shilohChatInput.style.height = 'auto';
    shilohChatInput.style.height = `${Math.min(shilohChatInput.scrollHeight, 120)}px`;
  }

  shilohChatInput?.addEventListener('input', resizeShilohComposer);

  async function sendShilohMessage(value) {
    if (!standalone() || installationVerificationRequired()
      || shilohMessageInFlight || appFrame?.dataset.clientAuthenticated !== 'true') return;
    const message = String(value || '').trim();
    if (!message || message.length > 1000) return;

    appendShilohMessage('user', message);
    if (shilohChatInput) {
      shilohChatInput.value = '';
      resizeShilohComposer();
    }
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
      if (data.action) renderClientAction(data.action);
    } catch (error) {
      pending?.remove();
      appendClientRecovery(error.message || 'Shiloh could not answer that just now. Please try again.');
    } finally {
      setShilohBusy(false);
      shilohChatInput?.focus();
    }
  }

  shilohChatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendShilohMessage(shilohChatInput?.value || '');
  });

  document.querySelector('[data-human-handoff-start]')?.addEventListener('click', async (event) => {
    event.preventDefault();
    const link = event.currentTarget;
    const status = document.querySelector('[data-human-handoff-status]');
    const direct = document.querySelector('[data-human-handoff-direct]');
    if (status) status.textContent = 'Letting Reception know you want a person…';
    setShilohBusy(true);
    try {
      const token = await freshCsrfToken();
      const response = await postJson('/my-shiloh/api/human-handoff', {}, { 'x-shiloh-csrf-token':token });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== 'open') throw new Error(result.error || 'Reception could not be alerted in My Shiloh.');
      if (status) status.textContent = 'Reception has your handoff. Opening the clinic WhatsApp now…';
      window.location.assign(link.href);
    } catch (error) {
      setShilohBusy(false);
      if (status) status.textContent = `${error.message} You can still message Reception directly; Shiloh’s automatic replies may remain active.`;
      if (direct) direct.hidden = false;
    }
  });

  shilohPromptButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = button.querySelector('strong')?.textContent || '';
      sendShilohMessage(prompt);
    });
  });

  async function beginClientAuth() {
    if (!standalone() || authActionInFlight) return;
    authActionInFlight = true;
    setAuthControlsDisabled(true);
    setAuthStatus('Opening WhatsApp…', 'working');
    try {
      const response = await postJson('/my-shiloh/auth/start');
      const data = await response.json().catch(() => ({}));
      const whatsappAppUrl = data.whatsappAppUrl || data.whatsappUrl;
      const whatsappFallbackUrl = data.whatsappFallbackUrl || data.whatsappUrl;
      if (!response.ok || !whatsappAppUrl) throw new Error(data.error || 'Secure sign-in is unavailable.');
      whatsappHandoffStarted = true;
      authActionInFlight = false;
      setAuthCodeControlsDisabled(false);
      for (const form of authCodeForms) form.classList.add('is-waiting');
      setAuthStatus('Waiting for your WhatsApp message…', 'waiting');
      window.setTimeout(welcomeBackFromWhatsApp, 1500);
      openWhatsAppDirect(whatsappAppUrl, whatsappFallbackUrl);
    } catch (error) {
      setAuthStatus(error.message || 'Secure sign-in is unavailable. Please try again.', 'error');
      setAuthControlsDisabled(false);
      authActionInFlight = false;
    }
  }

  async function completeClientAuth(code) {
    if (!standalone() || authActionInFlight
      || (appFrame?.dataset.clientAuthenticated === 'true' && !installationVerificationRequired())) return;
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
      whatsappHandoffStarted = false;
      markInstallationVerified();
      renderAppMode();
      setAuthStatus('Verified. Opening your My Shiloh…', 'success');
      window.location.replace(signedInLanding());
    } catch (error) {
      setAuthStatus(error.message || 'That one-time code could not be verified.', 'error');
      setAuthControlsDisabled(false);
      authActionInFlight = false;
    }
  }

  async function logoutClient() {
    if (!standalone() || authActionInFlight) return;
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
  if (!passkeySupported()) passkeySignInButtons.forEach((button) => { button.hidden = true; });
  if (!passkeySupported() && passkeyEnrollButton) passkeyEnrollButton.hidden = true;
  passkeySignInButtons.forEach((button) => button.addEventListener('click', signInWithPasskey));
  passkeyEnrollButton?.addEventListener('click', enrollClientPasskey);
  authLogoutButtons.forEach((button) => button.addEventListener('click', logoutClient));
  authCodeForms.forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector('[data-client-auth-code]');
    completeClientAuth(input?.value || '');
  }));

  window.addEventListener('pageshow', welcomeBackFromWhatsApp);
  window.addEventListener('pageshow', refreshAuthenticatedClientState);
  window.addEventListener('focus', welcomeBackFromWhatsApp);
  window.addEventListener('focus', refreshAuthenticatedClientState);
  window.addEventListener('focus', clearHomeScreenAppBadge);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      welcomeBackFromWhatsApp();
      refreshAuthenticatedClientState();
      clearHomeScreenAppBadge();
    }
  });
  welcomeBackFromWhatsApp();

  if (standalone() && completionCode
    && (appFrame?.dataset.clientAuthenticated !== 'true' || installationVerificationRequired())) {
    for (const input of document.querySelectorAll('[data-client-auth-code]')) {
      input.value = completionCode.replace(/^(\d{3})(\d{3})$/, '$1 $2');
    }
    completeClientAuth(completionCode);
  }

  refreshAuthenticatedClientState();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateReloadPending) return;
      updateReloadPending = false;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/my-shiloh/sw.js', {
        scope: '/my-shiloh/',
        updateViaCache: 'none',
      }).then((registration) => {
        watchServiceWorkerRegistration(registration);
        return registration.update();
      }).catch(() => {
        // My Shiloh still works as a normal web app if registration is unavailable.
        refreshPushUi();
      });
    });
  } else {
    refreshPushUi();
  }
})();
