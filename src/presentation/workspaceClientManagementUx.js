const { escapeHtml } = require('./workspaceShell');

const tools = [
  ['messages', 'Activity', 'Updates and delivery follow-ups'],
  ['vouchers', 'Gift Vouchers', 'Issue, redeem and manage vouchers'],
  ['rewards', 'Rewards', 'Balances and reward adjustments'],
  ['forms', 'Forms', 'Readiness, iPad preparation and templates'],
];

function renderClientManagement(navigation = {}) {
  return `<details class="client-management" data-client-management><summary>Manage across clients</summary><nav class="client-management-links" aria-label="Manage across clients">${tools.map(([key, label, description]) => {
    const href = navigation[`${key}Href`];
    const content = `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(description)}</span>`;
    return href
      ? `<a class="workspace-link" data-workspace-destination="${key}" href="${escapeHtml(href)}">${content}</a>`
      : `<span class="workspace-link future" aria-disabled="true" data-workspace-destination="${key}">${content}</span>`;
  }).join('')}</nav></details>`;
}

function clientManagementStyles() {
  return `.client-management{margin:0 0 16px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.client-management:not(:has(a)){display:none}.client-management summary{padding:14px 16px;min-height:48px;font-size:.88rem;font-weight:750;cursor:pointer}.client-management summary:focus-visible,.client-management a:focus-visible{outline:2px solid var(--leaf);outline-offset:2px}.client-management-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 12px 12px}.client-management-links .workspace-link{display:grid;align-content:start;gap:4px;min-height:70px;padding:12px;text-align:left;color:var(--ink);background:var(--leaf-soft);font-size:.86rem}.client-management-links .workspace-link span{font-size:.78rem;font-weight:400;line-height:1.4;color:var(--muted)}.client-management-links .workspace-link::before{display:none}.client-management-links .workspace-link:hover{background:#dce7df;color:var(--ink)}.client-management-links .future{display:none}@media(max-width:500px){.client-management-links{grid-template-columns:1fr}}`;
}

module.exports = { renderClientManagement, clientManagementStyles };
