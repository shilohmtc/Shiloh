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
    reports: renderLucideIcon('reports', { className: 'workspace-nav-icon', size: 18 }),
    clinicHours: renderLucideIcon('clinicHours', { className: 'workspace-nav-icon', size: 18 }),
    logout: renderLucideIcon('logout', { className: 'workspace-nav-icon', size: 18 }),
    lock: renderLucideIcon('lock', { className: 'workspace-nav-icon', size: 18 }),
  });
  const iconScript = `(()=>{'use strict';
const ICONS=${icons};
function label(node){const existing=node.querySelector('.workspace-link-label');return existing?existing.textContent.trim():node.textContent.trim();}
function decorateDestination(node){const key=node.dataset.workspaceDestination;if(!ICONS[key]||node.querySelector('.workspace-nav-icon'))return;const text=label(node);node.innerHTML=ICONS[key]+'<span class="workspace-link-label">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';}
function decorateAccount(){const button=document.querySelector('[data-shiloh-logout]');if(!button||button.querySelector('.workspace-nav-icon'))return;const text=button.textContent.trim()||'Sign out';const key=/lock/i.test(text)?'lock':'logout';button.innerHTML=ICONS[key]+'<span class="workspace-link-label">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';}
function paint(){document.querySelectorAll('[data-workspace-destination]').forEach(decorateDestination);decorateAccount();}
const style=document.createElement('style');style.dataset.workspaceIconStyles='true';style.textContent='.workspace-nav-icon{width:18px;height:18px;flex:0 0 18px}.workspace-link-label{min-width:0}.workspace-account-signout{gap:8px}.workspace-link{gap:9px}@media(max-width:700px){.workspace-nav-icon{width:17px;height:17px;flex-basis:17px}}';document.head.appendChild(style);paint();
const nav=document.querySelector('[data-workspace-navigation-drawer]');if(nav)new MutationObserver(()=>queueMicrotask(paint)).observe(nav,{childList:true,subtree:true,characterData:true});
})();`;
  return `${iconScript}\n${calendarBookingsMenuPolishClientScript()}`;
}

module.exports = { workspaceIconClientScript };
