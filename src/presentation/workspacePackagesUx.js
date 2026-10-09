const { phonePresentationClientScript } = require('./southAfricanPhone');
const { escapeHtml } = require('./workspaceShell');
const { shellStart, styles } = require('./workspaceServicesUx');
const { confirmationClientScript } = require('./workspaceConfirmation');
const { workspaceErrorRecoveryClientScript } = require('./workspaceErrorRecovery');
const h = escapeHtml;
function validity(p) {
  return p.validity_months
    ? `${p.validity_months} month${p.validity_months === 1 ? '' : 's'}`
    : `${p.validity_days} days`;
}
function fields(p = {}) {
  return `<div class="edit-grid"><label class="field wide">Package name<input name="name" maxlength="180" required value="${h(p.name || '')}"></label><label class="field">Full upfront price (R)<input name="price" type="number" min="0.01" step="0.01" required value="${h(p.package_price || '')}"></label><label class="field">Treatments included<input name="sessions" type="number" min="1" max="100" required value="${h(p.sessions_included || 4)}"></label><label class="field">Valid for<input name="validity" type="number" min="1" max="365" required value="${h(p.validity_months || p.validity_days || 1)}"></label><label class="field">Validity unit<select aria-label="Validity unit" name="validityUnit"><option value="months"${!p.id || p.validity_months ? ' selected' : ''}>Months</option><option value="days"${p.id && !p.validity_months ? ' selected' : ''}>Days</option></select></label><label class="field wide">Client description<textarea name="description" minlength="20" maxlength="2000" required>${h(p.customer_description || '')}</textarea></label></div>`;
}
function renderWorkspacePackages({
  packages = [],
  purchases = [],
  options = {},
  createOptions = null,
  authority = {},
} = {}) {
  const rows = packages
    .map(
      (p) =>
        `<article class="panel"><span class="eyebrow">${p.status === 'active' ? 'Available package' : 'Retired package'}</span><h2>${h(p.name)}</h2><div class="profile-grid"><div class="profile-field"><span>Upfront payment</span><strong>R${h(p.package_price)}</strong></div><div class="profile-field"><span>Treatments</span><strong>${h(p.sessions_included)} × ${h(p.duration_minutes)} min slots</strong></div><div class="profile-field"><span>From first treatment</span><strong>${h(validity(p))}</strong></div></div><details><summary>Edit package</summary><form data-package-edit data-id="${h(p.id)}" data-revision="${h(p.revision)}">${fields(p)}<button data-workspace-action="primary" class="button primary" type="submit">Save package</button><p class="small">Existing purchases keep their original price, treatment count and validity.</p></form></details><a data-workspace-action="secondary" class="button" href="/calendar/services/${h(p.session_service_id)}">Practitioners &amp; duration</a><button class="button ${p.status === 'active' ? 'danger' : ''}" type="button" data-package-status="${p.status === 'active' ? 'delete' : 'restore'}" data-id="${h(p.id)}" data-revision="${h(p.revision)}" data-workspace-action="${p.status === 'active' ? 'danger' : 'secondary'}">${p.status === 'active' ? 'Delete package' : 'Restore package'}</button></article>`,
    )
    .join('');
  const create = createOptions
    ? `<details class="panel" id="new-package"><summary>Create a package</summary><form data-package-create>${fields()}<div class="edit-grid"><label class="field">Calendar slot (minutes)<input name="durationMinutes" type="number" min="1" max="1440" value="50" required></label><label class="field">Category<select aria-label="Category" name="categoryId" required><option value="">Choose category</option>${createOptions.categories.map((c) => `<option value="${h(c.id)}">${h(c.name)}</option>`).join('')}</select></label></div><fieldset><legend>Practitioners</legend>${createOptions.practitioners.map((p) => `<label class="check-field"><input type="checkbox" name="staffIds" value="${h(p.id)}">${h(p.displayName)}</label>`).join('')}</fieldset><p class="small">The full package is paid upfront. Its validity begins with the first treatment.</p><button data-workspace-action="create" class="button primary" type="submit">Create package</button></form></details>`
    : '';
  const purchase =
    authority.permissions?.['payment:collect'] === true &&
    authority.permissions?.['client:lookup'] === true
      ? `<section class="panel"><h2>Record a paid package</h2><p class="warning-copy">Use this after receiving the full upfront payment. This records the payment and makes the treatments available in My Shiloh.</p><form data-package-payment><div class="edit-grid"><label class="field">Package<select aria-label="Package" name="packageId" required><option value="">Choose package</option>${packages
          .filter((p) => p.status === 'active')
          .map(
            (p) =>
              `<option data-revision="${h(p.revision)}" value="${h(p.id)}">${h(p.name)} · R${h(p.package_price)}</option>`,
          )
          .join(
            '',
          )}</select></label><div class="field wide"><label for="package-client-search">Find client</label><div class="assignment-form"><input id="package-client-search" type="search" placeholder="Client name or mobile"><button data-workspace-action="secondary" class="button" type="button" data-package-client-search>Search clients</button></div><label for="package-client-choice">Matching clients</label><select id="package-client-choice" name="crmV2ClientId" required><option value="">Search and choose a client</option></select></div><label class="field">Payment method<select aria-label="Payment method" name="paymentMethod"><option value="cash">Cash</option><option value="card_machine">Card machine</option><option value="manual_eft">EFT</option></select></label><label class="field">Receipt or payment reference<input name="paymentReference" maxlength="200" required></label></div><label class="check-field"><input name="paidConfirmed" type="checkbox" required>I confirm the full upfront amount has been received.</label><button data-workspace-action="primary" class="button primary" type="submit">Record payment &amp; add treatments</button></form></section>`
      : '';
  const balances = purchases
    .map(
      (e) =>
        `<article class="profile-field"><strong>${h(e.client_name)} · ${h(e.name)}</strong><p>${Math.max(0, e.sessions_total - e.booked - e.used)} available · ${e.booked} booked · ${e.used} used</p><span>${e.expires_at ? `Expires ${h(new Date(e.expires_at).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' }))}` : 'Validity begins with first treatment'}</span></article>`,
    )
    .join('');
  return `${shellStart({ title: 'Packages', subtitle: 'Create offers, record upfront payments and follow treatment balances.', displayName: authority.displayName, ...options, manageAllowed: true })}<main><nav class="detail-actions"><a data-workspace-action="secondary" class="button" href="/calendar/services">← Services</a>${createOptions ? '<a data-workspace-action="create" class="button" href="#new-package">Create package</a>' : ''}</nav><p role="status" aria-live="polite" class="status-message" data-package-message></p><style>details>summary{cursor:pointer;min-height:44px;padding:12px 0;font-weight:800}details form{padding:12px 0}fieldset{border:1px solid var(--line);border-radius:12px;margin:12px 0}.package-offers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.package-offers .profile-grid{grid-template-columns:1fr}.package-offers .button{margin-top:12px}@media(max-width:700px){.package-offers{grid-template-columns:1fr}}</style><section class="package-offers" aria-label="Package offers">${rows}</section>${create}${purchase}<section class="panel"><h2>Client treatment balances</h2><div class="staff-list">${balances || '<p class="muted">No client package purchases yet.</p>'}</div></section></main></div></div></div><script src="/calendar/services/packages/client.js" defer></script></body></html>`;
}
function packageClientScript() {
  return (
    phonePresentationClientScript() +
    workspaceErrorRecoveryClientScript() +
    confirmationClientScript() +
    `(()=>{'use strict';const api='/calendar/services/packages';const message=document.querySelector('[data-package-message]');const id=()=>crypto.randomUUID();async function json(r){const b=await r.json();if(!r.ok)throw new Error(b.error||'Please reload and try again.');return b;}async function post(path,payload){const token=await json(await fetch('/calendar/staff-auth/csrf',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));return json(await fetch(api+path,{method:'POST',headers:{'Content-Type':'application/json','x-shiloh-csrf-token':token.csrfToken},body:JSON.stringify(payload)}));}function data(form){const out=Object.fromEntries(new FormData(form));out.staffIds=Array.from(form.querySelectorAll('[name=staffIds]:checked')).map(n=>Number(n.value));return out;}async function save(form,path,extra={}){const button=form.querySelector('[type=submit]');button.disabled=true;try{await post(path,{...data(form),...extra,requestId:id()});location.reload();}catch(error){window.ShilohErrorRecovery.render(message,error,'error');message.scrollIntoView({block:'center'});}finally{button.disabled=false;}}
document.querySelectorAll('[data-package-edit]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();save(f,'/'+f.dataset.id+'/edit',{expectedRevision:f.dataset.revision});}));const create=document.querySelector('[data-package-create]');if(create)create.addEventListener('submit',e=>{e.preventDefault();save(create,'/create');});document.querySelectorAll('[data-package-status]').forEach(b=>b.addEventListener('click',async()=>{const action=b.dataset.packageStatus;if(!await window.ShilohConfirm({title:action==='delete'?'Delete this package?':'Restore this package?',copy:action==='delete'?'The offer will leave the catalogue. Existing paid packages remain usable. You can restore this offer later.':'The package will be offered for purchase again.',action:action==='delete'?'Delete package':'Restore package',cancel:'Cancel',danger:action==='delete'}))return;try{await post('/'+b.dataset.id+'/'+action,{expectedRevision:b.dataset.revision,requestId:id()});location.reload();}catch(error){window.ShilohErrorRecovery.render(message,error,'error');}}));
const payment=document.querySelector('[data-package-payment]');if(payment){payment.addEventListener('submit',async e=>{e.preventDefault();if(!await window.ShilohConfirm({title:'Record the full upfront payment?',copy:'This gives the selected client the package treatments and adds the payment to clinic receipts.',action:'Record paid package',cancel:'Check details',danger:false}))return;save(payment,'/paid',{paidConfirmed:payment.elements.paidConfirmed.checked,packageRevision:payment.elements.packageId.selectedOptions[0].dataset.revision});});document.querySelector('[data-package-client-search]').addEventListener('click',async()=>{try{const q=document.querySelector('#package-client-search').value.trim();if(q.length<2)throw new Error('Enter at least two letters or digits.');const b=await json(await fetch(api+'/clients?q='+encodeURIComponent(q)));const select=payment.elements.crmV2ClientId;select.replaceChildren(new Option('Choose client',''));b.clients.forEach(c=>select.add(new Option(c.name+' · '+displayPhone(c.mobile,''),c.id)));if(!b.clients.length)throw new Error('No matching clinic clients.');}catch(error){window.ShilohErrorRecovery.render(message,error,'error');}});}})();`
  );
}
function renderClientPackages(rows = []) {
  const cards = rows
    .map((p) => {
      const available = p.entitlement_id ? Math.max(0, p.sessions_total - p.booked - p.used) : 0;
      const expired = p.expires_at && new Date(p.expires_at) <= new Date();
      const book = available > 0 && !expired && p.entitlement_status === 'active';
      return `<article class="panel"><span class="eyebrow">${p.entitlement_id ? 'Your prepaid treatments' : 'Package offer'}</span><h2>${h(p.owned_name || p.name)}</h2><p>${h(p.entitlement_id ? p.purchase_description || `${p.sessions_total} prepaid treatments. Valid for ${validity({ validity_months: p.purchased_validity_months, validity_days: p.purchased_validity_days })} from your first treatment.` : p.customer_description || `${p.sessions_included} treatments, paid upfront. Valid for ${validity(p)} from your first treatment.`)}</p>${p.entitlement_id ? `<div class="profile-grid"><div class="profile-field"><span>Available</span><strong>${available}</strong></div><div class="profile-field"><span>Booked</span><strong>${p.booked}</strong></div><div class="profile-field"><span>Used</span><strong>${p.used}</strong></div></div><p>${expired ? 'Expired · ' : ''}${p.expires_at ? 'Valid until ' + h(new Date(p.expires_at).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' })) : 'Your validity period begins with your first treatment.'}</p>` : `<p><strong>R${h(p.package_price)} paid in full upfront</strong></p><p>Contact Reception to purchase this package. It will appear here once payment has been recorded.</p>`}${book ? `<a class="button primary" href="/my-shiloh/book?packageService=${h(p.session_service_id)}">Book a package treatment</a>` : ''}</article>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My packages · My Shiloh</title><style>${styles()} .shell{max-width:820px}</style></head><body><main class="shell"><nav class="detail-actions"><a class="button" href="/my-shiloh/">← My Shiloh</a></nav><h1>My packages</h1><p class="muted">Your prepaid treatments and remaining balances.</p>${cards || '<section class="panel"><p>No packages are available at the moment.</p></section>'}</main></body></html>`;
}
module.exports = { renderWorkspacePackages, packageClientScript, renderClientPackages, validity };
