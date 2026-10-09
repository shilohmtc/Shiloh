'use strict';
const { escapeHtml: esc } = require('./workspaceShell');
const money = (value) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(value));
function injectClientCreditSummary(html, { clientId, credit, unavailable = false }) {
  if (!credit && !unavailable) return html;
  const section = `<section class="history-panel client-credit-summary" data-client-credit-summary aria-labelledby="client-credit-heading"><header class="section-heading"><div><span class="eyebrow">Treatment balance</span><h2 id="client-credit-heading">Credit</h2></div></header>${unavailable ? '<p class="credit-summary-note" role="status">Credit balance is temporarily unavailable. Open credit history to review it.</p>' : `<p class="client-credit-balance"><span>Available client credit</span><strong>${esc(money(credit.balance))}</strong></p><p class="credit-summary-note">Noncash credit for completed treatments. Deposits still need payment.</p>`}<div class="client-credit-actions">${credit?.authority.canIssue ? `<a class="button primary" data-workspace-action="primary" href="/calendar/treatment-credit/clients/${esc(clientId)}#add-credit">Add credit</a>` : ''}<a class="button" data-workspace-action="secondary" href="/calendar/treatment-credit/clients/${esc(clientId)}#credit-history">${credit?.authority.canCorrect ? 'Manage credit history' : 'View credit history'}</a></div></section>`;
  const styles =
    '.client-credit-summary{margin:16px 0}.client-credit-balance{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:14px 0;padding:14px;background:#e7eee9;border-radius:10px}.client-credit-balance strong{font-size:1.5rem;white-space:nowrap;color:#294c3c}.client-credit-actions{display:flex;flex-wrap:wrap;gap:10px;padding:0 18px 18px}.client-credit-actions a{min-height:44px}.credit-summary-note{padding:0 18px;line-height:1.5;color:#52645b}';
  const withStyles = html.replace('</style>', `${styles}</style>`);
  return withStyles.includes('<section class="history-panel')
    ? withStyles.replace('<section class="history-panel', `${section}<section class="history-panel`)
    : withStyles.replace('</main>', `${section}</main>`);
}
module.exports = { injectClientCreditSummary };
