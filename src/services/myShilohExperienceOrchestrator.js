'use strict';

const clientContext = require('./myShilohClientContext');
const { requiredFormsReadiness } = require('./consultationFormReadiness');

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
      label: required.length === 1 ? 'Form required' : `${required.length} forms required`,
      titles: required.map(item => item.title),
    };
  }
  if (forms.some(item => item.status === 'needs_review')) return { state: 'review', label: 'Form under review', titles: forms.map(item => item.title) };
  if (forms.length && forms.every(item => item.status === 'completed')) {
    return {
      state: 'complete',
      label: 'Forms completed',
      titles: forms.map(item => item.title),
    };
  }
  return { state: 'none', label: 'No form required', titles: [] };
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
  const pendingRescheduleRequests = Array.isArray(context.pendingRescheduleRequests) ? context.pendingRescheduleRequests : [];
  const pendingRescheduleCards = pendingRescheduleRequests.map(item => {
    const current = appointmentDisplay(item);
    const proposed = appointmentDisplay({ ...item, startsAt: item.proposedStartsAt });
    return {
      id: item.id, service: current?.service || 'Shiloh appointment',
      practitioner: current?.practitioner || 'Shiloh',
      date: current?.date, time: current?.time,
      status: 'Change requested',
      nextAction: proposed && current
        ? `You asked to move to ${proposed.date} at ${proposed.time}. Your current appointment remains at ${current.date} at ${current.time} until the change is approved.`
        : 'Your request to change the appointment is awaiting review. The current time remains unchanged.',
    };
  });
  const nextAppointmentChange = pendingRescheduleCards.find(item => item.id === context.nextAppointment?.id);
  const proposalActive = request?.bookingRequestStatus === 'awaiting_client_confirmation'
    && request.proposedStartsAt && request.proposalExpiresAt
    && new Date(request.proposalExpiresAt).getTime() > new Date(context.generatedAt || Date.now()).getTime();
  const proposalDisplay = proposalActive ? appointmentDisplay({ ...request, startsAt: request.proposedStartsAt }) : null;

  let home;
  if (requestDisplay) {
    home = proposalDisplay ? {
      eyebrow: 'Your booking request',
      headline: 'Shiloh has offered another time.',
      summary: `The proposed ${requestDisplay.service} is for ${proposalDisplay.date} at ${proposalDisplay.time}. Review the proposed time in Bookings and choose your response. This appointment is not confirmed yet.`,
      status: 'Awaiting your response',
      primaryAction: { kind: 'navigate', label: 'View request', href: '#bookings' },
    } : {
      eyebrow: 'Your booking request',
      headline: 'Your request is awaiting approval.',
      summary: `You requested ${requestDisplay.service} for ${requestDisplay.date} at ${requestDisplay.time}. Reception will review your request. This appointment is not confirmed yet. After approval, pay any required deposit to confirm.`,
      status: request.planningStartedAt ? 'Planning' : 'Requested',
      primaryAction: { kind: 'navigate', label: 'View request', href: '#bookings' },
    };
  } else if (nextAppointmentChange) {
    const change = nextAppointmentChange;
    home = {
      eyebrow: 'Your appointment',
      headline: 'Your time change is awaiting review.',
      summary: `${change.service}: ${change.nextAction}`,
      status: 'Change requested',
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
        ? `${appointment.service} is held for ${appointment.date} at ${appointment.time}.`
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
    : nextAppointmentChange
    ? ['What is the status of my time change?', 'Is my original appointment still booked?', 'Can I speak to Reception?', 'What do I need before my visit?']
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

  const experience = {
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
        ] : nextAppointmentChange ? [
          { key: 'appointment', label: 'Appointment', value: 'Change requested', href: '#bookings', message: 'Your current appointment remains unchanged while the request is reviewed.' },
          { key: 'forms', label: 'Forms', value: forms.label, href: forms.state === 'action_required' ? '/my-shiloh/forms/complete' : null, message: forms.state === 'action_required' ? 'Open your waiting consultation form.' : 'Nothing waiting right now.' },
          { key: 'payment', label: 'Payment', value: payment.label, href: payment.actionPath, message: 'Your existing booking payment position remains unchanged.' },
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
                : payment.state === 'deposit_required'
                  ? 'Your deposit is due, but the payment link is not ready. Please ask Shiloh for help.'
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
      history: (Array.isArray(context.declinedRequests) ? context.declinedRequests : []).map(item => {
        const requested = appointmentDisplay(item);
        return {
          id: item.id, service: requested?.service || 'Shiloh appointment',
          practitioner: requested?.practitioner || 'Shiloh',
          date: requested?.date, time: requested?.time,
          status: 'Could not accommodate',
          hidden: item.historyHidden !== false,
          canChangeVisibility: item.status === 'cancelled'
            && item.bookingRequestStatus === 'declined'
            && item.bookingRequestDecisionNote === 'workspace_cannot_accommodate',
          nextAction: 'This request was not booked. Ask Shiloh if you would like to find another time.',
        };
      }),
      upcoming: requestDisplay ? [
        ...activeRequests.map(item => {
          const requested = appointmentDisplay(item);
          const activeProposal = item.bookingRequestStatus === 'awaiting_client_confirmation'
            && item.proposedStartsAt && item.proposalExpiresAt
            && new Date(item.proposalExpiresAt).getTime() > new Date(context.generatedAt || Date.now()).getTime();
          const offered = activeProposal ? appointmentDisplay({ ...item, startsAt: item.proposedStartsAt }) : null;
          return {
            id: item.id, service: requested?.service || 'Shiloh appointment',
            practitioner: offered && item.proposedPractitioners?.length ? item.proposedPractitioners.join(' + ') : requested?.practitioner || 'Shiloh',
            proposal: offered && Number(item.proposalVersion) > 0 ? { version: Number(item.proposalVersion), expiresAt: item.proposalExpiresAt } : null,
            date: offered?.date || requested?.date,
            time: offered?.time || requested?.time,
            status: offered ? 'Awaiting your response' : item.planningStartedAt ? 'Planning' : 'Requested',
            nextAction: offered
              ? 'Review this proposed time before accepting. Availability and any required deposit will be checked again.'
              : 'Reception is reviewing your request. The appointment has not been confirmed. After approval, pay any required deposit to confirm.',
          };
        }),
        ...pendingRescheduleCards,
        ...(appointment && !activeRequests.some(item => item.id === context.nextAppointment.id) && !pendingRescheduleCards.some(item => item.id === context.nextAppointment.id) ? [{
          id: context.nextAppointment.id, service: appointment.service, practitioner: appointment.practitioner,
          date: appointment.date, time: appointment.time,
          status: context.nextAppointment.status,
          nextAction: payment.state === 'deposit_required' ? payment.label : 'Your appointment details are available here.',
          paymentHelpNeeded: payment.state === 'deposit_required' && !payment.actionPath,
        }] : []),
      ] : appointment ? [...(nextAppointmentChange ? [nextAppointmentChange] : [{
        id: context.nextAppointment.id,
        service: appointment.service,
        practitioner: appointment.practitioner,
        date: appointment.date,
        time: appointment.time,
        status: context.nextAppointment.status,
        nextAction: payment.state === 'deposit_required' ? payment.label : 'Your appointment details are available here.',
        paymentHelpNeeded: payment.state === 'deposit_required' && !payment.actionPath,
        forms: forms.label,
        payment: payment.label,
      }]), ...pendingRescheduleCards.filter(item => item.id !== context.nextAppointment.id)] : pendingRescheduleCards,
    },
    assistant: {
      prompts,
      contextReady: true,
    },
  };
  const shownIds = new Set(experience.bookings.upcoming.map(item => item.id));
  for (const item of context.upcomingAppointments || []) {
    if (shownIds.has(item.id)) continue;
    const display = appointmentDisplay(item);
    if (!display) continue;
    experience.bookings.upcoming.push({
      id: item.id, service: display.service, practitioner: display.practitioner,
      date: display.date, time: display.time, status: item.status,
      nextAction: 'Your appointment details are available here.',
    });
    shownIds.add(item.id);
  }
  const paymentEntries = Array.isArray(context.appointmentPayments) ? context.appointmentPayments : [];
  const paymentsByAppointment = new Map(paymentEntries.map(item => [item.appointmentId, item.payment]));
  if (context.nextAppointment && !paymentsByAppointment.has(context.nextAppointment.id)) {
    paymentsByAppointment.set(context.nextAppointment.id, context.payment);
  }
  const formsByAppointment = new Map((context.appointmentForms || []).map(item => [item.appointmentId, item.forms]));
  if (context.nextAppointment && !formsByAppointment.has(context.nextAppointment.id)) formsByAppointment.set(context.nextAppointment.id, context.forms || []);
  experience.home.forms = [];
  const seenAccounts = new Set();
  experience.home.payments = [];
  for (const booking of experience.bookings.upcoming) {
    if (['Requested', 'Planning', 'Awaiting your response'].includes(booking.status)) continue;
    const assignedForms = formsByAppointment.get(booking.id) || [];
    const formState = formPosition(assignedForms);
    booking.formReadiness = requiredFormsReadiness(assignedForms);
    booking.forms = formState.label;
    booking.formActions = assignedForms.filter(item => item.actionRequired && item.canComplete !== false && Number.isSafeInteger(item.id) && item.id > 0).map(item => ({
      title: item.title, href: `/my-shiloh/forms/complete?assignmentId=${item.id}`,
    }));
    for (const form of assignedForms.filter(item => item.actionRequired)) experience.home.forms.push({
      appointmentId: booking.id, service: booking.service, date: booking.date, time: booking.time,
      label: `Complete your ${booking.service} form`, title: form.title,
      message: 'Required before your treatment. Complete and sign your consultation form before your visit.',
      actionLabel: booking.formActions.some(item => item.href.endsWith(`assignmentId=${form.id}`)) ? 'Complete form' : 'Ask Shiloh for help',
      href: booking.formActions.find(item => item.href.endsWith(`assignmentId=${form.id}`))?.href || '#shiloh',
    });
    const raw = paymentsByAppointment.get(booking.id);
    booking.readiness = booking.status === 'confirmed' ? 'Confirmed' : 'Upcoming';
    if (!raw) continue;
    const position = paymentPosition(raw);
    booking.payment = position.label;
    booking.paymentState = position.state;
    booking.paymentActionLabel = position.state === 'deposit_required' ? `Pay ${rand(raw.depositOutstanding) || rand(raw.depositRequired) || ''} deposit`.replace('  ', ' ') : 'Open payment';
    if (position.state === 'deposit_required') booking.readiness = 'Deposit required';
    else if (raw.depositState === 'satisfied' || raw.depositState === 'exempt') booking.readiness = 'Confirmed';
    booking.readinessSummary = booking.readiness === 'Confirmed'
      ? `Booking confirmed${formState.state === 'complete' ? ' · Forms completed' : formState.state === 'action_required' ? ' · Form required before your visit' : ''}`
      : booking.readiness === 'Deposit required' ? 'Pay your deposit to confirm your booking.' : 'Your appointment details are available here.';
    booking.paymentPath = position.actionPath;
    booking.paymentHelpNeeded = position.state === 'deposit_required' && !position.actionPath;
    if (position.state === 'deposit_required') booking.nextAction = `${position.label}. Pay your deposit to confirm your booking.`;
    if (position.state !== 'deposit_required' && !position.actionPath) continue;
    const accountKey = raw.accountId || `appointment:${booking.id}`;
    booking.paymentAccountId = accountKey;
    if (seenAccounts.has(accountKey)) continue;
    seenAccounts.add(accountKey);
    experience.home.payments.push({
      appointmentId: booking.id, service: booking.service, date: booking.date, time: booking.time,
      label: position.label, paymentState: position.state,
      actionLabel: position.actionPath ? booking.paymentActionLabel : 'Ask Shiloh about my deposit',
      href: position.actionPath || '#shiloh',
      message: position.state === 'deposit_required'
        ? `Pay your deposit to confirm your booking.${position.actionPath ? '' : ' Your payment link is not ready. Please ask Shiloh for help.'}`
        : 'Open your secure payment.',
    });
  }
  for (const due of experience.home.payments) {
    const key = paymentsByAppointment.get(due.appointmentId)?.accountId;
    const members = key ? experience.bookings.upcoming.filter(item => item.paymentAccountId === key) : [];
    if (members.length > 1) {
      const depositDue = due.paymentState === 'deposit_required';
      due.service = `Combined ${depositDue ? 'deposit' : 'payment'}: ${members.map(item => item.service).join(' + ')}`;
      if (depositDue) due.message = 'Pay this combined deposit to confirm these bookings.';
    }
  }
  if (appointment && !requestDisplay && !nextAppointmentChange) {
    const next = experience.bookings.upcoming.find(item => item.id === context.nextAppointment.id);
    experience.home.eyebrow = 'Next visit';
    experience.home.headline = 'Your next appointment';
    experience.home.summary = `${appointment.service} · ${appointment.date} · ${appointment.time} · ${appointment.practitioner}`;
    experience.home.status = next?.readiness || 'Upcoming';
    experience.home.primaryAction = { kind: 'navigate', label: 'View booking', href: '#bookings' };
  }
  return experience;
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
