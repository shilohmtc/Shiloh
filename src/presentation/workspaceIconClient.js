const { renderLucideIcon } = require('./lucideIcons');
const { calendarBookingsMenuPolishClientScript } = require('./calendarBookingsMenuPolish');

function workspaceIconClientScript() {
  const icons = JSON.stringify({
    dashboard: renderLucideIcon('dashboard', { className: 'workspace-nav-icon', size: 18 }),
    calendar: renderLucideIcon('calendar', { className: 'workspace-nav-icon', size: 18 }),
    clients: renderLucideIcon('clients', { className: 'workspace-nav-icon', size: 18 }),
    messages: renderLucideIcon('messages', { className: 'workspace-nav-icon', size: 18 }),
    staff: renderLucideIcon('staff', { className: 'workspace-nav-icon', size: 18 }),
    services: renderLucideIcon('services', { className: 'workspace-nav-icon', size: 18 }),
    forms: renderLucideIcon('forms', { className: 'workspace-nav-icon', size: 18 }),
    problemReports: renderLucideIcon('problemReports', { className: 'workspace-nav-icon', size: 18 }),
    reports: renderLucideIcon('reports', { className: 'workspace-nav-icon', size: 18 }),
    clinicHours: renderLucideIcon('clinicHours', { className: 'workspace-nav-icon', size: 18 }),
    logout: renderLucideIcon('logout', { className: 'workspace-nav-icon', size: 18 }),
    refresh: renderLucideIcon('refresh', { className: 'workspace-nav-icon', size: 18 }),
    lock: renderLucideIcon('lock', { className: 'workspace-nav-icon', size: 18 }),
  });
  const iconScript = `(()=>{'use strict';
const ICONS=${icons};
function label(node){const existing=node.querySelector('.workspace-link-label');if(existing)return existing.textContent.trim();const copy=node.cloneNode(true);copy.querySelectorAll('.workspace-link-badge').forEach(badge=>badge.remove());return copy.textContent.trim();}
function decorateDestination(node){const key=node.dataset.workspaceDestination;if(!ICONS[key]||node.querySelector('.workspace-nav-icon'))return;const text=label(node),badge=node.querySelector('.workspace-link-badge');node.innerHTML=ICONS[key]+'<span class="workspace-link-label">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';if(badge)node.appendChild(badge);}
function decorateAccount(){for(const [selector,key]of [['[data-shiloh-logout]','logout'],['[data-workspace-refresh]','refresh'],['[data-workspace-passkey-security]','lock']]){const node=document.querySelector(selector);if(!node||node.querySelector('.workspace-nav-icon'))continue;const text=node.textContent.trim();node.innerHTML=ICONS[key==='logout'&&/lock/i.test(text)?'lock':key]+'<span class="workspace-link-label">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';}}
function paint(){document.querySelectorAll('[data-workspace-destination]').forEach(decorateDestination);decorateAccount();}
function ensureFormsDestination(){if(document.querySelector('[data-workspace-destination="forms"]'))return;fetch('/calendar/workspace/navigation',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}}).then(async response=>{if(!response.ok)return null;return response.json();}).then(data=>{const item=data?.forms;if(!item||item.allowed!==true||!item.href)return;const menu=document.querySelector('[data-workspace-more-menu]');if(!menu||document.querySelector('[data-workspace-destination="forms"]'))return;const active=location.pathname==='/calendar/forms'||location.pathname.startsWith('/calendar/forms/');const node=document.createElement(active?'span':'a');node.className='workspace-link'+(active?' active':'');node.dataset.workspaceDestination='forms';if(active)node.setAttribute('aria-current','page');else node.href=item.href;node.textContent='Forms';const problemReports=menu.querySelector('[data-workspace-destination="problemReports"]');const empty=menu.querySelector('.workspace-more-empty');menu.insertBefore(node,problemReports||empty||null);if(active){const more=document.querySelector('[data-workspace-more-toggle]');if(more)more.classList.add('active');}paint();}).catch(()=>{});}
const style=document.createElement('style');style.dataset.workspaceIconStyles='true';style.textContent='.workspace-nav-icon{width:18px;height:18px;flex:0 0 18px}.workspace-link-label{min-width:0}.workspace-account-signout{gap:8px}.workspace-link{gap:9px}@media(max-width:700px){.workspace-nav-icon{width:17px;height:17px;flex-basis:17px}}';document.head.appendChild(style);paint();ensureFormsDestination();
const nav=document.querySelector('[data-workspace-navigation-drawer]');if(nav)new MutationObserver(()=>queueMicrotask(paint)).observe(nav,{childList:true,subtree:true,characterData:true});
})();`;
  return `${iconScript}\n${calendarBookingsMenuPolishClientScript()}`;
}

module.exports = { workspaceIconClientScript };
