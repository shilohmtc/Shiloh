const { renderLucideIcon } = require('./lucideIcons');

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
  return `(()=>{'use strict';
const ICONS=${icons};
function label(node){const existing=node.querySelector('.workspace-link-label');return existing?existing.textContent.trim():node.textContent.trim();}
function decorateDestination(node){const key=node.dataset.workspaceDestination;if(!ICONS[key]||node.querySelector('.workspace-nav-icon'))return;const text=label(node);node.innerHTML=ICONS[key]+'<span class="workspace-link-label">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';}
function decorateAccount(){const button=document.querySelector('[data-shiloh-logout]');if(!button||button.querySelector('.workspace-nav-icon'))return;const text=button.textContent.trim()||'Sign out';const key=/lock/i.test(text)?'lock':'logout';button.innerHTML=ICONS[key]+'<span class="workspace-link-label">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';}
function bookingTone(node){const kind=String(node.dataset.calendarBookingKind||'').toLowerCase();if(kind==='couples'||kind==='group')return kind;const text=String(node.textContent||'').trim().toLowerCase();if(text.includes('new appointment'))return'new';if(text.includes('record past appointment'))return'past';if(text==='block time'||node.dataset.calendarOperation==='add-block')return'block';if(text==='leave'||node.dataset.calendarOperation==='add-leave')return'leave';return'';}
function decorateBookingMenus(){document.querySelectorAll('.phone-plus-menu>summary,.desktop-create-menu>summary').forEach(summary=>{if(summary.dataset.bookingsPolished==='true')return;summary.dataset.bookingsPolished='true';summary.setAttribute('aria-label','Bookings');summary.innerHTML='<span>Bookings</span>';});document.querySelectorAll('.phone-plus-popover>a,.phone-plus-popover button,.desktop-create-popover>a,.desktop-create-popover>.lane>button,.desktop-create-submenu>summary').forEach(node=>{const tone=bookingTone(node);if(tone&&!node.dataset.calendarActionTone)node.dataset.calendarActionTone=tone;});}
function paint(){document.querySelectorAll('[data-workspace-destination]').forEach(decorateDestination);decorateAccount();decorateBookingMenus();}
const style=document.createElement('style');style.dataset.workspaceIconStyles='true';style.textContent='.workspace-nav-icon{width:18px;height:18px;flex:0 0 18px}.workspace-link-label{min-width:0}.workspace-account-signout{gap:8px}.workspace-link{gap:9px}.phone-plus-popover [data-calendar-action-tone="new"],.desktop-create-popover [data-calendar-action-tone="new"]{background:#eef5ef!important;color:#244f3a!important}.phone-plus-popover [data-calendar-action-tone="couples"],.desktop-create-popover [data-calendar-action-tone="couples"]{background:#fbf5f8!important;color:#633f55!important}.phone-plus-popover [data-calendar-action-tone="group"],.desktop-create-popover [data-calendar-action-tone="group"]{background:#eef4fb!important;color:#405b75!important}.phone-plus-popover [data-calendar-action-tone="past"],.desktop-create-popover [data-calendar-action-tone="past"]{background:#faf4e8!important;color:#6a5335!important}.phone-plus-popover [data-calendar-action-tone="block"],.desktop-create-popover [data-calendar-action-tone="block"]{background:#f0f3f2!important;color:#41564f!important}.phone-plus-popover [data-calendar-action-tone="leave"],.desktop-create-popover [data-calendar-action-tone="leave"]{background:#edf7f4!important;color:#2d5d53!important}.phone-plus-popover [data-calendar-action-tone="new"]:hover,.desktop-create-popover [data-calendar-action-tone="new"]:hover{background:#e1eee4!important}.phone-plus-popover [data-calendar-action-tone="couples"]:hover,.desktop-create-popover [data-calendar-action-tone="couples"]:hover{background:#f4e8ee!important}.phone-plus-popover [data-calendar-action-tone="group"]:hover,.desktop-create-popover [data-calendar-action-tone="group"]:hover{background:#e1ebf6!important}.phone-plus-popover [data-calendar-action-tone="past"]:hover,.desktop-create-popover [data-calendar-action-tone="past"]:hover{background:#f3e9d7!important}.phone-plus-popover [data-calendar-action-tone="block"]:hover,.desktop-create-popover [data-calendar-action-tone="block"]:hover{background:#e4eae7!important}.phone-plus-popover [data-calendar-action-tone="leave"]:hover,.desktop-create-popover [data-calendar-action-tone="leave"]:hover{background:#deefe9!important}@media(max-width:700px){.workspace-nav-icon{width:17px;height:17px;flex-basis:17px}}';document.head.appendChild(style);paint();
const root=document.body;if(root)new MutationObserver(()=>queueMicrotask(paint)).observe(root,{childList:true,subtree:true,characterData:true});
})();`;
}

module.exports = { workspaceIconClientScript };
