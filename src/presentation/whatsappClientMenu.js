'use strict';

const MY_SHILOH_WELCOME_VOUCHER_URL = 'https://app.shilohmtc.co.za/my-shiloh/#welcome-voucher';

function clientHomeInteractive() {
  return {
    type: 'button',
    body: '*Shiloh 🌿*\nHow can I help you today?\n\n🎁 Install *My Shiloh* on your phone and complete your registration to unlock your once-off *R100 welcome voucher*.',
    buttons: [
      { id: 'client_welcome_voucher', title: 'Get R100 voucher' },
      { id: 'client_browse_services', title: 'Browse services' },
      { id: 'client_book_now', title: 'Book now' },
    ],
  };
}

function welcomeVoucherReply() {
  return [
    '🎁 *Get your R100 welcome voucher*',
    '',
    'Open My Shiloh, install it on your phone and complete your registration to unlock a once-off R100 voucher for a treatment of R450 or more.',
    '',
    MY_SHILOH_WELCOME_VOUCHER_URL,
  ].join('\n');
}

module.exports = { MY_SHILOH_WELCOME_VOUCHER_URL, clientHomeInteractive, welcomeVoucherReply };
