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
    form.addEventListener('submit', event => {
      if (!form.checkValidity()) {
        event.preventDefault();
        form.reportValidity();
        return;
      }
      if (button) {
        button.disabled = true;
        button.textContent = 'Submitting securely…';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('[data-client-consultation-form]');
    if (!form) return;
    initializeFollowUps(form);
    initializeSignature(form);
    initializeSubmit(form);
  });
})();
