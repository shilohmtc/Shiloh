'use strict';

const clientContext = require('./myShilohClientContext');
const { authoritativeSlotsForIntent } = require('./clientBookingAvailability');

const TOOL_NAMES = Object.freeze({
  NEXT_APPOINTMENT: 'get_my_next_appointment',
  UPCOMING_BOOKINGS: 'get_my_upcoming_bookings',
  FORM_STATUS: 'get_my_form_status',
  PAYMENT_STATUS: 'get_my_payment_status',
  FIND_AVAILABLE_SLOTS: 'find_available_slots',
});

const READ_TOOL_DEFINITIONS = Object.freeze([
  {
    type: 'function',
    name: TOOL_NAMES.NEXT_APPOINTMENT,
    description: 'Get the authenticated client’s next canonical Shiloh appointment. Use this instead of guessing appointment details.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.UPCOMING_BOOKINGS,
    description: 'Get up to five upcoming canonical Shiloh bookings for the authenticated client.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.FORM_STATUS,
    description: 'Get consultation-form status for the authenticated client’s next appointment. This returns status only and never form answers.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.PAYMENT_STATUS,
    description: 'Get payment position for the authenticated client’s next appointment from Shiloh’s canonical payment authority.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: TOOL_NAMES.FIND_AVAILABLE_SLOTS,
    description: 'Check canonical client-bookable availability for a Shiloh service on an exact local date. This is read-only and never books a slot.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'The Shiloh treatment or service name requested by the client.',
        },
        date: {
          type: 'string',
          description: 'Exact local clinic date in YYYY-MM-DD format.',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        },
        practitioner: {
          type: ['string', 'null'],
          description: 'Exact requested client-bookable practitioner name, or null for any eligible practitioner.',
        },
        daypart: {
          type: ['string', 'null'],
          enum: ['morning', 'afternoon', 'evening', null],
          description: 'Optional local daypart filter.',
        },
      },
      required: ['service', 'date', 'practitioner', 'daypart'],
      additionalProperties: false,
    },
  },
]);

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function dateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function safeText(value, max = 120) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function publicAppointment(appointment) {
  if (!appointment) return null;
  return {
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: String(appointment.status || ''),
    services: Array.isArray(appointment.services) ? appointment.services.map(String).filter(Boolean) : [],
    practitioners: Array.isArray(appointment.practitioners) ? appointment.practitioners.map(String).filter(Boolean) : [],
  };
}

function publicPayment(payment) {
  if (!payment) return { state: 'none' };
  return {
    state: String(payment.state || 'unknown'),
    currency: String(payment.currency || 'ZAR'),
    amountDue: payment.amountDue == null ? null : String(payment.amountDue),
    paid: payment.paid == null ? null : String(payment.paid),
    refunded: payment.refunded == null ? null : String(payment.refunded),
    netPaid: payment.netPaid == null ? null : String(payment.netPaid),
    outstanding: payment.outstanding == null ? null : String(payment.outstanding),
    securePaymentAvailable: Boolean(payment.activePaymentPath),
  };
}

function createMyShilohReadTools({
  contextService = clientContext,
  availability = authoritativeSlotsForIntent,
  now = () => new Date(),
} = {}) {
  if (!contextService || typeof contextService.loadNextAppointment !== 'function') {
    throw new Error('My Shiloh client context service is required');
  }
  if (typeof availability !== 'function') throw new Error('Canonical client availability service is required');

  async function execute(name, args = {}, { crmV2ClientId } = {}) {
    const clientId = positiveId(crmV2ClientId);
    if (!clientId) return { ok: false, error: 'authenticated_client_unavailable' };

    if (name === TOOL_NAMES.NEXT_APPOINTMENT) {
      const appointment = await contextService.loadNextAppointment(clientId);
      return {
        ok: true,
        found: Boolean(appointment),
        appointment: publicAppointment(appointment),
      };
    }

    if (name === TOOL_NAMES.UPCOMING_BOOKINGS) {
      const appointments = await contextService.loadUpcomingAppointments(clientId, { limit: 5 });
      return {
        ok: true,
        count: appointments.length,
        bookings: appointments.map(publicAppointment),
      };
    }

    if (name === TOOL_NAMES.FORM_STATUS) {
      const appointment = await contextService.loadNextAppointment(clientId);
      if (!appointment) return { ok: true, appointmentFound: false, forms: [] };
      const forms = await contextService.loadForms(clientId, appointment.id);
      return {
        ok: true,
        appointmentFound: true,
        appointment: publicAppointment(appointment),
        forms: forms.map(form => ({
          title: String(form.title || 'Consultation form'),
          status: String(form.status || 'unknown'),
          actionRequired: form.actionRequired === true,
        })),
      };
    }

    if (name === TOOL_NAMES.PAYMENT_STATUS) {
      const appointment = await contextService.loadNextAppointment(clientId);
      if (!appointment) {
        return { ok: true, appointmentFound: false, payment: { state: 'none' } };
      }
      const payment = await contextService.loadPayment(appointment);
      return {
        ok: true,
        appointmentFound: true,
        appointment: publicAppointment(appointment),
        payment: publicPayment(payment),
      };
    }

    if (name === TOOL_NAMES.FIND_AVAILABLE_SLOTS) {
      const service = safeText(args.service);
      const date = dateOnly(args.date);
      const practitioner = args.practitioner == null ? null : safeText(args.practitioner, 80);
      const daypart = args.daypart == null ? null : String(args.daypart);
      if (!service || !date || ![null, 'morning', 'afternoon', 'evening'].includes(daypart)) {
        return { ok: false, error: 'invalid_availability_request' };
      }

      const result = await availability({
        service_text: service,
        preferred_date: date,
        preferred_time: null,
        therapist_text: practitioner || 'Any available therapist',
        service_verified: true,
        status: 'collecting',
      }, {
        daypart,
        now: now(),
      });

      const slots = Array.isArray(result.slots) ? result.slots : [];
      return {
        ok: true,
        status: String(result.status || 'unknown'),
        date,
        service: result.service?.name || service,
        requestedPractitioner: practitioner,
        daypart,
        slots: slots.slice(0, 8).map(slot => ({
          startsAt: new Date(slot.starts_at).toISOString(),
          endsAt: new Date(slot.ends_at).toISOString(),
          practitioner: String(slot.staff_name || ''),
        })),
        moreAvailable: slots.length > 8,
        readOnly: true,
      };
    }

    return { ok: false, error: 'unknown_tool' };
  }

  return {
    definitions: READ_TOOL_DEFINITIONS,
    execute,
  };
}

module.exports = {
  TOOL_NAMES,
  READ_TOOL_DEFINITIONS,
  positiveId,
  dateOnly,
  safeText,
  publicAppointment,
  publicPayment,
  createMyShilohReadTools,
};
