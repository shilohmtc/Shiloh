import policyAuthority from '../src/config/bookingPolicyAuthority.js';

const {
  BOOKING_POLICY_TEXT,
  BOOKING_POLICY_VERSION,
  BOOKING_POLICY_UPDATED,
} = policyAuthority;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}

function policyMarkup() {
  const paragraphs = BOOKING_POLICY_TEXT
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bold = line.match(/^\*(.+)\*$/);
      if (bold) return `<h2>${escapeHtml(bold[1])}</h2>`;
      return `<p>${escapeHtml(line).replace(/\*([^*]+)\*/g, '<strong>$1</strong>')}</p>`;
    })
    .join('');

  return `
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#f5f3ed;color:#20322b;font-family:Inter,system-ui,sans-serif}
      .policy-shell{min-height:100vh;padding:24px}
      .policy-card{width:min(760px,100%);margin:0 auto;background:#fffdf9;border:1px solid #dce3dd;border-radius:18px;padding:24px;box-shadow:0 12px 34px rgba(32,50,43,.08)}
      .eyebrow{margin:0 0 8px;font-size:.76rem;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:#56685f}
      h1{margin:0 0 6px;font-size:1.7rem;line-height:1.15}
      .version{margin:0 0 22px;color:#56685f;font-size:.9rem}
      .policy-copy{display:grid;gap:10px}
      .policy-copy h2{margin:12px 0 0;font-size:1.05rem}
      .policy-copy p{margin:0;line-height:1.55}
      @media(max-width:700px){.policy-shell{padding:12px}.policy-card{padding:18px;border-radius:14px}h1{font-size:1.4rem}}
    </style>
    <main class="policy-shell" data-booking-policy-story>
      <article class="policy-card" aria-labelledby="booking-policy-title">
        <p class="eyebrow">Shiloh Massage Therapy &amp; Aesthetic Clinic</p>
        <h1 id="booking-policy-title">Booking Policy &amp; Terms</h1>
        <p class="version">Version ${escapeHtml(BOOKING_POLICY_VERSION)} · Updated ${escapeHtml(BOOKING_POLICY_UPDATED)}</p>
        <div class="policy-copy">${paragraphs}</div>
      </article>
    </main>
  `;
}

export default {
  title: 'Client/Booking Policy',
  parameters: { layout: 'fullscreen' },
};

export const UnifiedBookingPolicy = {
  render: () => policyMarkup(),
};
