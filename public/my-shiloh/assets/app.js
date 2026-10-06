(() => {
  'use strict';

  const viewNames = new Set(['home', 'bookings', 'shiloh', 'wallet', 'profile', 'updates']);
  const views = [...document.querySelectorAll('[data-view]')];
  const navItems = [...document.querySelectorAll('[data-view-target]')];
  const installSheet = document.querySelector('[data-install-sheet]');
  const installGate = document.querySelector('[data-install-gate]');
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
  const offlineBanner = document.querySelector('[data-offline-banner]');
  const appUpdateBanner = document.querySelector('[data-app-update]');
  const appUpdateAction = document.querySelector('[data-app-update-action]');
  const pushToggle = document.querySelector('[data-push-toggle]');
  const pushStatus = document.querySelector('[data-push-status]');
  const pushInvite = document.querySelector('[data-push-invite]');
  const clientSetup = document.querySelector('[data-client-setup]');
  const clientSetupStep = document.querySelector('[data-client-setup-step]');
  const clientSetupTitle = document.querySelector('[data-client-setup-title]');
  const clientSetupCopy = document.querySelector('[data-client-setup-copy]');
  const clientSetupAction = document.querySelector('[data-client-setup-action]');
  const clientSetupLater = document.querySelector('[data-client-setup-later]');
  const clientSetupStatus = document.querySelector('[data-client-setup-status]');
  const appFrame = document.querySelector('[data-app-frame]');
  const passkeySignInButtons = [...document.querySelectorAll('[data-passkey-sign-in]')];
  const passkeyEnrollButton = document.querySelector('[data-passkey-enroll]');
  const passkeyEnrollStatus = document.querySelector('[data-passkey-enroll-status]');
  const passkeyDevices = document.querySelector('[data-passkey-devices]');
  const passkeyDeviceStatus = document.querySelector('[data-passkey-device-status]');
  const recoveryCreateButton = document.querySelector('[data-passkey-recovery-create]');
  const recoveryCreateStatus = document.querySelector('[data-passkey-recovery-create-status]');
  const recoveryCodeDisplay = document.querySelector('[data-passkey-recovery-code]');
  const recoveryForms = [...document.querySelectorAll('[data-passkey-recovery-form]')];
  const authLogoutButtons = [...document.querySelectorAll('[data-client-auth-logout]')];
  const smsOpenButtons = [...document.querySelectorAll('[data-client-sms-open]')];
  const smsStartForms = [...document.querySelectorAll('[data-client-sms-start]')];
  const smsCompleteForms = [...document.querySelectorAll('[data-client-sms-complete]')];
  const authStatusHosts = [...document.querySelectorAll('[data-auth-status]')];
  const experienceHome = document.querySelector('[data-client-experience-home]');
  const experienceFactButtons = [...document.querySelectorAll('[data-client-experience-fact]')];
  const experienceFactStatus = document.querySelector('[data-client-experience-fact-status]');
  const experienceBookings = document.querySelector('[data-client-experience-bookings]');
  const bookingHistoryHost = document.querySelector('[data-booking-history]');
  const bookingHistoryStatus = document.querySelector('[data-booking-history-status]');
  let latestBookingHistory = [];
  let showHiddenBookings = false;
  let bookingHistoryBusy = false;
  let clientExperienceRequestId = 0;
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
  const clientArchivedNotificationList = document.querySelector('[data-client-archived-notification-list]');
  const notificationArchiveKey = appFrame?.dataset.notificationClientId
    ? `my-shiloh-archived-updates-v1:${appFrame.dataset.notificationClientId}` : null;
  const notificationSetupKey = appFrame?.dataset.notificationClientId
    ? `my-shiloh-notification-setup-later-v1:${appFrame.dataset.notificationClientId}` : null;
  let archivedUpdateIds = new Set();
  let latestNotifications = [];
  const seenUpdatesKey = appFrame?.dataset.notificationClientId ? `my-shiloh-seen-updates-v1:${appFrame.dataset.notificationClientId}` : null;
  let seenUpdateIds = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(seenUpdatesKey) || '[]');
    if (seenUpdatesKey && Array.isArray(stored)) seenUpdateIds = new Set(stored.filter(id => typeof id === 'string').slice(-100));
  } catch (_) {}
  if (notificationArchiveKey) {
    try {
      const stored = JSON.parse(localStorage.getItem(notificationArchiveKey) || '[]');
      if (Array.isArray(stored)) archivedUpdateIds = new Set(stored.filter(id => typeof id === 'string').slice(-100));
    } catch (_) {}
  }
  let deferredInstallPrompt = null;
  let authActionInFlight = false;
  let passkeyEnrollBusy = false;
  let shilohMessageInFlight = false;
  let welcomeVoucherRedeemedThisView = false;
  let clientProfileRevision = null;
  let clientRefreshInFlight = false;
  let serviceWorkerRegistration = null;
  let updateReloadPending = false;
  let pushBusy = false;
  let clientSetupChecking = Boolean(clientSetup);
  let clientSetupCheckFailed = false;
  let clientHasPasskey = false;
  let clientSetupPushReady = false;
  let clientSetupPushEnabled = false;
  let clientSetupProblem = '';
  let notificationSetupDeferred = false;
  try { notificationSetupDeferred = Boolean(notificationSetupKey && localStorage.getItem(notificationSetupKey)); } catch (_) {}

  function renderClientSetup() {
    if (!clientSetup) return;
    const passkeyStep = !clientHasPasskey;
    const notificationStep = !passkeyStep && clientSetupPushReady && !clientSetupPushEnabled
      && !notificationSetupDeferred;
    clientSetup.hidden = clientSetupChecking || (!passkeyStep && !notificationStep);
    if (clientSetup.hidden) return;
    clientSetup.dataset.step = clientSetupCheckFailed && passkeyStep ? 'check'
      : passkeyStep ? 'passkey' : 'notifications';
    clientSetupStep.textContent = passkeyStep ? 'First, secure your sign-in' : 'Next, stay in the know';
    clientSetupTitle.textContent = passkeyStep ? 'Save your Shiloh passkey.' : 'Stay ready for every visit.';
    clientSetupCopy.textContent = passkeyStep
      ? 'Use your phone’s screen lock to open My Shiloh next time, without waiting for an SMS code.'
      : 'Get appointment reminders and updates about your bookings, forms, payments, vouchers and Rewards on this phone. You can turn these off any time in Profile.';
    clientSetupAction.textContent = clientSetupCheckFailed && passkeyStep ? 'Try again'
      : passkeyStep ? 'Save my passkey' : 'Turn on notifications';
    clientSetupAction.disabled = passkeyStep ? passkeyEnrollBusy || (!clientSetupCheckFailed && !passkeySupported()) : pushBusy;
    clientSetupLater.hidden = passkeyStep;
    clientSetupStatus.textContent = passkeyStep
      ? (clientSetupCheckFailed || passkeySupported() ? clientSetupProblem : 'Passkeys are unavailable on this device. You can keep using My Shiloh and try another supported device.')
      : clientSetupProblem;
    if (pushInvite) pushInvite.hidden = true;
  }

  function selectedView() {
    const fromHash = String(window.location.hash || '').replace(/^#/, '');
    if (fromHash === 'welcome-voucher') return 'wallet';
    if (['profile-notifications', 'profile-archived-updates', 'profile-reports'].includes(fromHash)) return 'profile';
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
      if (item.dataset.viewTarget === target || (target === 'updates' && item.dataset.viewTarget === 'profile')) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    if (target === 'shiloh') loadWhatsAppContinuation();
    if (target === 'updates') markUpdatesSeen();
    const profileDetailSelector = { '#profile-archived-updates': '[data-profile-archived-updates]', '#profile-reports': '[data-profile-help]' }[window.location.hash];
    const profileDetail = target === 'profile' && !appFrame?.hidden && profileDetailSelector
      ? document.querySelector(profileDetailSelector) : null;
    if (profileDetail) profileDetail.open = true;
    const notificationTitle = profileDetail?.querySelector('summary') || (target === 'profile' && window.location.hash === '#profile-notifications' && !appFrame?.hidden
      ? document.querySelector('#notifications-title') : null);
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

  function isIosGoogleApp() {
    return isIos() && /\bGSA\//i.test(window.navigator.userAgent || '');
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

  function renderAppMode() {
    const browserGated = browserNeedsInstall();
    document.documentElement.dataset.myShilohMode = browserGated ? 'browser' : 'standalone';
    if (installGate) installGate.hidden = !browserGated;
    const showWebsiteTreatment = browserGated && window.location.hash === '#book-online'
      && /^[1-9]\d{0,11}$/.test(websiteTreatmentHandoff?.dataset.serviceCode || '');
    if (websiteTreatmentHandoff) websiteTreatmentHandoff.hidden = !showWebsiteTreatment;
    if (installGateStatus) installGateStatus.hidden = showWebsiteTreatment;
    if (appFrame) appFrame.hidden = browserGated;
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
        installGateCopy.textContent = isIosGoogleApp()
          ? 'You’re in the Google app. Open My Shiloh in Safari or Chrome first. Check that the address says app.shilohmtc.co.za before adding it to your Home Screen.'
          : isIosSafari()
          ? 'You’re in Safari. Add My Shiloh to your Home Screen in three quick steps.'
          : isIosChrome()
            ? 'You’re in Chrome. Use Share to add My Shiloh to your Home Screen.'
            : 'Use your browser’s Share menu to add My Shiloh to your Home Screen.';
      }
      if (installGateAction) installGateAction.textContent = 'Install My Shiloh';
      return;
    }

    if (isAndroid()) {
      if (installGateTitle) installGateTitle.textContent = 'Add My Shiloh to your phone.';
      if (installGateCopy) {
        installGateCopy.textContent = deferredInstallPrompt
          ? 'Keep your bookings and vouchers close at hand.'
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

  function installGuideIcon(kind) {
    if (kind === 'share') return shareIcon();
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    const path = document.createElementNS(namespace, 'path');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.classList.add('install-share-icon', `install-${kind}-icon`);
    path.setAttribute('d', kind === 'page-menu'
      ? 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 5h10M7 12h10M7 15h6'
      : 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm6 5v8m-4-4h8');
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
      } else if (title === 'Open Safari’s page menu' || title === 'Choose Add to Home Screen') {
        titleNode.textContent = '';
        titleNode.append(installGuideIcon(title === 'Open Safari’s page menu' ? 'page-menu' : 'add-home'), document.createTextNode(` ${title}`));
      }
    }
    if (copyNode) {
      copyNode.textContent = copy;
      if (title === 'Open Safari’s page menu') {
        const splitAt = copy.indexOf('Share');
        const before = copy.slice(0, splitAt);
        const after = copy.slice(splitAt + 'Share'.length);
        copyNode.textContent = '';
        const icon = installGuideIcon('share');
        icon.classList.add('install-step-copy-icon');
        copyNode.append(document.createTextNode(before), icon, document.createTextNode(`Share${after}`));
      }
    }
  }

  function resetInstallGuideExtras() {
    if (installStepExtra) installStepExtra.hidden = true;
    if (installTip) installTip.hidden = true;
  }

  function renderInstallGuide() {
    resetInstallGuideExtras();

    if (isIosGoogleApp()) {
      if (installEyebrow) installEyebrow.textContent = 'Install My Shiloh on iPhone';
      if (installTitle) installTitle.textContent = 'Open in your browser first.';
      if (installLead) installLead.textContent = 'Use Safari or Chrome. The address must say app.shilohmtc.co.za, not share.google.';
      setInstallStep(1, 'Open in Safari or Chrome', 'Use Open in browser in the Google app’s Share menu.');
      setInstallStep(2, 'Check the address', 'If you see share.google, enter app.shilohmtc.co.za/my-shiloh/ in your browser.');
      setInstallStep(3, 'Tap Share', 'Choose Add to Home Screen in your browser’s Share menu.');
      if (installStepExtra) installStepExtra.hidden = false;
      setInstallStep(4, 'Tap Add', 'If offered, turn on Open as Web App. Then open the new My Shiloh icon.');
      return;
    }

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
      setInstallStep(1, 'Open Safari’s page menu', 'At the bottom, tap the page menu, then Share. If you see a Share button directly, tap it.');
      setInstallStep(2, 'Choose Add to Home Screen', 'Scroll down the Share list. If missing, use Edit Actions to add it.');
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
      || appFrame?.dataset.clientAuthenticated !== 'true') return false;
    window.location.replace(`/my-shiloh/book${planningServiceQuery()}`);
    return true;
  }

  function continuePlanningVisit() {
    if (window.location.hash !== '#plan-visit' || !standalone()
      || appFrame?.dataset.clientAuthenticated !== 'true') return false;
    window.location.replace(`/my-shiloh/request${planningServiceQuery()}`);
    return true;
  }
  continuePlanningVisit();
  continueOnlineBooking();

  installGateAction?.addEventListener('click', async () => {
    if (deferredInstallPrompt && isAndroid()) {
      const prompt = deferredInstallPrompt;
      await prompt.prompt();
      await prompt.userChoice;
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
    deferredInstallPrompt = null;
    if (installGateAction) installGateAction.hidden = true;
    if (installGateStatus) installGateStatus.textContent = 'Open the My Shiloh icon on your Home Screen to continue.';
  });

  function safeExperienceHref(value) {
    const href = String(value || '');
    if (href === '/book') return '/my-shiloh/book';
    if (href === '/my-shiloh/book' || href === '/my-shiloh/book?welcomeVoucher=1' || href === '/my-shiloh/forms/complete' || /^\/my-shiloh\/forms\/complete\?assignmentId=[1-9][0-9]*$/.test(href) || /^\/pay\/[A-Za-z0-9_-]{8,100}$/.test(href) || /^#[a-z-]+$/.test(href)) return href;
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
      if (status) status.textContent = String(['Requested', 'Planning'].includes(experience.home.status) ? 'Awaiting approval' : experience.home.status || 'Ready');

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
      const couplesChoice = experienceHome.querySelector('[data-client-home-couples]');
      if (couplesChoice) couplesChoice.hidden = action.getAttribute('href') !== '/my-shiloh/book';
    }

    const paymentList = document.querySelector('[data-client-home-payments]');
    if (paymentList) {
      paymentList.replaceChildren();
      const payments = Array.isArray(experience.home?.payments) ? experience.home.payments : [];
      paymentList.hidden = payments.length === 0;
      payments.forEach(payment => {
        const card = document.createElement('article');
        card.className = 'action-card action-card--accent';
        const heading = document.createElement('h2');
        heading.textContent = String(payment.label || 'Payment due');
        const detail = document.createElement('p');
        detail.textContent = [payment.service, payment.date, payment.time].filter(Boolean).join(' · ');
        const message = document.createElement('p');
        message.textContent = String(payment.message || '');
        const action = document.createElement('a');
        action.className = 'button button--primary';
        action.textContent = String(payment.actionLabel || 'Open payment');
        action.href = safeExperienceHref(payment.href);
        card.append(heading, detail, message, action);
        paymentList.append(card);
      });
    }

    const formList = document.querySelector('[data-client-home-forms]');
    if (formList) {
      formList.replaceChildren();
      const forms = Array.isArray(experience.home?.forms) ? experience.home.forms : [];
      formList.hidden = forms.length === 0;
      forms.forEach(form => {
        const card = document.createElement('article');
        card.className = 'action-card';
        const heading = document.createElement('h2');
        heading.textContent = String(form.label || 'Complete your consultation form');
        const detail = document.createElement('p');
        detail.textContent = [form.service, form.date, form.time, form.title].filter(Boolean).join(' · ');
        const message = document.createElement('p');
        message.textContent = String(form.message || '');
        const action = document.createElement('a');
        action.className = 'button button--primary';
        action.textContent = String(form.actionLabel || 'Complete form');
        action.href = safeExperienceHref(form.href);
        card.append(heading, detail, message, action);
        formList.append(card);
      });
    }

    const upcoming = Array.isArray(experience.bookings?.upcoming) ? experience.bookings.upcoming[0] : null;
    if (experienceBookings) {
      const primary = experienceBookings.querySelector('.action-card');
      if (primary) {
        experienceBookings.querySelectorAll('[data-experience-extra-booking]').forEach((card) => card.remove());
        const renderBooking = (card, booking, index) => {
          card.querySelectorAll('[data-booking-proposal-controls], [data-booking-details], [data-booking-status]').forEach(node => node.remove());
          const number = card.querySelector('.action-number');
          const heading = card.querySelector('h2');
          const copy = card.querySelector('p');
          const action = card.querySelector('.button');
          if (number) number.textContent = String(index + 1).padStart(2, '0');
          const isRequest = booking.status === 'Requested' || booking.status === 'Planning' || booking.status === 'Awaiting your response' || booking.status === 'Change requested';
          if (heading) heading.textContent = isRequest ? String(booking.status === 'Requested' || booking.status === 'Planning' ? 'Awaiting approval' : booking.status) : String(booking.service || 'Upcoming appointment');
          if (copy) copy.textContent = isRequest
            ? [[booking.service, booking.date, booking.time, booking.practitioner].filter(Boolean).join(' · '), booking.nextAction].filter(Boolean).join(' — ')
            : [booking.date, booking.time, booking.practitioner].filter(Boolean).join(' · ');
          if (action) {
            const clinicNumber = String(appFrame?.dataset.clientPaymentWhatsapp || '').replace(/\D/g, '');
            const canAskForLink = !isRequest && booking.paymentHelpNeeded === true && Number.isSafeInteger(Number(booking.id)) && Number(booking.id) > 0 && clinicNumber;
            action.hidden = !isRequest && !booking.paymentPath && !booking.formActions?.length && !canAskForLink;
            action.textContent = booking.paymentPath ? String(booking.paymentActionLabel || 'Open payment') : booking.formActions?.length ? 'Complete form' : canAskForLink ? 'Request a new payment link' : isRequest ? 'Ask Shiloh about this request' : 'Ask Shiloh about this booking';
            action.href = booking.paymentPath ? safeExperienceHref(booking.paymentPath) : booking.formActions?.length ? safeExperienceHref(booking.formActions[0].href) : canAskForLink
              ? `https://wa.me/${clinicNumber}?text=${encodeURIComponent(`Hi Shiloh, please help me with a payment link for booking #${booking.id}. Please check the payment status first.`)}`
              : '#shiloh';
            if (canAskForLink && !booking.paymentPath && !booking.formActions?.length) { action.target = '_blank'; action.rel = 'noopener noreferrer'; }
            else { action.removeAttribute('target'); action.removeAttribute('rel'); }
          }
          if (!isRequest || booking.status === 'Change requested') {
            const body = heading?.parentElement;
            const status = document.createElement('p');
            status.dataset.bookingStatus = '';
            status.className = 'booking-readiness';
            status.textContent = String(booking.readinessSummary || booking.readiness || 'Upcoming');
            body?.append(status);
            const details = document.createElement('details');
            details.dataset.bookingDetails = '';
            details.className = 'booking-details';
            const summary = document.createElement('summary');
            summary.textContent = 'Appointment details';
            const formStatus = document.createElement('p');
            formStatus.textContent = String(booking.forms || 'No form required');
            const paymentStatus = document.createElement('p');
            paymentStatus.textContent = String(booking.payment || 'Payment status unavailable');
            details.append(summary, formStatus, paymentStatus);
            (booking.formActions || []).forEach(form => {
              const link = document.createElement('a');
              link.className = 'button button--soft';
              link.textContent = `Complete form: ${form.title || 'Consultation'}`;
              link.href = safeExperienceHref(form.href);
              details.append(link);
            });
            body?.append(details);
          }
          if (booking.proposal && Number.isSafeInteger(Number(booking.id)) && Number(booking.id) > 0
            && Number.isSafeInteger(Number(booking.proposal.version)) && Number(booking.proposal.version) > 0) {
            const controls = document.createElement('div');
            controls.className = 'booking-proposal-controls';
            controls.dataset.bookingProposalControls = '';
            const expiry = document.createElement('p');
            expiry.textContent = `Please respond before ${new Intl.DateTimeFormat('en-ZA', {
              timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
            }).format(new Date(booking.proposal.expiresAt))}.`;
            controls.append(expiry);
            const choices = document.createElement('div');
            choices.className = 'booking-proposal-choices';
            [['accept', 'Accept this time'], ['another', 'Ask for another option']].forEach(([choice, label]) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = `button ${choice === 'accept' ? 'button--primary' : 'button--soft'}`;
              button.textContent = label;
              button.dataset.bookingProposalAction = choice;
              button.addEventListener('click', () => respondToBookingProposal(booking, choice));
              choices.append(button);
            });
            controls.append(choices);
            card.append(controls);
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
          primary.querySelectorAll('[data-booking-details], [data-booking-status], [data-booking-proposal-controls]').forEach(node => node.remove());
          const heading = primary.querySelector('h2');
          const copy = primary.querySelector('p');
          const action = primary.querySelector('.button');
          if (heading) heading.textContent = 'Book something new';
          if (copy) copy.textContent = 'You don’t have an upcoming appointment at the moment.';
          if (action) {
            action.hidden = false;
            action.removeAttribute('target');
            action.removeAttribute('rel');
            action.textContent = 'Start booking';
            action.href = '/my-shiloh/book';
          }
        }
        latestBookingHistory = Array.isArray(experience.bookings?.history) ? experience.bookings.history : [];
        renderBookingHistory();
      }
    }

    if (experiencePrompts) {
      const prompts = Array.isArray(experience.assistant?.prompts) ? experience.assistant.prompts.slice(0, 4) : [];
      experiencePrompts.querySelectorAll('article strong').forEach((node, index) => {
        if (prompts[index]) node.textContent = String(prompts[index]);
      });
    }
  }

  function renderBookingHistory() {
    if (!bookingHistoryHost) return;
    bookingHistoryHost.hidden = latestBookingHistory.length === 0;
    const visibleList = bookingHistoryHost.querySelector('[data-booking-history-visible]');
    const hiddenList = bookingHistoryHost.querySelector('[data-booking-history-hidden]');
    const toggle = bookingHistoryHost.querySelector('[data-booking-history-toggle]');
    const hidden = latestBookingHistory.filter(booking => booking.hidden !== false);
    const visible = latestBookingHistory.filter(booking => booking.hidden === false);
    visibleList.replaceChildren();
    hiddenList.replaceChildren();
    visibleList.hidden = visible.length === 0;
    toggle.hidden = hidden.length === 0;
    toggle.textContent = `${showHiddenBookings ? 'Close hidden requests' : 'Show hidden requests'} (${hidden.length})`;
    toggle.setAttribute('aria-expanded', String(showHiddenBookings && hidden.length > 0));
    hiddenList.hidden = !showHiddenBookings || hidden.length === 0;
    toggle.disabled = bookingHistoryBusy;

    function appendBooking(list, booking, isHidden) {
      const card = document.createElement('article');
      card.className = 'action-card booking-history-card';
      card.dataset.bookingHistoryCard = String(booking.id || '');
      const details = document.createElement('div');
      const heading = document.createElement('h3');
      heading.textContent = String(booking.service || 'Past request');
      const copy = document.createElement('p');
      copy.textContent = [booking.date, booking.time, booking.practitioner].filter(Boolean).join(' · ');
      const state = document.createElement('p');
      state.textContent = String(booking.status || 'Past request');
      details.append(heading, copy, state);
      card.append(details);
      if (booking.canChangeVisibility === true && Number.isSafeInteger(Number(booking.id)) && Number(booking.id) > 0) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'button button--soft';
        action.textContent = isHidden ? 'Restore to my bookings' : 'Hide from my bookings';
        action.dataset.bookingHistoryAction = isHidden ? 'restore' : 'hide';
        action.disabled = bookingHistoryBusy;
        action.addEventListener('click', () => setBookingHistoryVisibility(booking, !isHidden));
        card.append(action);
      }
      list.append(card);
    }
    visible.forEach(booking => appendBooking(visibleList, booking, false));
    hidden.forEach(booking => appendBooking(hiddenList, booking, true));
  }

  bookingHistoryHost?.querySelector('[data-booking-history-toggle]')?.addEventListener('click', () => {
    showHiddenBookings = !showHiddenBookings;
    renderBookingHistory();
  });

  async function setBookingHistoryVisibility(booking, hidden) {
    if (bookingHistoryBusy || booking.canChangeVisibility !== true) return;
    bookingHistoryBusy = true;
    // Ignore an older background refresh that started before this change.
    clientExperienceRequestId += 1;
    renderBookingHistory();
    if (bookingHistoryStatus) bookingHistoryStatus.textContent = hidden ? 'Hiding this request…' : 'Restoring this request…';
    try {
      const token = await freshCsrfToken();
      const response = await postJson('/my-shiloh/api/booking-history/visibility', {
        appointmentId: Number(booking.id), hidden,
      }, { 'x-shiloh-csrf-token': token });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.appointmentId !== Number(booking.id) || result.hidden !== hidden) {
        throw new Error(response.status === 401
          ? 'Please sign in again to organise your bookings.'
          : result.error || 'We could not confirm this change. Reload Bookings and try again.');
      }
      latestBookingHistory = latestBookingHistory.map(item => Number(item.id) === Number(booking.id) ? { ...item, hidden } : item);
      if (bookingHistoryStatus) bookingHistoryStatus.textContent = hidden
        ? 'Hidden from your bookings. You can restore it in hidden requests.'
        : 'Restored to your bookings. This does not reopen the request.';
    } catch (error) {
      if (bookingHistoryStatus) bookingHistoryStatus.textContent = error.message || 'We could not confirm this change. Reload Bookings and try again.';
    } finally {
      await loadClientExperience();
      bookingHistoryBusy = false;
      renderBookingHistory();
      if (window.location.hash === '#bookings') bookingHistoryStatus?.focus();
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

  let bookingProposalBusy = false;
  async function respondToBookingProposal(booking, action) {
    if (bookingProposalBusy) return;
    bookingProposalBusy = true;
    const status = document.querySelector('[data-booking-proposal-status]');
    experienceBookings?.querySelectorAll('[data-booking-proposal-action]').forEach(button => { button.disabled = true; });
    if (status) status.textContent = action === 'accept' ? 'Checking this time and your booking details…' : 'Sending your request to Reception…';
    try {
      const token = await freshCsrfToken();
      const response = await postJson('/my-shiloh/api/booking-proposals/respond', {
        appointmentId: booking.id, proposalVersion: booking.proposal.version, action,
      }, { 'x-shiloh-csrf-token': token });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401
        ? 'Please sign in again, then review the latest proposed time in Bookings.'
        : result.error || 'Your response could not be checked. Refresh Bookings before trying again.');
      if (status) status.textContent = String(result.reply || 'Your response has been recorded.');
    } catch (error) {
      if (status) status.textContent = error.message || 'Please refresh Bookings and check the latest request status.';
    } finally {
      await loadClientExperience();
      bookingProposalBusy = false;
      experienceBookings?.querySelectorAll('[data-booking-proposal-action]').forEach(button => { button.disabled = false; });
      status?.focus();
    }
  }

  async function loadClientExperience() {
    if (appFrame?.dataset.clientAuthenticated !== 'true') return;
    const requestId = ++clientExperienceRequestId;
    try {
      const response = await fetch('/my-shiloh/api/experience', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('experience unavailable');
      const experience = await response.json();
      if (requestId === clientExperienceRequestId) renderClientExperience(experience);
    } catch (_error) {
      if (requestId === clientExperienceRequestId) renderExperienceUnavailable();
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
    if (clientProfileMobile) clientProfileMobile.textContent = String(profile.mobile || 'Verified mobile number');
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
        `Add your ${missing.join(' and ') || 'missing details'} to finish registration.`,
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

    if (!voucher || (voucher.state === 'redeemed' && !welcomeVoucherRedeemedThisView)) {
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
    if (voucher.state === 'available') {
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
      welcomeVoucherCopy.textContent = 'This welcome voucher is no longer available.';
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
    if (!standalone() || appFrame?.dataset.clientAuthenticated !== 'true' || clientRefreshInFlight) return;
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
    for (const button of [...passkeySignInButtons, ...authLogoutButtons, ...smsOpenButtons]) button.disabled = Boolean(disabled);
    for (const form of [...smsStartForms, ...smsCompleteForms]) {
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
    if (error?.name === 'SecurityError') return 'This My Shiloh app was opened from a different address. Open app.shilohmtc.co.za/my-shiloh/ in Safari or Chrome and add it to your Home Screen again.';
    return error?.message || fallback;
  }

  async function loadPasskeyDevices() {
    if (!passkeyDevices || appFrame?.dataset.clientAuthenticated !== 'true') return;
    try {
      const response = await fetch('/my-shiloh/auth/passkeys/devices', {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.devices)) throw new Error('Could not load saved passkeys.');
      clientHasPasskey = data.devices.length > 0;
      clientSetupChecking = false;
      clientSetupCheckFailed = false;
      clientSetupProblem = '';
      renderClientSetup();
      passkeyDevices.replaceChildren();
      if (!data.devices.length) {
        passkeyDevices.textContent = 'No passkeys saved yet.';
        return;
      }
      const list = document.createElement('ul');
      list.className = 'passkey-device-list';
      for (const device of data.devices) {
        const item = document.createElement('li');
        item.className = 'passkey-device';
        const detail = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = device.label || 'Shiloh device';
        const timing = document.createElement('small');
        const date = (value) => value && !Number.isNaN(new Date(value).getTime())
          ? new Date(value).toLocaleDateString() : null;
        timing.textContent = `Saved ${date(device.createdAt) || 'recently'} · ${device.lastUsedAt ? `Last used ${date(device.lastUsedAt) || 'recently'}` : 'Not used yet'}`;
        detail.append(title, timing);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button button--soft';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${title.textContent} passkey`);
        remove.addEventListener('click', () => revokePasskeyDevice(device.id, title.textContent, remove));
        item.append(detail, remove);
        list.append(item);
      }
      passkeyDevices.append(list);
    } catch (error) {
      passkeyDevices.textContent = error.message || 'Could not load saved passkeys.';
      clientSetupChecking = false;
      clientSetupCheckFailed = !clientHasPasskey;
      clientSetupProblem = 'We could not check your saved passkeys. Tap below to try again.';
      renderClientSetup();
    }
  }

  async function revokePasskeyDevice(id, label, button) {
    if (!Number.isSafeInteger(id) || !(await window.ShilohConfirm({title:`Remove ${label}?`,copy:'This passkey will no longer sign in to My Shiloh.',cancel:'Keep passkey',action:'Remove passkey'}))) return;
    button.disabled = true;
    if (passkeyDeviceStatus) passkeyDeviceStatus.textContent = 'Removing passkey…';
    try {
      const token = await freshCsrfToken();
      const response = await postJson('/my-shiloh/auth/passkeys/devices/revoke',
        { credentialId: id }, { 'x-shiloh-csrf-token': token });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.revoked) throw new Error(result.error || 'Could not remove this passkey.');
      if (passkeyDeviceStatus) passkeyDeviceStatus.textContent = 'Passkey removed. Sessions signed in with it have been closed.';
      await loadPasskeyDevices();
    } catch (error) {
      if (passkeyDeviceStatus) passkeyDeviceStatus.textContent = error.message || 'Could not remove this passkey.';
      button.disabled = false;
    }
  }

  async function enrollClientPasskey() {
    if (!passkeySupported() || passkeyEnrollBusy || appFrame?.dataset.clientAuthenticated !== 'true') return;
    passkeyEnrollBusy = true;
    passkeyEnrollButton.disabled = true;
    if (clientSetupAction) clientSetupAction.disabled = true;
    if (clientSetupStatus) clientSetupStatus.textContent = 'Preparing your passkey…';
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
      clientHasPasskey = true;
      clientSetupCheckFailed = false;
      clientSetupProblem = '';
      await loadPasskeyDevices();
    } catch (error) {
      if (passkeyEnrollStatus) passkeyEnrollStatus.textContent = passkeyError(error, 'Passkey setup could not be completed.');
      clientSetupProblem = passkeyEnrollStatus?.textContent || 'Passkey setup could not be completed.';
    } finally {
      passkeyEnrollBusy = false;
      passkeyEnrollButton.disabled = false;
      renderClientSetup();
    }
  }

  async function signInWithPasskey() {
    if (!passkeySupported() || authActionInFlight) return;
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
      if (!finish.ok || result.authenticated !== true) {
        const guidance = finish.status === 401
          ? ' If you have not saved a My Shiloh passkey yet, request a mobile code first, then save one under Profile.'
          : '';
        throw new Error(`${result.error || 'We could not verify this passkey.'}${guidance}`);
      }
      renderAppMode();
      setAuthStatus('Welcome back. Opening My Shiloh…', 'success');
      window.location.replace(signedInLanding());
    } catch (error) {
      setAuthStatus(passkeyError(error, 'Passkey sign-in could not be completed. You can request a mobile code.'), 'error');
      authActionInFlight = false;
      setAuthControlsDisabled(false);
    }
  }

  async function createRecoveryCode() {
    if (!recoveryCreateButton || appFrame?.dataset.clientAuthenticated !== 'true') return;
    recoveryCreateButton.disabled = true;
    if (recoveryCodeDisplay) { recoveryCodeDisplay.hidden = true; recoveryCodeDisplay.textContent = ''; }
    if (recoveryCreateStatus) recoveryCreateStatus.textContent = 'Creating your code…';
    try {
      const token = await freshCsrfToken();
      const response = await postJson('/my-shiloh/auth/passkeys/recovery/create', {}, { 'x-shiloh-csrf-token': token });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.code) throw new Error(data.error || 'Could not create a recovery code.');
      recoveryCodeDisplay.textContent = data.code;
      recoveryCodeDisplay.hidden = false;
      recoveryCreateStatus.textContent = 'Save this code privately now. It works once and will not be shown again.';
    } catch (error) {
      if (recoveryCreateStatus) recoveryCreateStatus.textContent = error.message || 'Could not create a recovery code.';
    } finally { recoveryCreateButton.disabled = false; }
  }

  async function signInWithRecoveryCode(event) {
    event.preventDefault();
    if (authActionInFlight) return;
    const form = event.currentTarget;
    const code = form.elements.code?.value || '';
    authActionInFlight = true;
    setAuthControlsDisabled(true);
    const button = form.querySelector('button');
    if (button) button.disabled = true;
    const status = form.parentElement.querySelector('[data-passkey-recovery-status]');
    if (status) status.textContent = 'Checking your recovery code…';
    try {
      const response = await postJson('/my-shiloh/auth/passkeys/recovery/use', { code });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.authenticated !== true) throw new Error(data.error || 'That recovery code could not be used.');
      form.reset();
      renderAppMode();
      window.location.replace('/my-shiloh/#profile');
    } catch (error) {
      if (status) status.textContent = error.message || 'That recovery code could not be used.';
      authActionInFlight = false;
      setAuthControlsDisabled(false);
      if (button) button.disabled = false;
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
    clientSetupPushReady = false;
    clientSetupPushEnabled = false;
    if (!pushSupported()) {
      pushToggle.disabled = true;
      pushToggle.textContent = standalone()
        ? 'Notifications unavailable'
        : 'Open the installed app for notifications';
      setPushStatus(standalone()
        ? 'This phone or browser does not currently support My Shiloh notifications.'
        : 'Notifications can be turned on from the installed My Shiloh app.');
      renderClientSetup();
      return;
    }
    if (Notification.permission === 'denied') {
      pushToggle.disabled = true;
      pushToggle.textContent = 'Notifications blocked';
      setPushStatus('Notifications are blocked in your phone settings.', 'error');
      renderClientSetup();
      return;
    }
    try {
      const registration = await pushRegistration();
      if (registration?.waiting && navigator.serviceWorker.controller) {
        pushToggle.disabled = true;
        pushToggle.textContent = 'Update My Shiloh first';
        setPushStatus('Install the ready My Shiloh update, then turn on notifications.');
        renderClientSetup();
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
        renderClientSetup();
        return;
      }
      pushToggle.disabled = false;
      pushToggle.dataset.enabled = subscription ? 'true' : 'false';
      pushToggle.textContent = subscription ? 'Turn off notifications' : 'Turn on notifications';
      clientSetupPushReady = true;
      clientSetupPushEnabled = Boolean(subscription);
      if (pushInvite) pushInvite.hidden = Boolean(subscription) || Boolean(clientSetup);
      setPushStatus(subscription
        ? 'Notifications are on for this phone.'
        : 'Notifications are off. Turn them on when you’re ready.', subscription ? 'success' : '');
      renderClientSetup();
    } catch (_) {
      pushToggle.disabled = true;
      pushToggle.textContent = 'Notifications unavailable';
      setPushStatus('Notifications could not be checked right now.');
      renderClientSetup();
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

  async function changePushNotifications() {
    if (pushBusy || !pushSupported()) return;
    pushBusy = true;
    pushToggle.disabled = true;
    if (clientSetupAction) clientSetupAction.disabled = true;
    setPushStatus(pushToggle.dataset.enabled === 'true'
      ? 'Turning off notifications…'
      : 'Turning on notifications…', 'working');
    try {
      if (pushToggle.dataset.enabled === 'true') await disablePushNotifications();
      else await enablePushNotifications();
      clientSetupProblem = '';
      await refreshPushUi();
    } catch (error) {
      if (Notification.permission === 'denied') await refreshPushUi();
      else {
        setPushStatus(error.message || 'Notifications could not be changed.', 'error');
        clientSetupProblem = error.message || 'Notifications could not be changed.';
        pushToggle.disabled = false;
      }
    } finally {
      pushBusy = false;
      renderClientSetup();
    }
  }

  pushToggle?.addEventListener('click', changePushNotifications);
  clientSetupAction?.addEventListener('click', () => {
    if (clientSetup.dataset.step === 'check') {
      clientSetupChecking = true;
      renderClientSetup();
      loadPasskeyDevices();
    } else if (clientSetup.dataset.step === 'passkey') enrollClientPasskey();
    else if (clientSetup.dataset.step === 'notifications') changePushNotifications();
  });
  clientSetupLater?.addEventListener('click', () => {
    notificationSetupDeferred = true;
    try { if (notificationSetupKey) localStorage.setItem(notificationSetupKey, '1'); } catch (_) {}
    renderClientSetup();
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
    // Disabled controls are omitted by FormData; read values before locking the form.
    const form = new FormData(clientProfileForm);
    setClientProfileBusy(true);
    setClientProfileStatus('Saving your personal details…', 'working');
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
    if (centre) centre.hidden = false;
    renderNotificationList(clientNotificationList, false);
    if (clientArchivedNotificationList) renderNotificationList(clientArchivedNotificationList, true);
    if (selectedView() === 'updates') markUpdatesSeen();
    else renderUpdatesAttention();
  }

  function markUpdatesSeen() {
    latestNotifications.forEach(item => seenUpdateIds.add(String(item.id)));
    seenUpdateIds = new Set([...seenUpdateIds].slice(-100));
    if (seenUpdatesKey) try { localStorage.setItem(seenUpdatesKey, JSON.stringify([...seenUpdateIds])); } catch (_) {}
    renderUpdatesAttention();
  }

  function renderUpdatesAttention() {
    const unseen = latestNotifications.filter(item => !seenUpdateIds.has(String(item.id)) && !archivedUpdateIds.has(String(item.id)));
    document.querySelectorAll('[data-updates-badge]').forEach(badge => {
      badge.hidden = unseen.length === 0;
      badge.textContent = String(unseen.length);
      badge.setAttribute('aria-label', `${unseen.length} unread updates on this phone`);
    });
    const alert = document.querySelector('[data-home-critical-update]');
    if (!alert) return;
    alert.replaceChildren();
    const important = unseen.find(item => item.requiresAttention === true && Date.now() - new Date(item.createdAt).getTime() < 7 * 86400000);
    alert.hidden = !important;
    if (!important) return;
    const title = document.createElement('strong'); title.textContent = important.title;
    const copy = document.createElement('p'); copy.textContent = important.body;
    const action = document.createElement('a'); action.className = 'button button--soft'; action.href = '#updates'; action.textContent = 'View update';
    alert.append(title, copy, action);
  }

  function renderNotificationList(host, archived) {
    host.replaceChildren();
    const visible = latestNotifications.filter(notification => archivedUpdateIds.has(String(notification.id)) === archived);
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'notification-centre__empty';
      empty.textContent = archived ? 'No archived updates on this phone.' : 'No current updates. Your booking details are still available in Bookings.';
      host.append(empty);
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
      action.textContent = archived ? 'Restore' : 'Archive';
      action.setAttribute('aria-label', `${action.textContent} ${title.textContent}`);
      action.addEventListener('click', () => {
        const id = String(notification.id);
        if (archived) archivedUpdateIds.delete(id);
        else archivedUpdateIds.add(id);
        if (notificationArchiveKey) {
          try { localStorage.setItem(notificationArchiveKey, JSON.stringify([...archivedUpdateIds].slice(-100))); } catch (_) {}
        }
        renderClientNotifications(latestNotifications);
      });
      row.append(card, action);
      host.append(row);
    }
  }

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
    if (!clientNotificationList || !standalone()
      || appFrame?.dataset.clientAuthenticated !== 'true') return;
    try {
      const response = await fetch('/my-shiloh/api/notifications', { credentials: 'same-origin', headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Your updates could not be loaded.');
      renderClientNotifications(data.notifications);
    } catch (_) {
      const centre = clientNotificationList.closest('[data-client-notification-centre]');
      if (centre) centre.hidden = false;
      for (const host of [clientNotificationList, clientArchivedNotificationList].filter(Boolean)) {
        const message = document.createElement('p');
        message.className = 'notification-centre__empty';
        message.textContent = 'Your updates are temporarily unavailable. Please try again later.';
        host.replaceChildren(message);
      }
    }
  }

  loadClientNotifications();

  async function loadProblemReports() {
    if (!clientProblemReportList || !standalone()
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
      clientProblemReportStatus.textContent = (data.acknowledgement || 'Thank you for reporting your issue. It has been added to our investigation queue, and we’ll let you know once it has been resolved. 🌿') + ` Reference: ${data.report.reference}.`;
      await Promise.all([loadProblemReports(), loadClientNotifications()]);
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
      ? action.note || 'Your verified mobile number cannot be changed here.'
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
    if (!standalone()
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

  shilohPromptButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = button.querySelector('strong')?.textContent || button.textContent || '';
      sendShilohMessage(prompt);
    });
  });

  smsOpenButtons.forEach((button) => button.addEventListener('click', () => {
    if (authActionInFlight) return;
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    if (!panel.hidden && button.getAttribute('aria-expanded') === 'true') {
      panel.hidden = true;
      smsOpenButtons.filter((item) => item.getAttribute('aria-controls') === panel.id)
        .forEach((item) => item.setAttribute('aria-expanded', 'false'));
      return;
    }
    const recovering = button.dataset.clientSmsOpen === 'recover';
    panel.querySelector('[data-client-sms-title]').textContent = recovering
      ? 'Open My Shiloh on your new phone' : 'Register for My Shiloh';
    panel.querySelector('[data-client-sms-copy]').textContent = recovering
      ? 'Verify the mobile number on your existing Shiloh profile with an SMS code, then save a passkey on this phone.'
      : 'Verify your number with an SMS code, then save a passkey for future sign-ins. If you already have a Shiloh profile, we’ll reconnect you to it.';
    panel.hidden = false;
    smsOpenButtons.filter((item) => item.getAttribute('aria-controls') === panel.id)
      .forEach((item) => item.setAttribute('aria-expanded', String(item === button)));
    const codeForm = panel.querySelector('[data-client-sms-complete]');
    const focus = codeForm && !codeForm.hidden ? codeForm.elements.namedItem('code')
      : panel.querySelector(recovering ? 'input[name="mobile"]' : 'input[name="name"]');
    focus?.focus();
  }));

  async function beginSmsAuth(event) {
    event.preventDefault();
    if (authActionInFlight) return;
    const form = event.currentTarget;
    let codeSent = false;
    authActionInFlight = true;
    setAuthControlsDisabled(true);
    setAuthStatus('Sending your code…', 'working');
    try {
      const response = await postJson('/my-shiloh/auth/sms/start', {
        name: form.elements.namedItem('name').value.trim(),
        mobile: form.elements.namedItem('mobile').value.trim(),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status !== 'code_sent') throw new Error(result.error || 'Could not send your code.');
      for (const item of smsCompleteForms) item.hidden = false;
      setAuthStatus('Check your SMS and enter the code below.', 'waiting');
      codeSent = true;
    } catch (error) {
      setAuthStatus(error.message || 'Could not send your code.', 'error');
    } finally {
      authActionInFlight = false;
      setAuthControlsDisabled(false);
      if (codeSent) form.parentElement.querySelector('[data-client-sms-complete]')?.elements.namedItem('code')?.focus();
    }
  }

  async function completeSmsAuth(event) {
    event.preventDefault();
    if (authActionInFlight) return;
    const code = String(event.currentTarget.elements.namedItem('code').value || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return setAuthStatus('Enter your 6-digit SMS code.', 'error');
    authActionInFlight = true;
    setAuthControlsDisabled(true);
    setAuthStatus('Checking your code…', 'working');
    try {
      const response = await postJson('/my-shiloh/auth/sms/complete', { code });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.authenticated) throw new Error(result.error || 'Could not verify your code.');
      setAuthStatus('Verified. Opening My Shiloh…', 'success');
      window.location.replace(signedInLanding());
    } catch (error) {
      setAuthStatus(error.message || 'Could not verify your code.', 'error');
      authActionInFlight = false;
      setAuthControlsDisabled(false);
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

  smsStartForms.forEach((form) => form.addEventListener('submit', beginSmsAuth));
  smsCompleteForms.forEach((form) => form.addEventListener('submit', completeSmsAuth));
  if (!passkeySupported()) passkeySignInButtons.forEach((button) => { button.hidden = true; });
  if (!passkeySupported() && passkeyEnrollButton) passkeyEnrollButton.hidden = true;
  passkeySignInButtons.forEach((button) => button.addEventListener('click', signInWithPasskey));
  passkeyEnrollButton?.addEventListener('click', enrollClientPasskey);
  recoveryCreateButton?.addEventListener('click', createRecoveryCode);
  recoveryForms.forEach((form) => form.addEventListener('submit', signInWithRecoveryCode));
  loadPasskeyDevices();
  authLogoutButtons.forEach((button) => button.addEventListener('click', logoutClient));
  window.addEventListener('pageshow', refreshAuthenticatedClientState);
  window.addEventListener('focus', refreshAuthenticatedClientState);
  window.addEventListener('focus', clearHomeScreenAppBadge);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshAuthenticatedClientState();
      clearHomeScreenAppBadge();
    }
  });

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
