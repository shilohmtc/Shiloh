// Booking actions share Calendar's palette; treatment-family colours remain separate.
const BOOKING_ACTION_PALETTE = Object.freeze({
  new: { background: '#eef5ef', ink: '#244f3a', hover: '#e1eee4' },
  couples: { background: '#fbf5f8', ink: '#633f55', hover: '#f4e8ee' },
  group: { background: '#eef4fb', ink: '#405b75', hover: '#e1ebf6' },
  past: { background: '#faf4e8', ink: '#6a5335', hover: '#f3e9d7' },
  block: { background: '#f0f3f2', ink: '#41564f', hover: '#e4eae7' },
  leave: { background: '#edf7f4', ink: '#2d5d53', hover: '#deefe9' },
});

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
    const selectors = `[data-calendar-action-tone="${tone}"],${actions[tone]}`;
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
