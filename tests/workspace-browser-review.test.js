const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { renderMessagesPage } = require('../src/presentation/workspaceMessagesUx');
const { renderCalendarPage } = require('../src/presentation/calendarReadOnlyUx');
const { createWorkspaceReportsService } = require('../src/services/workspaceReports');
const { calendarModel, messagesModel } = require('../stories/fixtures/workspaceBrowserReview');
const { formatRand } = require('../src/presentation/currency');
const { parseDateKey } = require('../src/services/calendarReadOnlyUx');

test('Messages uses canonical clinic dates for database Date and offset timestamps, preserving appointment and return view', () => {
  for (const [input, expected] of [[new Date('2026-10-14T08:00:00Z'),'2026-10-14'],['2026-12-31T22:30:00Z','2027-01-01'],['2026-10-31T22:30:00Z','2026-11-01']]) {
    const html = renderMessagesPage(messagesModel(input));
    assert.match(html, new RegExp(`date=${expected}&amp;appointment=9101`));
    assert.match(html, /returnTo=%2Fcalendar%2Fmessages%3Fview%3Dattention/);
  }
  assert.doesNotMatch(renderMessagesPage(messagesModel('invalid')), /href="\/calendar\/read-only\?/);
  assert.throws(() => parseDateKey('Wed Oct 14'), /YYYY-MM-DD/);
});

test('approved Calendar retains hourly positioning and only accepts a bounded Messages return', () => {
  for (const empty of [true,false]) {
    const html = renderCalendarPage(calendarModel(empty), { bookingEnabled: true, approvedPhonePresentation: true, messagesReturnTo: '/calendar/messages?view=attention' });
    assert.match(html, /\.calendar-booking-slot\{position:absolute;top:var\(--slot-top\)/);
    assert.match(html, /--slot-top:720px/);
    assert.match(html, /Back to Messages/);
  }
  for (const path of ['https://example.com','//example.com','/calendar/clients','/calendar/messages?view=all&redirect=evil']) {
    assert.doesNotMatch(renderCalendarPage(calendarModel(), { messagesReturnTo:path }), /Back to Messages/);
  }
});

test('investigation reproduces legacy-only client mix: a completed CRM-linked visit is excluded without changing any counts', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE appointments(id bigint,client_id bigint,crm_v2_client_id bigint,starts_at timestamptz,status text);
      CREATE TABLE appointment_staff(appointment_id bigint,staff_id bigint);
      INSERT INTO appointments VALUES (1,NULL,12,'2026-10-13 08:00Z','completed');
      INSERT INTO appointment_staff VALUES (1,41);`);
    const service = createWorkspaceReportsService({ db });
    const period = { from:'2026-10-12T22:00:00Z',to:'2026-10-13T22:00:00Z',staffId:null };
    assert.deepEqual(await service.clientSummary(period), { uniqueClients:0,newClients:0,returningClients:0 });
    const visits = await db.query("SELECT COUNT(*)::int AS count FROM appointments WHERE status='completed'");
    assert.equal(visits.rows[0].count,1);
    await db.exec("INSERT INTO appointments VALUES (2,12,NULL,'2026-10-13 10:00Z','completed'); INSERT INTO appointment_staff VALUES (2,41);");
    assert.deepEqual(await service.clientSummary(period), { uniqueClients:1,newClients:1,returningClients:0 });
    assert.deepEqual(await service.clientSummary({...period,staffId:42}), { uniqueClients:0,newClients:0,returningClients:0 });
  } finally { await db.close(); }
});

test('generated Rand labels use the same fixed currency precision, including zero and corrections', () => {
  for (const value of [0,12.5,1000,-12.5]) assert.equal(formatRand(value),`R${value.toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
});

test('standalone payment context uses only authorized subject information and labels a selected group appointment', () => {
  const { renderCalendarPaymentPage } = require('../src/presentation/calendarPaymentsUx');
  const { paymentFixture } = require('./fixtures/bookingPaymentPresentation');
  const model = paymentFixture();
  model.subject.serviceName = 'Synthetic <treatment>';
  assert.match(renderCalendarPaymentPage({model}), /data-payment-booking-context>Synthetic Client · Synthetic &lt;treatment&gt;/);
  model.subject.groupId = 11;
  assert.match(renderCalendarPaymentPage({model}), /Selected appointment: Synthetic Client/);
  delete model.subject.clientName;
  const missingClient = renderCalendarPaymentPage({model});
  assert.match(missingClient, /data-payment-booking-context>Selected appointment: Synthetic &lt;treatment&gt;/);
  assert.doesNotMatch(missingClient.match(/data-payment-booking-context>([^<]*)/)[1], /undefined|0810000101/);
  delete model.subject.serviceName;
  assert.doesNotMatch(renderCalendarPaymentPage({model}), /data-payment-booking-context/);
});

test('calculated report values retain non-negative and missing-value presentation while financial correction values remain signed', () => {
  const { formatRand: reportValue } = require('../src/presentation/workspaceReportsUx');
  assert.equal(reportValue(-25), 'R0,00');
  assert.equal(reportValue(undefined), 'R0,00');
  assert.equal(reportValue('not recorded'), 'R0,00');
  assert.equal(reportValue(25.5), 'R25,50');
  const { financialOverview } = require('../src/presentation/workspaceFinancialReportsUx');
  const html=financialOverview({ financial:{current:{treatmentValue:0,completedCount:0,received:-25,voucherReceipts:0,refunds:0,netReceived:-25},outstanding:0,unpricedCount:0},period:{} });
  assert.match(html, /R-25,00/);
});
