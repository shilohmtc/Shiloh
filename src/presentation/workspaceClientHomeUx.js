'use strict';
const { escapeHtml } = require('./workspaceShell');
const SECTIONS = [['overview','Overview'],['appointments','Appointments'],['vouchers','Vouchers'],['rewards','Rewards'],['forms','Forms'],['activity','Communications']];
function selectedClientSection(model) {
  return SECTIONS.some(([key])=>key===model.services) ? model.services : 'overview';
}
function clientSectionNavigation(model) {
  const selected=selectedClientSection(model),base='/calendar/clients/'+encodeURIComponent(String(model.client.id));
  const returnTo=model.returnHref||model.clientListReturnHref;
  return `<nav class="client-section-navigation" aria-label="Client sections">${SECTIONS.map(([key,label])=>`<a href="${base}?services=${key}${returnTo?'&amp;returnTo='+encodeURIComponent(returnTo):''}#client-${key}"${selected===key?' aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
}
function decorateClientHome(html, model) {
  const selected=selectedClientSection(model);
  return html.replace('<main data-client-detail-view>',`<main data-client-detail-view><div class="client-home" data-client-home-section="${selected}">`)
    .replace('</main>','</div></main>')
    .replace('>Back to Clients</a>',model.clientListReturnHref?.startsWith('/calendar/clients/insights?')?'>Back to Insights</a>':'>Back to Clients</a>')
    .replace('href="/calendar/clients" data-workspace-back-context',`href="${escapeHtml(model.clientListReturnHref || '/calendar/clients')}" data-workspace-back-context`)
    .replace('<nav class="detail-actions" aria-label="Client navigation">', '<nav class="detail-actions" aria-label="Client navigation">' + (model.returnHref ? `<a class="button" href="${escapeHtml(model.returnHref)}">Back to booking</a>` : ''))
    .replace('<div class="profile-grid">',`${clientSectionNavigation(model)}<div class="profile-grid">`)
    .replace('<span class="eyebrow">Client record</span>','')
    .replace('<a data-workspace-action="secondary" class="button" href="#appointment-history">Appointment history</a>','')
    .replace('</style>',`${clientHomeStyles}</style>`)
    .replace('</head>','<script src="/calendar/clients/home.js" defer></script></head>');
}
const clientHomeStyles = `.client-action{margin-bottom:20px}.client-action .field{font-size:.85rem}.client-action .field input,.client-action .field select{min-height:44px}.client-payment-confirm{display:flex;gap:10px;align-items:start;grid-column:1/-1}.client-payment-confirm input{width:20px;min-height:20px}.client-home{background:var(--panel,#fffdf9);border:1px solid var(--line,#dce3dd);border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(32,50,43,.05)}.client-home>.detail-actions{padding:16px 20px 0}.client-home>.profile-panel,.client-home>.history-panel,.client-home>.client-manage-panel{border:0;border-radius:0;box-shadow:none;background:transparent;margin:0;padding:20px}.client-home .profile-grid{border-top:0;padding-top:0}.client-home .client-section-navigation{border-bottom:1px solid var(--line);padding:12px 0;margin:12px 0 0;gap:6px;flex-wrap:wrap}.client-home .client-section-navigation a{min-height:44px;display:inline-flex;align-items:center;padding:8px 12px;border-radius:9px;text-decoration:none;color:var(--ink);font-weight:700}.client-home .client-section-navigation a[aria-current="page"]{background:var(--leaf-soft);color:var(--leaf-deep)}.client-home:not([data-client-home-section="overview"])>.profile-panel>.profile-grid,.client-home:not([data-client-home-section="overview"])>.profile-panel>.contact-card,.client-home:not([data-client-home-section="overview"])>.client-manage-panel{display:none}.client-home:not([data-client-home-section="appointments"])>.history-panel:not(.client-services):not(.client-credit-summary){display:none}.client-home:not([data-client-home-section="rewards"])>.client-credit-summary{display:none}.workspace-main .client-home>.profile-panel,.workspace-main .client-home>.history-panel{border-radius:0!important;box-shadow:none!important}.client-home>.client-services[hidden]{display:none}.client-home .client-service-body{padding:0}.client-home .client-service-body>h2{margin-top:0}.client-home .client-manage-panel>.eyebrow{display:none}.client-home :focus-visible{outline:3px solid var(--leaf-deep);outline-offset:3px}@media(max-width:700px){.client-home>.profile-panel,.client-home>.history-panel,.client-home>.client-manage-panel{padding:16px}.client-home>.detail-actions{padding:12px 16px 0}}`;
function clientHomeScript() {
  return require('./workspaceClientActionsUx').clientActionsScript() + `(()=>{'use strict';const home=document.querySelector('[data-client-home-section]');if(!home)return;const aliases={'#appointment-history':'appointments','#policy-documents':'forms','#consultation-documents':'forms','#client-overview':'overview','#client-appointments':'appointments','#client-forms':'forms','#client-vouchers':'vouchers','#client-rewards':'rewards','#client-activity':'activity'};const wanted=aliases[location.hash];if(wanted&&wanted!==home.dataset.clientHomeSection&&/^\\/calendar\\/clients\\/[1-9]\\d*$/.test(location.pathname)){const url=new URL(location.href);url.searchParams.set('services',wanted);location.replace(url.pathname+url.search+url.hash);}})();`;
}
module.exports={ selectedClientSection, clientSectionNavigation, decorateClientHome, clientHomeScript };
