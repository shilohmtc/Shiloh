function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pageStyles() {
  return `:root{color-scheme:light;--ink:#20322b;--muted:#66746d;--paper:#f5f3ed;--panel:#fffdf9;--line:#dce3dd;--line-strong:#c9d4cc;--leaf:#3f6653;--leaf-deep:#294c3c;--leaf-soft:#e7eee9;--sand:#f2eee4;--rose:#8a514d;--rose-soft:#f8ecea;--shadow:0 14px 44px rgba(32,50,43,.08)}*{box-sizing:border-box}html{background:var(--paper)}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:760px;margin:0 auto;padding:18px 14px 88px}.brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.brand-mark{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.01em}.brand-dot{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--leaf-deep);color:#fff;font-family:Georgia,serif;font-size:1rem}.secure-note{font-size:.72rem;color:var(--muted)}.hero,.section,.consent,.signature,.done,.unavailable{background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow)}.hero{border-radius:22px;padding:20px;margin-bottom:13px}.eyebrow{font-size:.7rem;text-transform:uppercase;letter-spacing:.09em;color:var(--leaf-deep);font-weight:900}.hero h1{margin:7px 0 7px;font-size:1.55rem;line-height:1.14}.hero p{margin:0;color:var(--muted);line-height:1.55;font-size:.88rem}.appointment-card{display:grid;gap:5px;margin-top:15px;padding:13px;border-radius:15px;background:var(--leaf-soft);font-size:.79rem}.appointment-card strong{font-size:.84rem}.appointment-meta{color:var(--muted)}.intro-note{margin:12px 2px 17px;color:var(--muted);font-size:.78rem;line-height:1.5}.section{border-radius:19px;padding:18px;margin-bottom:12px}.section-head{display:flex;align-items:flex-start;gap:11px;margin-bottom:12px}.section-number{width:30px;height:30px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;background:var(--leaf-soft);color:var(--leaf-deep);font-size:.72rem;font-weight:900}.section-head h2{margin:1px 0 2px;font-size:1rem}.section-head p{margin:0;color:var(--muted);font-size:.72rem;line-height:1.4}.group+.group{border-top:1px solid var(--line);margin-top:14px;padding-top:14px}.group h3{margin:0 0 9px;font-size:.85rem}.field{padding:11px 0}.field+.field{border-top:1px solid #eef1ee}.label{display:block;font-size:.82rem;line-height:1.42;font-weight:760;margin-bottom:7px}.required{color:var(--rose);font-weight:900}.hint{display:block;margin-top:5px;color:var(--muted);font-size:.68rem;font-weight:500;line-height:1.4}.text-input,.textarea-input{width:100%;border:1px solid var(--line-strong);border-radius:12px;background:#fff;color:var(--ink);font:inherit;font-size:.88rem;padding:11px 12px;outline:none}.text-input{min-height:46px}.textarea-input{min-height:92px;resize:vertical}.text-input:focus,.textarea-input:focus{border-color:var(--leaf);box-shadow:0 0 0 3px rgba(63,102,83,.13)}.choice-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.choice{position:relative}.choice input{position:absolute;opacity:0;pointer-events:none}.choice span{display:flex;align-items:center;justify-content:center;min-height:46px;border:1px solid var(--line-strong);border-radius:12px;background:#fff;font-size:.82rem;font-weight:850;cursor:pointer}.choice input:checked+span{border-color:var(--leaf);background:var(--leaf-soft);color:var(--leaf-deep);box-shadow:inset 0 0 0 1px var(--leaf)}.choice input:focus-visible+span{outline:3px solid rgba(63,102,83,.25);outline-offset:2px}.follow-up{margin-top:9px;padding:11px;border-left:3px solid var(--leaf);border-radius:0 12px 12px 0;background:#fafbf9}.follow-up .label{font-size:.76rem}.error{margin:7px 0 0;color:var(--rose);font-size:.71rem;font-weight:760}.field.has-error .text-input,.field.has-error .textarea-input{border-color:var(--rose)}.field.has-error .choice span{border-color:#dab7b3}.summary-error{margin-bottom:12px;padding:11px 12px;border:1px solid #e3c3c0;border-radius:13px;background:var(--rose-soft);color:#6f3f3b;font-size:.77rem;line-height:1.45}.consent,.signature{border-radius:19px;padding:18px;margin-bottom:12px}.consent h2,.signature h2{margin:0 0 7px;font-size:1rem}.consent>p,.signature>p{margin:0;color:var(--muted);font-size:.76rem;line-height:1.55}.declaration{margin-top:12px;padding:13px;border-radius:13px;background:var(--sand);font-size:.74rem;line-height:1.58;color:#4e5d56}.check-row{display:flex;align-items:flex-start;gap:10px;margin-top:13px}.check-row input{width:20px;height:20px;flex:0 0 auto;margin:1px 0 0;accent-color:var(--leaf)}.check-row label{font-size:.78rem;line-height:1.45;font-weight:720}.signature-box{margin-top:13px}.signature-preview{min-height:62px;margin-top:8px;padding:13px 12px;border:1px dashed var(--line-strong);border-radius:12px;background:#fff;color:var(--leaf-deep);font-family:Georgia,"Times New Roman",serif;font-size:1.2rem;font-style:italic}.signature-preview.empty{color:var(--muted);font-family:inherit;font-size:.72rem;font-style:normal}.submit-wrap{position:sticky;bottom:0;margin:18px -14px -88px;padding:12px 14px 18px;background:linear-gradient(to top,var(--paper) 72%,rgba(245,243,237,0));z-index:3}.submit{width:100%;min-height:52px;border:0;border-radius:14px;background:var(--leaf-deep);color:#fff;font:inherit;font-size:.9rem;font-weight:900;cursor:pointer;box-shadow:0 8px 22px rgba(41,76,60,.2)}.submit:hover{background:#234335}.submit:disabled{opacity:.62;cursor:wait}.privacy{margin-top:9px;text-align:center;color:var(--muted);font-size:.66rem;line-height:1.45}.done,.unavailable{margin-top:52px;border-radius:22px;padding:26px 21px;text-align:center}.done-icon{width:48px;height:48px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;background:var(--leaf-soft);color:var(--leaf-deep);font-size:1.25rem;font-weight:900}.done h1,.unavailable h1{margin:0 0 8px;font-size:1.35rem}.done p,.unavailable p{margin:0;color:var(--muted);font-size:.84rem;line-height:1.55}.done small{display:block;margin-top:13px;color:var(--muted);font-size:.7rem}@media(min-width:720px){.page{padding-top:30px}.hero{padding:24px}.section,.consent,.signature{padding:21px}.submit-wrap{position:static;margin:18px 0 0;padding:0;background:none}.submit{max-width:320px;display:block;margin-left:auto}.privacy{text-align:right}}`;
}

