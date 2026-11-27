'use strict';

const { createHmac } = require('node:crypto');
const { createWebhookRouter } = require('../routes/webhook');
const { createWhatsAppBookingContinuation } = require('./whatsAppBookingContinuation');
const { createWhatsAppBookingChoices } = require('./whatsAppBookingChoices');
const { createWhatsAppBookingChat } = require('./whatsAppBookingChat');
const { createWhatsAppBookingPilotAdmission } = require('./whatsAppBookingPilotAdmission');
const { createWhatsAppBookingSender } = require('./whatsAppBookingSender');
const { createWhatsAppBookingSubmission } = require('./whatsAppBookingSubmission');
const { createWhatsAppBookingRegistration } = require('./whatsAppBookingRegistration');
const { createWhatsAppBookingNativeReview } = require('./whatsAppBookingNativeReview');
const { createWhatsAppBookingIntake } = require('./whatsAppBookingIntake');

function createWhatsAppBookingPilot({
  enabled = false,
  nativeReviewEnabled = false,
  registrationFlowId,
  db,
  provider,
  providerSecret,
  recipient,
  maximumAttempts,
  key,
  fetchImpl,
  clock = Date.now,
  bookingService,
  receiveBooking,
  persistStatuses,
  bookingReady,
} = {}) {
  if (enabled !== true) return null;
  if (
    !providerSecret ||
    !Buffer.isBuffer(key) ||
    key.length !== 32 ||
    typeof fetchImpl !== 'function' ||
    !/^[0-9]{1,30}$/.test(provider?.phoneNumberId || '') ||
    !/^v[0-9]{1,3}\.[0-9]{1,2}$/.test(provider?.apiVersion || '') ||
    typeof provider.accessToken !== 'string' ||
    !/^[^\s]{1,4096}$/.test(provider.accessToken)
  ) {
    throw new TypeError('Booking pilot provider configuration is incomplete');
  }
  const derive = (purpose) =>
    createHmac('sha256', key)
      .update('booking-pilot:' + purpose)
      .digest();
  const actionSecret = derive('appointment-action');
  const admission = createWhatsAppBookingPilotAdmission({
    db,
    recipient,
    maximumAttempts,
    key: derive('admission'),
    clock,
  });
  const continuation = createWhatsAppBookingContinuation({
    key: derive('continuation'),
    db,
    service: bookingService,
    clock,
  });
  const choices = createWhatsAppBookingChoices({
    db,
    service: bookingService,
    continuation,
    clock,
  });
  const submit = createWhatsAppBookingSubmission({ continuation, actionSecret, db });
  const nativeReview =
    nativeReviewEnabled === true
      ? createWhatsAppBookingNativeReview({
          key: derive('native-review'),
          continuation,
          submit,
          clock,
        })
      : null;
  const bookingChat = createWhatsAppBookingChat({
    key: derive('chat'),
    choices,
    nativeReview,
    db,
    clock,
  });
  const registration =
    nativeReview && registrationFlowId
      ? createWhatsAppBookingRegistration({
          db,
          key: derive('registration'),
          flowId: registrationFlowId,
          chat: bookingChat,
          clock,
        })
      : null;
  const sender = createWhatsAppBookingSender({
    enabled: true,
    db,
    provider,
    fetchImpl,
    clock,
    chat: bookingChat,
    continuation,
    nativeReview,
    registration,
    fingerprintKey: derive('delivery'),
    authorizeDelivery: admission.authorizeDelivery,
  });
  return {
    webhookRouter: createWebhookRouter({
      booking: { providerSecret, actionSecret, phoneNumberId: provider.phoneNumberId },
      bookingChat,
      admission,
      registration,
      bookingReady,
      receiveBooking: receiveBooking ?? createWhatsAppBookingIntake({ db }),
      persistStatuses,
      receiveNativeReview:
        nativeReview &&
        ((raw, signature, configuration) =>
          nativeReview.receive(raw, signature, configuration, sender.deliverRequestButton)),
      ...sender,
    }),
    bookingBrowser: {
      continuation,
      bookingChat,
      submit,
      deliverRequestButton: sender.deliverRequestButton,
    },
  };
}

function prepareConfiguredBookingPilot({ env, db, fetchImpl, bookingReady }) {
  if (env.SHILOH_WHATSAPP_BOOKING_PILOT_ENABLED !== 'true') return null;
  const encodedKey = env.SHILOH_WHATSAPP_BOOKING_PILOT_KEY;
  return createWhatsAppBookingPilot({
    enabled: true,
    nativeReviewEnabled: env.SHILOH_WHATSAPP_BOOKING_NATIVE_REVIEW_ENABLED === 'true',
    registrationFlowId: env.SHILOH_WHATSAPP_BOOKING_REGISTRATION_FLOW_ID,
    db,
    fetchImpl,
    bookingReady,
    providerSecret: env.SHILOH_WHATSAPP_BOOKING_APP_SECRET,
    provider: {
      phoneNumberId: env.SHILOH_WHATSAPP_BOOKING_PHONE_ID,
      apiVersion: env.SHILOH_WHATSAPP_BOOKING_API_VERSION,
      accessToken: env.SHILOH_WHATSAPP_BOOKING_META_TOKEN,
    },
    recipient: env.SHILOH_WHATSAPP_BOOKING_PILOT_RECIPIENT,
    maximumAttempts: Number(env.SHILOH_WHATSAPP_BOOKING_PILOT_MAX_ATTEMPTS),
    key:
      typeof encodedKey === 'string' && /^[a-f0-9]{64}$/i.test(encodedKey)
        ? Buffer.from(encodedKey, 'hex')
        : null,
  });
}

module.exports = { createWhatsAppBookingPilot, prepareConfiguredBookingPilot };
