'use strict';
const { pool } = require('../db/pool');
const calendar = require('./calendarReadOnlyUx');
const { createBookingPaymentService } = require('./bookingPayments');
const { createWorkspaceFormsService } = require('./workspaceForms');
const { createWorkspaceAppointmentNotesService } = require('./workspaceAppointmentNotes');
const clients = require('./workspaceClients');
const clientReader = require('./crmReadService');
const { displayPhone } = require('../presentation/southAfricanPhone');
const { formatRand } = require('../presentation/currency');

function failure(code, status = 503) {
  return Object.assign(new Error('Appointment details are unavailable. Refresh Calendar and try again.'), { code, httpStatus: status });
}
function revision(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}
const unavailable = label => ({ available: false, label });

function createCalendarAppointmentDetailsService({
  db = pool, buildModel = calendar.buildModel,
  payments = createBookingPaymentService({ db }), forms = createWorkspaceFormsService({ db }),
  notes = createWorkspaceAppointmentNotesService({ db }), clientAccess = clients, readClient = clientReader.getClient,
} = {}) {
  async function formStatus(adminId, appointment) {
    const authority = await forms.resolveAccess(adminId);
    if (!authority || (authority.formScope === 'own_staff' && !(appointment.staffIds || []).map(Number).includes(Number(authority.linkedStaffId)))) {
      return unavailable('Form status unavailable');
    }
    const queue = await forms.listTreatmentQueue({ adminId, appointmentId: appointment.id });
    const item = queue.appointments.find(row => Number(row.id) === Number(appointment.id));
    return item
      ? { available: true, label: item.readiness.label, required: item.readiness.required, outstanding: item.readiness.outstanding }
      : { available: true, label: 'No required forms listed', required: 0, outstanding: 0 };
  }
  async function contact(adminId, identity) {
    const authority = await clientAccess.requireAccess(adminId);
    if (!identity.crm_v2_client_id) return unavailable('Contact details unavailable');
    // Resolve this appointment's exact client through the current relationship scope.
    // Never fall back to a payer, first group member, display-name match or phone guess.
    const client = await readClient(identity.crm_v2_client_id, { scope: authority.clientScope });
    const mobile = String(client?.normalized_mobile || '').trim();
    if (!client || !/^27[678]\d{8}$/.test(mobile)) return unavailable('Contact details unavailable');
    return { available: true, name: String(client.name || 'Client'), displayPhone: displayPhone(mobile),
      callHref: `tel:+${mobile}`, whatsappHref: `https://wa.me/${mobile}` };
  }
  async function get({ adminId, viewer, appointmentId, view, date, staff } = {}) {
    if (!/^[1-9]\d*$/.test(String(appointmentId)) || !Number.isSafeInteger(Number(appointmentId))) throw failure('CALENDAR_DETAILS_INVALID_ID', 400);
    const id = Number(appointmentId);
    const model = await buildModel({ viewer, view, date, staff });
    const appointment = (model.authorizedTimeline || model.timeline)?.appointments?.find(item => Number(item.id) === id);
    if (!appointment) throw failure('CALENDAR_DETAILS_NOT_FOUND', 404);
    const expected = revision(appointment.revision);
    const row = (await db.query(`/* calendarAppointmentDetails:identity */
      SELECT crm_v2_client_id,updated_at FROM appointments WHERE id=$1`, [id])).rows[0];
    if (!expected || !row || revision(row.updated_at) !== expected) throw failure('CALENDAR_DETAILS_STALE', 409);
    const values = await Promise.allSettled([
      payments.getSummary({ adminId, appointmentId: id }), formStatus(adminId, appointment),
      notes.get({ adminId, appointmentId: id }).then(value => ({ available: true, present: Boolean(String(value.notes || '').trim()) })),
      contact(adminId, row),
    ]);
    const current = (await db.query('SELECT updated_at FROM appointments WHERE id=$1', [id])).rows[0];
    if (!current || revision(current.updated_at) !== expected) throw failure('CALENDAR_DETAILS_STALE', 409);
    const labels = ['Payment details unavailable', 'Form status unavailable', 'Booking notes unavailable', 'Contact details unavailable'];
    const projected = values.map((result, index) => result.status === 'fulfilled' ? result.value : unavailable(labels[index]));
    if (projected[0].available && projected[0].state === 'known') {
      projected[0] = /^\d+\.\d{2}$/.test(String(projected[0].outstanding))
        ? { ...projected[0], label: `${formatRand(projected[0].outstanding)} outstanding` }
        : unavailable(labels[0]);
    }
    return { appointmentId: id, payment: projected[0], forms: projected[1], notes: projected[2], contact: projected[3],
      sharedBooking: Boolean(appointment.appointmentGroupId) };
  }
  return { get };
}
module.exports = { createCalendarAppointmentDetailsService };
