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
  if (payment.depositState === 'exempt') return { state: 'deposit_exempt', label: 'No deposit required', actionPath: null };
  if (payment.depositState === 'awaiting') {
    return {
      state: 'deposit_required',
      label: `${rand(payment.depositOutstanding) || rand(payment.depositRequired) || 'Deposit'} deposit required`,
      actionPath: payment.activePaymentPath || null,
      ratePercent: Number(payment.depositRatePercent || 0),
      freeNoticeHours: Number(payment.depositFreeNoticeHours || 0),
      partialNoticeHours: Number(payment.depositPartialNoticeHours || 0),
      partialForfeitPercent: Number(payment.depositPartialForfeitPercent || 0),
      lateForfeitPercent: Number(payment.depositLateForfeitPercent || 0),
    };
  }
  if (payment.state === 'paid') return { state: 'paid', label: 'Paid', actionPath: null };
  if (payment.depositState === 'satisfied' && payment.state === 'partially_paid') {
    return {
      state: 'deposit_paid',
      label: `Deposit paid · ${rand(payment.outstanding) || 'balance'} remaining`,
      actionPath: payment.activePaymentPath || null,
    };
  }
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
  const activeRequests = Array.isArray(context.activeRequests) ? context.activeRequests : context.activeRequest ? [context.activeRequest] : [];
  const request = activeRequests[0];
  const requestDisplay = appointmentDisplay(request);
  const proposalActive = request?.bookingRequestStatus === 'awaiting_client_confirmation'
    && request.proposedStartsAt && request.proposalExpiresAt
    && new Date(request.proposalExpiresAt).getTime() > new Date(context.generatedAt || Date.now()).getTime();
  const proposalDisplay = proposalActive ? appointmentDisplay({ ...request, startsAt: request.proposedStartsAt }) : null;

  let home;
  if (requestDisplay) {
    home = proposalDisplay ? {
      eyebrow: 'Your booking request',
      headline: 'Shiloh has offered another time.',
      summary: `The proposed ${requestDisplay.service} is for ${proposalDisplay.date} at ${proposalDisplay.time}. Please reply to the Shiloh message with your choice. This appointment is not confirmed yet.`,
      status: 'Awaiting your response',
      primaryAction: { kind: 'navigate', label: 'View request', href: '#bookings' },
    } : {
      eyebrow: 'Your booking request',
      headline: 'Shiloh is planning your request.',
      summary: `You requested ${requestDisplay.service} for ${requestDisplay.date} at ${requestDisplay.time}. Reception will review the arrangement before confirming it. This appointment is not confirmed yet.`,
      status: 'Requested',
      primaryAction: { kind: 'navigate', label: 'View request', href: '#bookings' },
    };
  } else if (!appointment) {
    home = {
      eyebrow: 'Your Shiloh',
      headline: `Ready when you are, ${name}.`,
      summary: 'There is no upcoming appointment linked to your secure client profile right now.',
      status: 'Ready',
      primaryAction: { kind: 'navigate', label: 'Book an appointment', href: '/my-shiloh/book' },
    };
  } else if (forms.state === 'action_required') {
    home = {
      eyebrow: 'Before your visit',
      headline: 'There is one thing to take care of.',
      summary: `${forms.label} before your ${appointment.service} on ${appointment.date} at ${appointment.time}.`,
      status: 'Action needed',
      primaryAction: { kind: 'shiloh', label: 'Ask Shiloh about my form', href: '#shiloh' },
    };
  } else if (payment.state === 'deposit_required' && !payment.actionPath) {
    home = {
      eyebrow: 'Before your visit',
      headline: 'Your booking is awaiting its deposit.',
      summary: `${appointment.service} is held for ${appointment.date} at ${appointment.time}. Your secure payment link is not available yet. Ask Shiloh for help with the deposit before your visit.`,
      status: 'Deposit',
      primaryAction: { kind: 'shiloh', label: 'Ask Shiloh about my deposit', href: '#shiloh' },
    };
  } else if (payment.actionPath) {
    const depositRequired = payment.state === 'deposit_required';
    home = {
      eyebrow: 'Before your visit',
      headline: depositRequired ? 'Your booking is awaiting its deposit.' : 'Your booking is nearly ready.',
      summary: depositRequired
        ? `${appointment.service} is held for ${appointment.date} at ${appointment.time}. Pay the ${payment.ratePercent}% booking deposit to secure it. ${payment.freeNoticeHours}+ hours notice has no cancellation penalty; ${payment.partialNoticeHours}–${payment.freeNoticeHours} hours may forfeit ${payment.partialForfeitPercent}% of the deposit; under ${payment.partialNoticeHours} hours or a no-show may forfeit ${payment.lateForfeitPercent}%.`
        : `${appointment.service} is booked for ${appointment.date} at ${appointment.time}. A secure payment option is available.`,
      status: depositRequired ? 'Deposit' : 'Payment',
      primaryAction: { kind: 'navigate', label: depositRequired ? 'Pay deposit' : 'Open payment', href: payment.actionPath },
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

  const prompts = requestDisplay
    ? ['What is the status of my request?', 'Can I change my requested time?', 'When will Shiloh confirm my appointment?', 'Can I speak to Reception?']
    : appointment
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
      facts: requestDisplay ? [
          {
            key: 'appointment', label: 'Booking request', value: home.status,
            href: '#bookings', message: 'Your request is waiting for the next planning step.',
          },
          { key: 'forms', label: 'Forms', value: 'Nothing to do yet', href: null, message: 'Shiloh will let you know if a form is needed.' },
          { key: 'payment', label: 'Payment', value: 'No action yet', href: null, message: 'No payment action is due from this request yet.' },
        ] : appointment
        ? [
          {
            key: 'appointment',
            label: 'Appointment',
            value: `${appointment.date} · ${appointment.time}`,
            href: '#bookings',
            message: 'Open your Bookings tab to see the appointment details.',
          },
          forms.state === 'action_required'
            ? {
              key: 'forms',
              label: 'Forms',
              value: forms.label,
              href: '/my-shiloh/forms/complete',
              message: 'Open your waiting consultation form.',
            }
            : {
              key: 'forms',
              label: 'Forms',
              value: forms.label,
              href: null,
              message: forms.state === 'complete'
                ? 'Your consultation forms are complete.'
                : 'Nothing waiting right now.',
            },
          payment.actionPath
            ? {
              key: 'payment',
              label: 'Payment',
              value: payment.label,
              href: payment.actionPath,
              message: 'Open your secure payment.',
            }
            : {
              key: 'payment',
              label: 'Payment',
              value: payment.label,
              href: null,
              message: payment.state === 'paid'
                ? 'Your payment is recorded as paid.'
                : 'There is no payment action waiting right now.',
            },
        ]
        : [
          {
            key: 'appointment',
            label: 'Appointment',
            value: 'None upcoming',
            href: '#bookings',
            message: 'Open Bookings to start a new appointment.',
          },
          {
            key: 'forms',
            label: 'Forms',
            value: 'Nothing waiting',
            href: null,
            message: 'Nothing waiting right now.',
          },
          {
            key: 'payment',
            label: 'Payment',
            value: 'No active booking',
            href: null,
            message: 'There is no payment action waiting right now.',
          },
        ],
    },
    bookings: {
      upcoming: requestDisplay ? [
        ...activeRequests.map(item => {
          const requested = appointmentDisplay(item);
          const activeProposal = item.bookingRequestStatus === 'awaiting_client_confirmation'
            && item.proposedStartsAt && item.proposalExpiresAt
            && new Date(item.proposalExpiresAt).getTime() > new Date(context.generatedAt || Date.now()).getTime();
          const offered = activeProposal ? appointmentDisplay({ ...item, startsAt: item.proposedStartsAt }) : null;
          return {
            id: item.id, service: requested?.service || 'Shiloh appointment',
            practitioner: requested?.practitioner || 'Shiloh',
            date: offered?.date || requested?.date,
            time: offered?.time || requested?.time,
            status: offered ? 'Awaiting your response' : 'Requested',
            nextAction: offered
              ? 'Reply to the Shiloh message about the proposed time. Reception will confirm the appointment after your response.'
              : 'Reception is reviewing your request. The appointment has not been confirmed.',
          };
        }),
        ...(appointment && !activeRequests.some(item => item.id === context.nextAppointment.id) ? [{
          id: context.nextAppointment.id, service: appointment.service, practitioner: appointment.practitioner,
          date: appointment.date, time: appointment.time,
          status: context.nextAppointment.status,
          nextAction: payment.state === 'deposit_required' ? payment.label : 'Your appointment details are available here.',
        }] : []),
      ] : appointment ? [{
        id: context.nextAppointment.id,
        service: appointment.service,
        practitioner: appointment.practitioner,
        date: appointment.date,
        time: appointment.time,
        status: context.nextAppointment.status,
        nextAction: payment.state === 'deposit_required' ? payment.label : 'Your appointment details are available here.',
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
