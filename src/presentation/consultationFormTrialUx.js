const {
  escapeHtml,
  pageStyles,
  renderClientConsultationFormPage,
} = require('./clientConsultationFormUx');

function replaceRequired(html, before, after) {
  if (!html.includes(before)) throw new Error('CONSULTATION_TRIAL_RENDERER_CONTRACT_CHANGED');
  return html.replace(before, after);
}

// A thin adapter around the real form, not a second questionnaire implementation.
function renderTrialForm(model, token) {
  let html = renderClientConsultationFormPage({ ...model, accessToken: '' });
  html = replaceRequired(html, '/forms/assets/client-consultation.js', '/forms/test/assets/client-consultation.js');
  html = replaceRequired(html, '<form method="post" action="/forms/f/" data-client-consultation-form novalidate>',
    `<form method="post" action="/forms/test/submit" data-client-consultation-form novalidate><input type="hidden" name="access_token" value="${escapeHtml(token)}">`);
  html = replaceRequired(html, '<section class="hero">', '<section class="summary-error" role="note"><strong>TEST FORM — made-up information only.</strong><br>No real health information, ID number or personal signature. Use Test Client as the signature. This does not create a booking or give consent to a real treatment.</section><section class="hero">');
  html = replaceRequired(html, 'Before your treatment', 'Private test');
  html = replaceRequired(html, 'Please complete this form privately before your appointment. Your answers are stored securely for your practitioner and are not placed in WhatsApp messages.',
    'Try the questions, Yes / No buttons and signature using made-up answers. This test is saved separately from client records. Nothing is sent to clients or practitioners.');
  html = replaceRequired(html, 'We have prefilled profile details where possible, but you can correct them here without changing your Shiloh client profile.',
    'The prefilled details are fictional. Please keep all answers fictional.');
  html = html.replaceAll('We have prefilled this where possible. Please check that it is correct.', 'Fictional test details only.');
  html = replaceRequired(html, 'I have read and agree to the declaration above.', 'For this test, I confirm I have read the sample declaration.');
  html = replaceRequired(html, 'Type your full name below. Shiloh records the date and time when you submit the form.',
    'Type Test Client below, not your real name. Shiloh records the time of this test submission.');
  html = replaceRequired(html, 'I confirm that the name typed above is my electronic signature and that I am submitting this form myself.',
    'I confirm that this is a test signature only, not consent to a real treatment.');
  html = replaceRequired(html, 'Sign & submit securely', 'Submit test form securely');
  html = replaceRequired(html, 'Please do not share this link. It is unique to this appointment and expires automatically.',
    'Private test link for one tester. It expires automatically and accepts one completed submission.');
  return html.replace(/autocomplete="(?:given-name|family-name|email|tel|bday|name)"/g, 'autocomplete="off"');
}

function renderTrialLanding() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Private form test — Shiloh</title><style>${pageStyles()}</style><script src="/forms/test/assets/consultation-trial-entry.js" defer></script></head><body><main class="page"><section class="hero"><div class="eyebrow">Shiloh · Private test</div><h1>Try your consultation form</h1><p id="trial-entry-status" role="status">Opening your private test form…</p><p>Use made-up information only. No real booking or client record is created.</p><noscript>Please enable JavaScript and reopen the full private test link.</noscript></section></main></body></html>`;
}

function renderTrialCompleted() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Test form received — Shiloh</title><style>${pageStyles()}</style></head><body><main class="page"><section class="done"><div class="done-icon">✓</div><h1>Thank you — your test form is complete.</h1><p>Your test answers and test signature have been saved securely, separately from client records. No booking was created and no WhatsApp message was sent.</p><small>This link accepts one completed test. You can close this page now.</small></section></main></body></html>`;
}

module.exports = { renderTrialForm, renderTrialLanding, renderTrialCompleted };
