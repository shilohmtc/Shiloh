'use strict';

const clientContext = require('./myShilohClientContext');

function firstName(value = '') {
  return String(value || '').trim().split(/\s+/)[0] || 'there';
}

function rand(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `R${amount.toFixed(2).replace(/\.00$/, '')}` : null;
}

function appointmentDisplay(appointment) {
  if (!appointment?.startsAt) return null;
  const start = new Date(appointment.startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const date = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(start);
  const time = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(start);
  return {
    date,
    time,
    service: appointment.services?.join(' + ') || 'Shiloh appointment',
    practitioner: appointment.practitioners?.join(' + ') || 'Shiloh',
  };
}

function formPosition(forms = []) {
  const required = forms.filter(item => item.actionRequired === true);
  if (required.length) {
    return {
      state: 'action_required',
      label: required.length === 1 ? '1 form waiting' : `${required.length} forms waiting`,
      titles: required.map(item => item.title),
    };
  }
  if (forms.length) {
    return {
      state: 'complete',
      label: 'Complete',
      titles: forms.map(item => item.title),
    };
  }
  return { state: 'none', label: 'None required', titles: [] };
}

function paymentPosition(payment) {
  if (!payment) return { state: 'none', label: 'No payment position', actionPath: null };
  if (payment.state === 'paid') return { state: 'paid', label: 'Paid', actionPath: null };
  if (payment.state === 'partially_paid') {
    return {
      state: 'partially_paid',
      label: `${rand(payment.outstanding) || 'Balance'} outstanding`,
      actionPath: payment.activePaymentPath || null,
    };
  }
  if (payment.activePaymentPath) {
    return {
      state: 'payment_link_available',
      label: `${rand(payment.outstanding) || 'Payment'} available`,
      actionPath: payment.activePaymentPath,
    };
  }
  if (payment.state === 'not_recorded' || payment.state === 'unpaid') {
    return { state: 'not_recorded', label: 'No payment recorded', actionPath: null };
  }
  if (payment.state === 'partially_refunded') return { state: 'partially_refunded', label: 'Partially refunded', actionPath: null };
  if (payment.state === 'overpaid') return { state: 'overpaid', label: 'Payment review', actionPath: null };
  return { state: 'unknown', label: 'Payment status unavailable', actionPath: null };
}

function buildClientExperience(context) {
  if (!context?.client) return null;
  const name = firstName(context.client.name);
  const appointment = appointmentDisplay(context.nextAppointment);
  const forms = formPosition(context.forms);
  const payment = paymentPosition(context.payment);

  let home;
  if (!appointment) {
    home = {
      eyebrow: 'Your Shiloh',
      headline: `Ready when you are, ${name}.`,
      summary: 'There is no upcoming appointment linked to your secure client profile right now.',
      status: 'Ready',
      primaryAction: { kind: 'navigate', label: 'Book an appointment', href: '/book' },
    };
  } else if (forms.state === 'action_required') {
    home = {
      eyebrow: 'Before your visit',
      headline: 'There is one thing to take care of.',
      summary: `${forms.label} before your ${appointment.service} on ${appointment.date} at ${appointment.time}.`,
      status: 'Action needed',
      primaryAction: { kind: 'shiloh', label: 'Ask Shiloh about my form', href: '#shiloh' },
    };
  } else if (payment.actionPath) {
    home = {
      eyebrow: 'Before your visit',
      headline: 'Your booking is nearly ready.',
      summary: `${appointment.service} is booked for ${appointment.date} at ${appointment.time}. A secure payment option is available.`,
      status: 'Payment',
      primaryAction: { kind: 'navigate', label: 'Open payment', href: payment.actionPath },
    };
  } else {
    home = {
      eyebrow: 'Next visit',
      headline: `You're set for ${appointment.date}.`,
      summary: `${appointment.service} at ${appointment.time} with ${appointment.practitioner}.`,
      status: 'Upcoming',
      primaryAction: { kind: 'navigate', label: 'View booking', href: '#bookings' },
    };
  }

  const prompts = appointment
    ? [
      'What do I need before my appointment?',
      'Can I move my appointment?',
      forms.state === 'action_required' ? 'Help me with my consultation form.' : 'What is my appointment status?',
      payment.state === 'paid' ? 'Has my payment been received?' : 'What is my payment status?',
    ]
    : [
      'Help me choose a treatment.',
      'Find me an appointment.',
      'What would suit me?',
      'What should I know before my first visit?',
    ];

  return {
    version: 'my_shiloh_client_experience_v1',
    generatedAt: context.generatedAt,
    client: { firstName: name },
    home: {
      ...home,
      facts: appointment
        ? [
          { label: 'Appointment', value: `${appointment.date} · ${appointment.time}` },
          { label: 'Forms', value: forms.label },
          { label: 'Payment', value: payment.label },
        ]
        : [
          { label: 'Appointment', value: 'None upcoming' },
          { label: 'Forms', value: 'Nothing waiting' },
          { label: 'Payment', value: 'No active booking' },
        ],
    },
    bookings: {
      upcoming: appointment ? [{
        id: context.nextAppointment.id,
        service: appointment.service,
        practitioner: appointment.practitioner,
        date: appointment.date,
        time: appointment.time,
        status: context.nextAppointment.status,
        forms: forms.label,
        payment: payment.label,
      }] : [],
    },
    assistant: {
      prompts,
      contextReady: true,
    },
  };
}

function createMyShilohExperienceOrchestrator({
  contextService = clientContext,
} = {}) {
  if (!contextService || typeof contextService.getContext !== 'function') {
    throw new Error('My Shiloh client context service is required');
  }

  async function getExperience({ crmV2ClientId } = {}) {
    const context = await contextService.getContext({ crmV2ClientId });
    return context ? buildClientExperience(context) : null;
  }

  return { getExperience };
}

const service = createMyShilohExperienceOrchestrator();

module.exports = {
  firstName,
  rand,
  appointmentDisplay,
  formPosition,
  paymentPosition,
  buildClientExperience,
  createMyShilohExperienceOrchestrator,
  ...service,
};
