'use strict';

const context = require('./myShilohClientContext');
const { createMyShilohBookingService } = require('./myShilohBooking');
const { localAppointmentDisplay } = require('./myShilohClientActions');
const { publicPayment } = require('./myShilohReadTools');

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function createAssistantPreparation({ contextService = context, booking = createMyShilohBookingService() } = {}) {
  async function prepareBooking(args, clientId) {
    const services = await booking.catalogue();
    const matches = services.filter(item => item.name.toLowerCase() === text(args.service, 160).toLowerCase());
    if (matches.length !== 1) return { modelResult: { ok: false, error: 'service_unavailable', message: 'Ask Reception to help with this treatment.' }, clientAction: null };
    const service = matches[0];
    const current = await booking.practitioners({ serviceId: service.id, crmV2ClientId: clientId });
    const price = current.service.price;
    const knownPrice = price != null && price !== '' && Number.isFinite(Number(price)) && Number(price) >= 0 && current.service.variablePrice !== true;
    const serviceSummary = { name:String(current.service.name), price:knownPrice ? Number(price) : null,
      durationMinutes:current.service.durationMinutes == null ? null : Number(current.service.durationMinutes),
      prepaidPackage:current.service.prepaidPackage === true };
    if (!knownPrice) return {
      modelResult:{ok:true,prepared:true,service:serviceSummary,message:'Reception must confirm the price. No quote or booking has been made.'},
      clientAction:{type:'planning_request',title:'Ask Reception for a quote',detail:serviceSummary.name,
        note:'Reception will confirm the price and arrangement. Nothing is booked or charged.',label:'Review request',href:'/my-shiloh/request',draft:{serviceDetail:serviceSummary.name}},
    };
    const fragment = new URLSearchParams();
    if (args.practitioner) {
      const practitioners = current.practitioners.filter(item => item.name.toLowerCase() === text(args.practitioner, 80).toLowerCase());
      if (practitioners.length !== 1) return { modelResult: { ok: false, error: 'practitioner_unavailable', practitioners: current.practitioners.map(item => item.name) }, clientAction: null };
      if (args.startsAt) {
        if (!iso(args.startsAt)) return { modelResult: { ok: false, error: 'invalid_slot' }, clientAction: null };
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(args.startsAt));
        const result = await booking.slots({ serviceId: service.id, staffId: practitioners[0].id, date, crmV2ClientId: clientId });
        if (!(result.slots || []).some(item => Date.parse(item.startsAt) === Date.parse(args.startsAt))) {
          return { modelResult: { ok: false, error: 'slot_unavailable', message: 'Check current availability again and offer alternatives.' }, clientAction: null };
        }
        fragment.set('date', date); fragment.set('startsAt', args.startsAt);
      }
      fragment.set('practitioner', practitioners[0].name);
    } else if (args.startsAt) return { modelResult: { ok: false, error: 'practitioner_required' }, clientAction: null };
    return {
      modelResult: { ok: true, prepared: true, service: serviceSummary, message: 'Ready for client review in the existing booking flow. Nothing submitted or reserved.' },
      clientAction: { type: 'booking_request', title: 'Review your booking', detail: `${current.service.name} · ${serviceSummary.prepaidPackage ? 'Covered by your prepaid package' : `R${Number(price).toFixed(2)}`}`,
        note: 'Review current availability and terms, then send your request. Shiloh approval and any deposit still apply.',
        label: 'Continue booking', href: `/my-shiloh/book?${serviceSummary.prepaidPackage ? 'packageService' : 'service'}=${encodeURIComponent(service.id)}${fragment.size ? `#${fragment}` : ''}` },
    };
  }

  async function checklist(args, clientId) {
    const appointments = await contextService.loadUpcomingAppointments(clientId, { limit: 10 });
    const matches = args.appointmentStartsAt != null ? appointments.filter(item => item.startsAt === args.appointmentStartsAt) : appointments.slice(0, 1);
    if (matches.length !== 1) return { modelResult: { ok: false, error: 'choose_appointment' }, clientAction: null };
    const appointment = matches[0];
    const [forms, payment] = await Promise.all([contextService.loadForms(clientId, appointment.id), contextService.loadPayment(appointment)]);
    const when = localAppointmentDisplay(appointment.startsAt);
    const formStatus = forms.length ? forms.map(item => `${item.title}: ${item.status}`).join('; ') : 'No required forms listed.';
    const money = publicPayment(payment);
    const detail = [`${appointment.services.join(' + ')} · ${when.date} · ${when.time}`, formStatus,
      money.amountDue == null ? 'Payment position unavailable.' : `Treatment value R${money.amountDue}. Treatment remainder R${money.outstanding}.`,
      money.depositState === 'waived' ? 'Deposit waived; treatment remainder still applies.' : money.depositRequired == null ? 'Deposit status unavailable.' : `Deposit required R${money.depositRequired}; deposit remaining R${money.depositOutstanding}.`].join('\n');
    return { modelResult: { ok: true, forms: forms.map(item => ({ title:item.title, status:item.status })), payment:money, message:'Checklist ready. Open Bookings for existing secure form and payment actions.' },
      clientAction: { type:'visit_checklist', title:'Before your visit', detail, note:'Open Bookings for secure forms and payments. Keep private health answers in the consultation form.', label:'View my visit', href:'#bookings',
        links: [
          ...forms.filter(item => item.actionRequired && item.canComplete === true && Number.isSafeInteger(item.id) && item.id > 0).map(item => ({ label:`Complete ${item.title}`, href:`/my-shiloh/forms/complete?assignmentId=${item.id}` })),
          ...(/^\/pay\/[A-Za-z0-9_-]{8,100}$/.test(payment?.activePaymentPath || '') ? [{ label:'Open secure payment', href:payment.activePaymentPath }] : []),
        ] } };
  }
  return { prepareBooking, checklist };
}
module.exports = { createAssistantPreparation, iso };