function inputValue(values, prefill, key) {
  if (Object.prototype.hasOwnProperty.call(values || {}, key)) return String(values[key] || '');
  return String(prefill?.[key] || '');
}

function fieldError(errors, key) {
  const text = errors?.[key];
  return text ? `<p class="error" id="error-${escapeHtml(key)}">${escapeHtml(text)}</p>` : '';
}

function ariaError(errors, key) {
  return errors?.[key] ? ` aria-invalid="true" aria-describedby="error-${escapeHtml(key)}"` : '';
}

function renderTextInput(item, values, prefill, errors) {
  const key = String(item.key || '');
  const type = String(item.type || 'text');
  const value = inputValue(values, prefill, key);
  const required = item.required === true ? ' required' : '';
  const inputType = type === 'prefill_date' || type === 'date' ? 'date' : item.key === 'email' ? 'email' : 'text';
  const autocomplete = item.key === 'first_name' ? 'given-name'
    : item.key === 'surname' ? 'family-name'
      : item.key === 'email' ? 'email'
        : item.key === 'mobile' ? 'tel'
          : item.key === 'date_of_birth' ? 'bday'
            : 'off';
  if (type === 'textarea') {
    return `<textarea class="textarea-input" name="${escapeHtml(key)}" id="${escapeHtml(key)}" maxlength="4000"${required}${ariaError(errors, key)}>${escapeHtml(value)}</textarea>`;
  }
  return `<input class="text-input" type="${inputType}" name="${escapeHtml(key)}" id="${escapeHtml(key)}" value="${escapeHtml(value)}" maxlength="500" autocomplete="${autocomplete}"${required}${ariaError(errors, key)}>`;
}

