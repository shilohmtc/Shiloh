// Booking actions share Calendar's palette; treatment-family colours remain separate.
const { BOOKING_ACTION_PALETTE } = require('./shilohUxTokens');

function bookingActionStyles() {
  const actions = {
    new: '[data-review-booking],[data-create-booking],[data-review-multiple],[data-confirm-multiple]',
    couples: '[data-couples-booking-entry],[data-review-couples],[data-confirm-couples]',
    group: '[data-group-booking-entry],[data-review-group],[data-confirm-group]',
    past: '[data-review-past],[data-record-past],[data-add-past]',
    block: '[data-availability-form="block"] .availability-submit',
    leave: '[data-availability-form="leave"] .availability-submit',
  };
  return Object.entries(BOOKING_ACTION_PALETTE).map(([tone, colour]) => {
    // Match the compact menu's existing important rules, including Couples.
    const menu = `.phone-plus-popover>a[data-calendar-action-tone="${tone}"],.phone-plus-popover button[data-calendar-action-tone="${tone}"]`;
    const selectors = `[data-calendar-action-tone="${tone}"],${menu},${actions[tone]}`;
    const hover = selectors.split(',').map(selector => `${selector}:not(:disabled):hover`).join(',');
    return `${selectors}{background:${colour.background}!important;color:${colour.ink}!important}${hover}{background:${colour.hover}!important}`;
  }).join('');
}

function calendarBookingsMenuPolishClientScript() {
  return `(()=>{'use strict';
function bookingTone(node){const kind=String(node.dataset.calendarBookingKind||'').toLowerCase();if(kind==='couples'||kind==='group')return kind;if(kind==='multiple')return'new';const text=String(node.textContent||'').trim().toLowerCase();if(text.includes('new appointment'))return'new';if(text.includes('record past appointment'))return'past';if(text==='block time'||node.dataset.calendarOperation==='add-block')return'block';if(text==='leave'||node.dataset.calendarOperation==='add-leave')return'leave';return'';}
function polish(){document.querySelectorAll('.phone-plus-menu>summary,.desktop-create-menu>summary').forEach(summary=>{if(summary.dataset.bookingsPolished==='true')return;summary.dataset.bookingsPolished='true';summary.setAttribute('aria-label','Bookings');summary.innerHTML='<span>Bookings</span>';});document.querySelectorAll('.phone-plus-popover>a,.phone-plus-popover button,.desktop-create-popover>a,.desktop-create-popover>.lane>button,.desktop-create-submenu>summary').forEach(node=>{const tone=bookingTone(node);if(tone&&!node.dataset.calendarActionTone)node.dataset.calendarActionTone=tone;});}
const style=document.createElement('style');style.dataset.calendarBookingsMenuPolish='true';style.textContent=${JSON.stringify(bookingActionStyles())};document.head.appendChild(style);polish();
const root=document.body;if(root)new MutationObserver(()=>queueMicrotask(polish)).observe(root,{childList:true,subtree:true});
})();`;
}

module.exports = { BOOKING_ACTION_PALETTE, bookingActionStyles, calendarBookingsMenuPolishClientScript };
