'use strict';

const MY_SHILOH_WELCOME_VOUCHER_URL = 'https://app.shilohmtc.co.za/my-shiloh/#welcome-voucher';
const MY_SHILOH_URL = 'https://app.shilohmtc.co.za/my-shiloh/';
const MY_SHILOH_WEBSITE_PROMPT = 'Hi Shiloh, tell me about My Shiloh';

function clientHomeInteractive() {
  return {
    type: 'button',
    body: '*Shiloh 🌿*\nHow can I help you today?\n\nMy Shiloh keeps your bookings, appointment details and Wallet together. Eligible first-time registrations can unlock a once-off *R100 welcome voucher*.',
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
    'Open My Shiloh, install it on your phone and complete your registration. If eligible, you can unlock a once-off R100 voucher for a treatment of R450 or more. Your Wallet will show your eligibility and terms.',
    '',
    MY_SHILOH_WELCOME_VOUCHER_URL,
  ].join('\n');
}

function myShilohAwarenessReply() {
  return [
    '*Meet My Shiloh 🌿*',
    '',
    'Keep your Shiloh bookings, latest appointment details and Wallet together in one easy place. Add My Shiloh to your phone, sign in with WhatsApp, and turn on notifications if you would like appointment alerts.',
    '',
    'Complete your registration to see whether you qualify for our once-off R100 welcome voucher for a treatment of R450 or more. For birthday wishes, reply BIRTHDAY ON here on WhatsApp. You can switch them off with BIRTHDAY OFF. 🎂',
    '',
    MY_SHILOH_URL,
    '',
    'Need a person? Reception is here for you on 066 239 9138.',
  ].join('\n');
}

module.exports = { MY_SHILOH_URL, MY_SHILOH_WEBSITE_PROMPT, MY_SHILOH_WELCOME_VOUCHER_URL, clientHomeInteractive, welcomeVoucherReply, myShilohAwarenessReply };