function renderYesNo(item, values, errors) {
  const key = String(item.key || '');
  const selected = String(values?.[key] || '').toLowerCase();
  const yesChecked = selected === 'yes' ? ' checked' : '';
  const noChecked = selected === 'no' ? ' checked' : '';
  const required = item.required === true ? ' required' : '';
  return `<div class="choice-row" role="radiogroup" aria-label="${escapeHtml(item.label || key)}">
    <label class="choice"><input type="radio" name="${escapeHtml(key)}" value="yes"${yesChecked}${required}><span>Yes</span></label>
    <label class="choice"><input type="radio" name="${escapeHtml(key)}" value="no"${noChecked}${required}><span>No</span></label>
  </div>${fieldError(errors, key)}`;
}

function renderFollowUp(item, values, errors) {
  if (!item.follow_up?.key || !item.follow_up?.label) return '';
  const key = String(item.follow_up.key);
  const value = String(values?.[key] || '');
  return `<div class="follow-up" data-follow-up-for="${escapeHtml(item.key)}">
    <label class="label" for="${escapeHtml(key)}">${escapeHtml(item.follow_up.label)} <span class="required" aria-hidden="true">*</span></label>
    <textarea class="textarea-input" name="${escapeHtml(key)}" id="${escapeHtml(key)}" maxlength="1000"${ariaError(errors, key)}>${escapeHtml(value)}</textarea>
    ${fieldError(errors, key)}
  </div>`;
}

function renderItem(item, values, prefill, errors) {
  const key = String(item.key || '');
  const required = item.required === true ? ' <span class="required" aria-label="required">*</span>' : '';
  const hasError = errors?.[key] || (item.follow_up?.key && errors?.[item.follow_up.key]);
  const hint = String(item.type || '').startsWith('prefill_') ? '<span class="hint">We have prefilled this where possible. Please check that it is correct.</span>' : '';
  const answer = String(item.type || '') === 'yes_no'
    ? renderYesNo(item, values, errors)
    : `${renderTextInput(item, values, prefill, errors)}${fieldError(errors, key)}`;
  return `<div class="field${hasError ? ' has-error' : ''}" data-form-field="${escapeHtml(key)}">
    <label class="label" for="${escapeHtml(key)}">${escapeHtml(item.label || 'Form item')}${required}${hint}</label>
    ${answer}
    ${renderFollowUp(item, values, errors)}
  </div>`;
}

function renderGroup(group, values, prefill, errors) {
  const fields = Array.isArray(group.fields) ? group.fields : [];
  const questions = Array.isArray(group.questions) ? group.questions : [];
  return `<div class="group"><h3>${escapeHtml(group.title || 'Details')}</h3>${[...fields, ...questions].map(item => renderItem(item, values, prefill, errors)).join('')}</div>`;
}

function formatAppointment(model = {}) {
  const starts = model.startsAt ? new Date(model.startsAt) : null;
  let when = '';
  if (starts && !Number.isNaN(starts.getTime())) {
    const date = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(starts);
    const time = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(starts);
    when = `${date} at ${time}`;
  }
  return {
    treatment: (model.services || []).join(' + ') || 'Your treatment',
    practitioner: (model.practitioners || []).join(' & '),
    when,
  };
}

