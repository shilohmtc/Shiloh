const { clientActionForm } = require('./workspaceClientActionsUx');
const { escapeHtml } = require('./workspaceShell');
const { renderConsultationHistory } = require('./workspaceClientDocumentsUx');

const { formatVoucherDate } = require('../lib/voucherDate');

const money = value => `R${Number(value || 0).toFixed(2)}`;
const date = value => value ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium' }).format(new Date(value)) : 'No expiry';

function financialSection(state, label, render) {
  if (state?.restricted || !state) return `<p>Your Workspace access does not include this client’s ${label}.</p>`;
  if (state.unavailable || !state.data) return `<p role="status">${label[0].toUpperCase() + label.slice(1)} are temporarily unavailable. Please try again.</p>`;
  return render(state.data);
}

function renderRewards(state) {
  return financialSection(state, 'rewards', data => {
    if (!data.wallet) return '<p>No rewards wallet is recorded for this client.</p>';
    return `<p><strong>Recorded balance: ${escapeHtml(money(data.wallet.balance))}</strong><br>${data.wallet.unlocked ? 'Rewards unlocked' : `Rewards unlock at ${escapeHtml(money(data.policy.unlockThreshold))}`}</p><p class="truth-note">Recorded rewards only. Booking and redemption checks still apply.</p><div class="policy-history-list">${data.entries.map(entry => `<article class="policy-history-row"><div><strong>${escapeHtml(String(entry.entry_type).replace(/_/g, ' '))}</strong><br>${escapeHtml(date(entry.created_at))}</div><span>${escapeHtml(money(entry.signed_amount))}</span><span>${escapeHtml(entry.notes || '')}</span></article>`).join('') || '<p>No rewards activity recorded.</p>'}</div>${data.entries.length === 50 ? '<p>Latest 50 recorded entries shown.</p>' : ''}`;
  });
}

function renderVouchers(state) {
  return financialSection(state, 'vouchers', data => {
    const group = (label, items) => `<h3>${label}</h3>${items.length ? `<div class="policy-history-list">${items.map(item => `<article class="policy-history-row"><div><strong>${escapeHtml(item.voucher_code)}</strong><br>${escapeHtml(item.expired ? 'Expired' : item.state)}${item.order_state !== 'paid' ? ' · Payment not confirmed' : ''}</div><span>Balance ${escapeHtml(money(item.balance))}<br>Original value ${escapeHtml(money(item.original_value))}</span><span>${item.valid_until ? 'Expires ' : ''}${escapeHtml(formatVoucherDate(item.valid_until))}</span></article>`).join('')}</div>` : '<p>No vouchers recorded.</p>'}`;
    return `${group('Received by this client', data.received)}${group('Purchased by this client', data.purchased)}<p class="truth-note">Purchased vouchers belong to their recorded recipients. Redemption eligibility is checked separately.</p>`;
  });
}

function renderClientServices(model, { policySection, activitySection }) {
  const selected = model.services;
  const sections = [
    ['activity', 'Activity', activitySection],
    ['forms', 'Forms', `<section id="consultation-documents" data-client-consultation-history><h3>Consultation forms</h3>${renderConsultationHistory(model) || '<p>No completed consultation forms are recorded for this client.</p>'}</section>${policySection}`],
    ['rewards', 'Rewards', clientActionForm(model, 'rewards') + renderRewards(model.rewards)],
    ['vouchers', 'Vouchers', clientActionForm(model, 'vouchers') + renderVouchers(model.vouchers)],
  ];
  const section=sections.find(([key])=>key===selected);
  if (!section) return '<section class="history-panel client-services" data-client-profile-services hidden></section>';
  const [key,title,body]=section;
  return `<section class="history-panel client-services" data-client-profile-services id="client-${key}" aria-labelledby="client-services-title"><div class="client-service-body"><h2 id="client-services-title">${title}</h2>${body}</div></section>`;
}

const clientServicesStyles = `.client-services{margin-bottom:12px}.client-service{border-top:1px solid var(--line,#dce4df)}.client-service>summary{padding:18px 4px;font-size:1.05rem;font-weight:700;cursor:pointer;min-height:48px}.client-service>summary:focus-visible{outline:3px solid #547c63;outline-offset:2px}.client-service-body{padding:0 4px 18px;overflow-wrap:anywhere;min-width:0}.client-service-body .history-panel{padding:0;box-shadow:none;border:0;background:transparent}.client-service-body .section-heading{flex-wrap:wrap}.client-service-body h3{margin:16px 0 10px}.workspace-main .client-service-body .history-panel{padding:0!important;box-shadow:none!important}`;
module.exports = { renderClientServices, clientServicesStyles };
