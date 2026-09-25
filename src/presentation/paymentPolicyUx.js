function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function renderPolicySection(section) {
  if (!section?.heading) return '';
  const heading = '<h2>' + escapeHtml(section.heading) + '</h2>';
  const lines = Array.isArray(section.lines) ? section.lines.filter(Boolean) : [];

  const body = lines.map(line => {
    if (line.startsWith('•')) return '<li>' + escapeHtml(line.replace(/^•\s*/, '')) + '</li>';
    return '<p>' + escapeHtml(line) + '</p>';
  });

  const firstBullet = lines.findIndex(line => line.startsWith('•'));
  if (firstBullet >= 0) {
    const before = lines.slice(0, firstBullet).map(line => '<p>' + escapeHtml(line) + '</p>').join('');
    const bullets = lines.slice(firstBullet).map(line => '<li>' + escapeHtml(line.replace(/^•\s*/, '')) + '</li>').join('');
    return heading + before + '<ul>' + bullets + '</ul>';
  }

  return heading + body.join('');
}

function webPolicyHtml(policyText = '') {
  const lines = String(policyText || '').split(/\r?\n/);
  const preamble = [];
  const sections = [];
  let current = null;

  function finishSection() {
    if (!current) return;
    sections.push(current);
    current = null;
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;
    if (/^\*?Shiloh Massage Therapy & Aesthetic Clinic — Booking Policy & Terms\*?$/i.test(line)) continue;
    if (/^Booking Policy & Terms$/i.test(line)) continue;
    if (/^Policy updated:/i.test(line)) continue;
    if (/^Policy version:/i.test(line)) continue;
    if (/^To continue with this booking request, reply exactly:/i.test(line)) continue;
    if (/^If you do not agree, reply /i.test(line)) continue;

    const heading = line.match(/^\*([^*]+)\*$/);
    if (heading) {
      finishSection();
      current = { heading: heading[1], lines: [] };
      continue;
    }

    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  finishSection();

  const preferredOrder = [
    'Booking Deposit',
    'Cancellations & Rescheduling',
    'Appointments & Arrival',
    'Health & Treatment Information',
    'Treatment Suitability & Results',
    'Respect, Safety & Belongings',
  ];
  const sectionByHeading = new Map(sections.map(section => [section.heading, section]));
  const rendered = [];

  for (const heading of preferredOrder.slice(0, 2)) {
    const section = sectionByHeading.get(heading);
    if (section) {
      rendered.push(renderPolicySection(section));
      sectionByHeading.delete(heading);
    }
  }

  if (preamble.length) {
    rendered.push('<div class="policy-preamble"><h2>Professional Treatment Standards</h2>' + preamble.map(line => '<p>' + escapeHtml(line) + '</p>').join('') + '</div>');
  }

  for (const heading of preferredOrder.slice(2)) {
    const section = sectionByHeading.get(heading);
    if (section) {
      rendered.push(renderPolicySection(section));
      sectionByHeading.delete(heading);
    }
  }

  for (const section of sections) {
    if (sectionByHeading.has(section.heading)) {
      rendered.push(renderPolicySection(section));
      sectionByHeading.delete(section.heading);
    }
  }

  return rendered.join('');
}

function renderPaymentPolicyPage({ requestKey, request, policyText } = {}) {
  const key = escapeHtml(requestKey);
  const amount = escapeHtml(Number(request?.amount || 0).toFixed(2));
  const payerName = escapeHtml(request?.payer_name || 'there');
  const appointmentId = request?.appointment_id ? escapeHtml(request.appointment_id) : null;
  const policy = webPolicyHtml(policyText);
  const appointmentSummary = appointmentId
    ? '<div class="summary-card"><small>Booking</small><strong>#' + appointmentId + '</strong></div>'
    : '';
  return '<!doctype html>'
    + '<html lang="en"><head>'
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Review Shiloh Booking Policy &amp; Terms</title>'
    + '<style>'
    + ':root{--ink:#173126;--leaf:#285642;--muted:#61736a;--line:#d7dfd9;--soft:#f5f3ed;--panel:#fffdf9;--mint:#edf4ee}'
    + '*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font-family:Inter,system-ui,-apple-system,sans-serif}'
    + '.card{width:min(760px,calc(100% - 32px));margin:28px auto;padding:30px;border:1px solid var(--line);border-radius:22px;background:var(--panel);box-shadow:0 12px 34px #17312612}'
    + '.eyebrow{margin:0 0 8px;letter-spacing:.09em;font-size:.76rem;font-weight:850;color:var(--leaf)}'
    + 'h1{margin:0;font-size:clamp(1.7rem,4vw,2.25rem);line-height:1.12;letter-spacing:-.025em}'
    + '.intro{margin:12px 0 0;color:var(--muted);line-height:1.55}'
    + '.steps{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:22px 0 16px}.step{padding:14px;border:1px solid var(--line);border-radius:14px;background:#fff}.step.current{border-color:#b9ccbf;background:var(--mint)}'
    + '.step-number{display:block;margin-bottom:4px;font-size:.76rem;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:var(--leaf)}.step strong{display:block;font-size:.98rem}.step span{display:block;margin-top:4px;color:var(--muted);font-size:.9rem;line-height:1.45}'
    + '.summary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 24px}.summary-card{padding:15px 16px;border-radius:14px;background:var(--mint)}.summary-card small{display:block;margin-bottom:4px;color:var(--muted);font-weight:700}.summary-card strong{font-size:1.2rem}.confirm-note{grid-column:1/-1;margin:0;color:var(--muted);font-size:.9rem;line-height:1.45}'
    + '.policy-shell{margin-top:8px;border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden}.policy-head{padding:18px 18px 14px;border-bottom:1px solid var(--line);background:#fafbf8}.policy-head h2{margin:0;font-size:1.18rem}'
    + '.policy{padding:4px 18px 20px;color:#40584d;line-height:1.6}.policy h2{margin:22px 0 8px;padding-top:18px;border-top:1px solid #e9ede9;color:var(--ink);font-size:1.03rem}.policy h2:first-child{border-top:0;padding-top:8px}.policy p{margin:8px 0}.policy ul{margin:8px 0 10px;padding-left:21px}.policy li{margin:6px 0}.policy-preamble{margin-top:22px;padding-top:18px;border-top:1px solid #e9ede9}.policy-preamble h2{margin:0 0 8px;padding:0;border:0;color:var(--ink);font-size:1.03rem}.policy-preamble p{margin:0}'
    + '.acceptance{margin-top:18px;padding:16px;border:1px solid var(--line);border-radius:16px;background:#fafbf8}.acceptance label{display:flex;gap:12px;align-items:flex-start;min-height:48px;margin:0;font-weight:750;line-height:1.45;cursor:pointer}.acceptance input{width:22px;height:22px;margin:1px 0 0;accent-color:var(--leaf);flex:0 0 auto}'
    + 'button{width:100%;min-height:52px;margin-top:14px;border:0;border-radius:999px;padding:14px 18px;background:var(--leaf);color:#fff;font-size:1rem;font-weight:850;cursor:pointer}button:hover{filter:brightness(.96)}button:focus-visible,input:focus-visible{outline:3px solid #91b09f;outline-offset:3px}'
    + '.footer-note{margin:14px 0 0;text-align:center;color:var(--muted);font-size:.82rem;line-height:1.45}'
    + '@media(max-width:560px){body{background:var(--panel)}.card{width:100%;min-height:100vh;margin:0;padding:20px 16px 28px;border:0;border-radius:0;box-shadow:none}.steps,.summary{grid-template-columns:1fr}.confirm-note{grid-column:auto}.policy-head{padding:16px 15px 12px}.policy{padding:2px 15px 18px}}'
    + '</style></head><body>'
    + '<main class="card">'
    + '<p class="eyebrow">SHILOH DEPOSIT · STEP 1 OF 2</p>'
    + '<h1>Review &amp; accept before payment</h1>'
    + '<p class="intro">Hi ' + payerName + '. You’re still on Shiloh. No payment is taken until you accept the Booking Policy &amp; Terms and continue to Ozow.</p>'
    + '<div class="steps" aria-label="Deposit payment steps">'
    + '<div class="step current"><span class="step-number">Step 1</span><strong>Review &amp; accept</strong><span>Read Shiloh’s Booking Policy &amp; Terms and confirm your acceptance.</span></div>'
    + '<div class="step"><span class="step-number">Step 2</span><strong>Pay securely</strong><span>You’ll then continue to Ozow to complete the deposit.</span></div>'
    + '</div>'
    + '<section class="summary" aria-label="Deposit summary">'
    + '<div class="summary-card"><small>Deposit due</small><strong>R' + amount + '</strong></div>'
    + appointmentSummary
    + '<p class="confirm-note">Your appointment is confirmed only after Shiloh verifies the required deposit.</p>'
    + '</section>'
    + '<section class="policy-shell" aria-labelledby="policy-heading">'
    + '<div class="policy-head"><h2 id="policy-heading">Booking Policy &amp; Terms</h2></div>'
    + '<div class="policy">' + policy + '</div>'
    + '</section>'
    + '<form method="post" action="/pay/' + key + '/accept">'
    + '<div class="acceptance"><label><input type="checkbox" name="accept" value="yes" required> <span>I have read and accept Shiloh’s Booking Policy &amp; Terms.</span></label>'
    + '<button type="submit">Accept &amp; continue to secure payment</button></div>'
    + '</form>'
    + '<p class="footer-note">You will leave Shiloh for Ozow only after you accept these terms.</p>'
    + '</main></body></html>';
}

module.exports = { escapeHtml, webPolicyHtml, renderPaymentPolicyPage };
