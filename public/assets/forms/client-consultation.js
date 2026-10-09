(() => {
  'use strict';

  function setFollowUpState(form, container) {
    const parent = container.getAttribute('data-follow-up-for');
    if (!parent) return;
    const selected = form.querySelector(`input[name="${CSS.escape(parent)}"]:checked`);
    const show = selected?.value === 'yes';
    container.hidden = !show;
    const input = container.querySelector('input,textarea,select');
    if (input) input.required = show;
  }

  function initializeFollowUps(form) {
    const containers = [...form.querySelectorAll('[data-follow-up-for]')];
    for (const container of containers) {
      const parent = container.getAttribute('data-follow-up-for');
      const radios = [...form.querySelectorAll(`input[name="${CSS.escape(parent)}"]`)];
      for (const radio of radios) radio.addEventListener('change', () => setFollowUpState(form, container));
      setFollowUpState(form, container);
    }
  }

  function initializeSignature(form) {
    const input = form.querySelector('#signature_name');
    const preview = form.querySelector('[data-signature-preview]');
    if (!input || !preview) return;
    const refresh = () => {
      const value = input.value.trim();
      preview.textContent = value || 'Your signature preview will appear here.';
      preview.classList.toggle('empty', !value);
    };
    input.addEventListener('input', refresh);
    refresh();
  }

  function initializeSubmit(form) {
    const button = form.querySelector('[data-submit-form]');
    let checking = false;
    let timer;
    let status;
    let checkButton;
    const action = new URL(form.action, window.location.href);
    // Clinic iPad completion has its own session-reset/redirect authority.
    const canCheck = !form.hasAttribute('data-clinic-checkin')
      && action.origin === window.location.origin
      && /^\/forms\/f\/[A-Za-z0-9_-]{43}$/.test(action.pathname);

    function showCompleted(html) {
      const completed = html.querySelector('[data-client-consultation-completed]');
      if (!completed || !form.isConnected) return false;
      const confirmation = document.importNode(html.querySelector('main.page') || completed, true);
      (form.closest('main.page') || form).replaceWith(confirmation);
      const heading = confirmation.querySelector('h1');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
      return true;
    }

    async function submitWithoutNavigation(body) {
      try {
        const response = await fetch(action.href, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', body,
        });
        if (new URL(response.url).origin !== action.origin) throw new Error('Unexpected response');
        const html = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (response.ok && showCompleted(html)) return;
        // Use the existing server-rendered validation/unavailable page without
        // depending on another top-level navigation in the installed app.
        if (!form.isConnected) return;
        if (html.querySelector('[data-client-consultation-form]') && response.status !== 422) {
          throw new Error('Completion not confirmed');
        }
        const main = html.querySelector('main.page');
        const current = form.closest('main.page');
        if (!main || !current) throw new Error('Unexpected response');
        window.clearTimeout(timer);
        current.replaceWith(document.importNode(main, true));
        const retryForm = document.querySelector('[data-client-consultation-form]');
        if (retryForm) {
          initializeFollowUps(retryForm);
          initializeSignature(retryForm);
          initializeSubmit(retryForm);
        }
        const focus = document.querySelector('.summary-error, .unavailable h1');
        focus?.setAttribute('tabindex', '-1');
        focus?.focus();
      } catch (_error) {
        await checkCompletion();
      }
    }

    function showCheck(message) {
      if (!status) {
        const recovery = document.createElement('div');
        recovery.className = 'submission-recovery';
        status = document.createElement('p');
        status.setAttribute('role', 'status');
        checkButton = document.createElement('button');
        checkButton.type = 'button';
        checkButton.className = 'submit';
        checkButton.textContent = 'Check my submission';
        checkButton.addEventListener('click', checkCompletion);
        recovery.append(status, checkButton);
        (button?.parentElement || form).append(recovery);
      }
      status.textContent = message;
      checkButton.disabled = checking;
      if (button) button.textContent = 'Awaiting confirmation';
    }

    async function checkCompletion() {
      if (!canCheck || checking || !form.isConnected || form.dataset.submitting !== 'true') return;
      checking = true;
      window.clearTimeout(timer);
      showCheck('Checking whether your form was received…');
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      try {
        // GET only: never replay health answers or infer success from a timeout.
        const response = await fetch(action.href, {
          method: 'GET', credentials: 'same-origin', cache: 'no-store',
          redirect: 'error', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Confirmation unavailable');
        const html = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (showCompleted(html)) return;
        showCheck('Your form is not confirmed yet. Please wait, then check again. Do not submit it again.');
      } catch (_error) {
        showCheck('We could not check your submission. Check your connection, then try checking again. Do not submit it again.');
      } finally {
        window.clearTimeout(timeout);
        checking = false;
        if (checkButton?.isConnected) checkButton.disabled = false;
      }
    }

    form.addEventListener('submit', event => {
      if (form.dataset.submitting === 'true') {
        event.preventDefault();
        return;
      }
      if (!form.checkValidity()) {
        event.preventDefault();
        form.reportValidity();
        return;
      }
      const body = canCheck ? new URLSearchParams(new FormData(form)) : null;
      if (canCheck) event.preventDefault();
      form.dataset.submitting = 'true';
      if (button) {
        button.disabled = true;
        button.textContent = 'Submitting securely…';
      }
      if (canCheck) {
        timer = window.setTimeout(checkCompletion, 15000);
        submitWithoutNavigation(body);
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkCompletion();
    });
    window.addEventListener('pageshow', () => checkCompletion());
  }

  // A restored page must ask the server whether submission completed, never infer success.
  window.addEventListener('pageshow', event => {
    const form = document.querySelector('[data-client-consultation-form]');
    if (event.persisted && form?.dataset.submitting === 'true') window.location.replace(form.action);
  });

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('[data-client-consultation-form]');
    if (!form) return;
    initializeFollowUps(form);
    initializeSignature(form);
    initializeSubmit(form);
  });
})();
