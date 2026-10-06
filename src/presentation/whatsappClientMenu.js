'use strict';

const MY_SHILOH_WELCOME_VOUCHER_URL = 'https://app.shilohmtc.co.za/my-shiloh/#welcome-voucher';
const MY_SHILOH_URL = 'https://app.shilohmtc.co.za/my-shiloh/';
const MY_SHILOH_WEBSITE_PROMPT = 'Hi Shiloh, tell me about My Shiloh';

function clientHomeInteractive() {
  return {
    type: 'button',
    body: '*Shiloh 🌿*\nHow can I help you today?\n\nMy Shiloh keeps your bookings, appointment details and Wallet together.',
    buttons: [
      { id: 'client_my_shiloh', title: 'Open My Shiloh' },
      { id: 'client_browse_services', title: 'Browse services' },
      { id: 'client_book_now', title: 'Book now' },
    ],
  };
}

function welcomeVoucherReply() {
  return [
    '*The welcome voucher offer has ended*',
    '',
    'No new welcome vouchers are being issued. If you already have one, open your My Shiloh Wallet to see its status and original terms.',
    '',
    MY_SHILOH_WELCOME_VOUCHER_URL,
  ].join('\n');
}

function myShilohAwarenessReply() {
  return [
    '*Meet My Shiloh 🌿*',
    '',
    'Keep your Shiloh bookings, latest appointment details and Wallet together in one easy place. Add My Shiloh to your phone, sign in with a passkey or set one up using an SMS code, and turn on notifications if you would like appointment alerts.',
    '',
    'For birthday wishes, reply BIRTHDAY ON here on WhatsApp. You can switch them off with BIRTHDAY OFF. 🎂',
    '',
    MY_SHILOH_URL,
    '',
    'Need a person? Reception is here for you on 066 239 9138.',
  ].join('\n');
}

module.exports = { MY_SHILOH_URL, MY_SHILOH_WEBSITE_PROMPT, MY_SHILOH_WELCOME_VOUCHER_URL, clientHomeInteractive, welcomeVoucherReply, myShilohAwarenessReply };
