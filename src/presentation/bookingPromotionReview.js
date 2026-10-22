'use strict';
function bookingPromotionReview({useOffer=true}={}) {
  return `<section class="notice" data-offer-price hidden aria-label="Booking price"><div class="review-grid"><div><small>Original treatment value</small><strong data-offer-subtotal></strong></div><div><small>Morning Welcome Offer saving</small><strong data-offer-saving></strong></div><div><small>Treatment total</small><strong data-offer-total></strong></div></div><label class="confirm-label" data-offer-choice-wrapper hidden><input type="checkbox" data-use-morning-offer${useOffer ? ' checked' : ''}><span>Use the Morning Welcome Offer. Only one promotional offer applies; purchased gift vouchers remain usable as payment.</span></label><p data-offer-help>Qualifying first-visit treatments starting from 08:00 and before 12:00 receive 20% off, excluding Saturdays.</p></section>`;
}
module.exports={bookingPromotionReview};
