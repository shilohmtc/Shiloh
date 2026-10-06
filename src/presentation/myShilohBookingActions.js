'use strict';
const { renderLucideIcon } = require('./lucideIcons');
const { escapeHtml } = require('./paymentPolicyUx');

function renderCouplesBookingChoice({ scope = 'bookings', hidden = false } = {}) {
  const descriptionId = `couples-booking-${escapeHtml(scope)}-description`;
  return `<div class="couples-booking-choice"${scope === 'home' ? ' data-client-home-couples' : ''}${hidden ? ' hidden' : ''}><a class="button button--soft" data-couples-booking-entry href="/my-shiloh/book?for=two" aria-describedby="${descriptionId}">${renderLucideIcon('couples', { size: 22 })}<span>Couples booking</span></a><small id="${descriptionId}">Book together with a partner, friend or family member.</small></div>`;
}

module.exports = { renderCouplesBookingChoice };
