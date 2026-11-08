const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { requestReturn, groupRequestPanel, groupRequestClientSupport } = require('../src/presentation/groupPlanningBookingUx');
const { renderCalendarGroupBookingPage, calendarGroupBookingClientScript } = require('../src/presentation/calendarGroupBookingUx');
const context = { requestId: 42, revision: 'request-v1', organiser: { clientId: 201, name: 'Synthetic <Organiser>', mobile: '27810000201' }, serviceDetail: '<script>alert(1)</script>', guestCount: 12, preferredDate: '2099-10-24', preferredDaypart: 'morning', occasionNote: '<occasion>', clientNote: '<note>', returnTo: 'https://example.invalid/unsafe' };
test('return target derives solely from the verified positive safe request ID', () => {
  assert.equal(requestReturn(context), '/calendar/workspace#planning-request-42');
  for (const requestId of [0, -1, '01', '1#evil', 'https://example.invalid', '9007199254740992', null]) assert.equal(requestReturn({ requestId }), null);
});
test('contact panel escapes request text and distinguishes organiser from actual attendance', () => {
  const html = groupRequestPanel(context);
  assert.match(html, /Synthetic &lt;Organiser&gt;/); assert.doesNotMatch(html, /<script>|<occasion>|<note>/);
  assert.match(html, /not automatically a guest/); assert.match(html, /3–10 guests/); assert.match(html, /About 12 guests requested/);
  assert.match(html, /data-organiser-id value="201"/); assert.doesNotMatch(html, /group-organiser-search/);
});
test('linked form keeps three blank actual guests, editable date and explicit safe return', () => {
  const html = renderCalendarGroupBookingPage({ options: { requestContext: context, guestBooking: { available: true }, services: [], staff: [] }, prefill: { date: context.preferredDate } });
  assert.match(html, /data-group-request-return href="\/calendar\/workspace#planning-request-42"/);
  assert.equal((html.match(/data-guest="[123]"/g) || []).length, 3);
  assert.match(html, /id="group-date" type="date" value="2099-10-24" required/);
  assert.match(html, /id="group-time" type="time" step="300" value="" required/);
  assert.doesNotMatch(html, /data-name[^>]*value=|data-client-id[^>]*value=|data-service[^>]*value=/);
  assert.doesNotMatch(html, /id="group-organiser-search"/);
});
test('request client payload uses request revision and canonical contact; mismatched review fails closed', () => {
  const listeners = {};
  const sandbox = { OPTIONS: { requestContext: context }, document: { addEventListener: (event, handler) => { listeners[event] = handler; } }, window: { addEventListener() {} }, Number, row: (label, value) => ({ label, value }), displayPhone: value => value, guestReviewKey: null };
  vm.createContext(sandbox); vm.runInContext(groupRequestClientSupport(), sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.groupRequestPayload())), { planningRequestId: 42, planningRequestRevision: 'request-v1', organiserClientId: 201 });
  assert.throws(() => sandbox.showGroupRequestReview({ requestContext: { ...context, requestId: 43 } }, { prepend() {} }), /enquiry review changed/);
  const rows = []; sandbox.showGroupRequestReview({ requestContext: context, requestReviewKey: 'synthetic_review_key_12345678901' }, { prepend: (...items) => rows.push(...items) });
  assert.equal(sandbox.guestReviewKey, 'synthetic_review_key_12345678901');
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.groupRequestDiscardPayload())), { planningRequestId: 42, requestDraftKey: 'synthetic_review_key_12345678901' });
  sandbox.guestReviewKey = null;
  assert.equal(sandbox.groupRequestDiscardPayload().requestDraftKey, 'synthetic_review_key_12345678901'); assert.equal(rows[0].label, 'Enquiry contact');
});
test('production client script compiles with enquiry recovery support', () => { assert.doesNotThrow(() => new vm.Script(calendarGroupBookingClientScript())); });