function renderClientConsultationFormPage(model = {}) {
  const form = model.form || {};
  const values = model.values || {};
  const errors = model.fieldErrors || {};
  const prefill = model.prefill || {};
  const appointment = formatAppointment(model.appointment || {});
  let sectionNumber = 0;
  const sections = (form.sections || []).map(section => {
    const groups = Array.isArray(section.definition?.groups) ? section.definition.groups : [];
    if (!groups.length) return '';
    sectionNumber += 1;
    return `<section class="section" data-client-form-section="${escapeHtml(section.sectionKey)}">
      <div class="section-head"><span class="section-number">${sectionNumber}</span><div><h2>${escapeHtml(section.title)}</h2><p>Please answer what applies to you today.</p></div></div>
      ${groups.map(group => renderGroup(group, values, prefill, errors)).join('')}
    </section>`;
  }).join('');
  const signatureName = String(values.signature_name || '');
  const consentChecked = String(values.consent_acknowledged || '') === 'yes' ? ' checked' : '';
  const signatureChecked = String(values.signature_confirm || '') === 'yes' ? ' checked' : '';
  const summaryError = model.formError ? `<div class="summary-error" role="alert">${escapeHtml(model.formError)}</div>` : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow,noarchive"><title>Consultation form — Shiloh</title><style>${pageStyles()}</style><script src="/forms/assets/client-consultation.js" defer></script></head><body><main class="page">
    <div class="brand"><div class="brand-mark"><span class="brand-dot">S</span><span>Shiloh</span></div><span class="secure-note">Secure consultation form</span></div>
    <section class="hero"><div class="eyebrow">Before your treatment</div><h1>${escapeHtml(form.title || 'Consultation form')}</h1><p>Please complete this form privately before your appointment. Your answers are stored securely for your practitioner and are not placed in WhatsApp messages.</p>
      <div class="appointment-card"><strong>${escapeHtml(appointment.treatment)}</strong>${appointment.when ? `<span class="appointment-meta">${escapeHtml(appointment.when)}</span>` : ''}${appointment.practitioner ? `<span class="appointment-meta">With ${escapeHtml(appointment.practitioner)}</span>` : ''}</div>
    </section>
    <p class="intro-note">Fields marked <span class="required">*</span> are required. We have prefilled profile details where possible, but you can correct them here without changing your Shiloh client profile.</p>
    ${summaryError}
    <form method="post" action="/forms/f/${escapeHtml(model.accessToken || '')}" data-client-consultation-form novalidate>
      ${sections}
      <section class="consent"><h2>Consent & declaration</h2><p>Please read this carefully before signing.</p><div class="declaration">${escapeHtml(form.consentText || '')}</div>
        <div class="check-row"><input type="checkbox" id="consent_acknowledged" name="consent_acknowledged" value="yes"${consentChecked} required><label for="consent_acknowledged">I have read and agree to the declaration above. <span class="required" aria-label="required">*</span></label></div>
        ${fieldError(errors, 'consent_acknowledged')}
      </section>
      <section class="signature"><h2>Your electronic signature</h2><p>Type your full name below. Shiloh records the date and time when you submit the form.</p>
        <div class="signature-box"><label class="label" for="signature_name">Full name as signature <span class="required" aria-label="required">*</span></label><input class="text-input" type="text" id="signature_name" name="signature_name" value="${escapeHtml(signatureName)}" maxlength="120" autocomplete="name" required${ariaError(errors, 'signature_name')}>${fieldError(errors, 'signature_name')}<div class="signature-preview${signatureName ? '' : ' empty'}" data-signature-preview>${signatureName ? escapeHtml(signatureName) : 'Your signature preview will appear here.'}</div></div>
        <div class="check-row"><input type="checkbox" id="signature_confirm" name="signature_confirm" value="yes"${signatureChecked} required><label for="signature_confirm">I confirm that the name typed above is my electronic signature and that I am submitting this form myself. <span class="required" aria-label="required">*</span></label></div>
        ${fieldError(errors, 'signature_confirm')}
      </section>
      <div class="submit-wrap"><button class="submit" type="submit" data-submit-form>Sign & submit securely</button><div class="privacy">Please do not share this link. It is unique to this appointment and expires automatically.</div></div>
    </form>
  </main></body></html>`;
}

function renderCompletedPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Form received — Shiloh</title><style>${pageStyles()}</style></head><body><main class="page"><div class="brand"><div class="brand-mark"><span class="brand-dot">S</span><span>Shiloh</span></div><span class="secure-note">Secure consultation form</span></div><section class="done"><div class="done-icon">✓</div><h1>Thank you — your form is complete.</h1><p>Your consultation form and electronic signature have been received securely. Your practitioner will review it before your treatment.</p><small>You can close this page now.</small></section></main></body></html>`;
}

function renderUnavailablePage({ message = 'This consultation form link is not available.' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Form unavailable — Shiloh</title><style>${pageStyles()}</style></head><body><main class="page"><div class="brand"><div class="brand-mark"><span class="brand-dot">S</span><span>Shiloh</span></div></div><section class="unavailable"><h1>Consultation form unavailable</h1><p>${escapeHtml(message)}</p></section></main></body></html>`;
}

module.exports = {
  escapeHtml,
  pageStyles,
  formatAppointment,
  renderClientConsultationFormPage,
  renderCompletedPage,
  renderUnavailablePage,
};
