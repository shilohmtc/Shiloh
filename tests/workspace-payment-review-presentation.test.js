const test = require('node:test');
const assert = require('node:assert/strict');
const { safePaymentReviewReturn, renderWorkspacePaymentReview } = require('../src/presentation/workspacePaymentReviewUx');
const { depositWaiverClientScript } = require('../src/presentation/bookingDepositWaiverUx');
const member = (id, date) => ({ appointmentId:id,clientName:'Synthetic <client>',serviceName:'Synthetic & treatment',startsAt:date,staffNames:['Synthetic staff'] });
test('review return is restricted to its own fixed route and bounded page/section', () => {
  for(const value of ['/calendar/workspace/payments','/calendar/workspace/payments?after=25#upcoming-deposits']) assert.equal(safePaymentReviewReturn(value),value);
  for(const value of ['//evil.test','https://evil.test','/calendar/workspace/payments\n','/calendar/workspace/payments?after=0','/calendar/workspace/payments?after=1&next=evil','/calendar/workspace/payments#other',[]]) assert.equal(safePaymentReviewReturn(value),null);
  assert.doesNotThrow(()=>new Function(depositWaiverClientScript()));
});
test('page preserves exact appointment/date context, distinct balances and shared deposits without duplicate cards', () => {
  const members=[member(2,'2026-12-02T10:00:00Z'),member(1,'2026-12-15T10:00:00Z')];
  const html=renderWorkspacePaymentReview({review:{state:'known',after:'10',items:[{appointmentId:1,groupId:7,members,state:'review',reason:'Booking outcomes need review'}]},deposits:{items:[{accountId:9,appointmentId:2,members:[members[0]],state:'partial',outstanding:100}]}});
  assert.equal((html.match(/data-payment-review-item/g)||[]).length,1);
  assert.doesNotMatch(html,/data-deposit-account/);
  assert.match(html,/This booking also has an upcoming deposit to review/);
  assert.match(html,/date=2026-12-15&amp;appointment=1/);
  assert.match(html,/returnReview=%2Fcalendar%2Fworkspace%2Fpayments%3Fafter%3D10/);
  assert.match(html,/Synthetic &lt;client&gt;/);
  assert.doesNotMatch(html,/R\s?100|Balance paid|Payment received/);
});
test('an unavailable, restricted or paginated-empty result never claims all payments are settled', () => {
  for(const review of [{state:'unavailable'},{state:'restricted'},{state:'known',items:[],after:'25',next:'50'}]) {
    const html=renderWorkspacePaymentReview({review});
    assert.doesNotMatch(html,/all paid|all settled|no outstanding payments/i);
    if(review.next)assert.match(html,/Review next bookings/);
  }
});

test('payment page keeps price-review navigation distinct from its validated return to the review list',()=>{
 const {renderCalendarPaymentPage}=require('../src/presentation/calendarPaymentsUx');
 const {paymentFixture}=require('./fixtures/bookingPaymentPresentation');
 const model=paymentFixture({paid:false});model.priceReview={currentAmountDue:'700.00',recordedAmountDue:'650.00'};
 const html=renderCalendarPaymentPage({model,returnReview:'/calendar/workspace/payments?after=25'});
 assert.match(html,/href="\/calendar\/workspace\/payments\?after=25">Back to payments/);
 const priceLink=html.match(/href="([^"]+)">Review appointment price/)[1];
 assert.match(priceLink,/^\/calendar\/read-only/);
 assert.doesNotMatch(priceLink,/workspace\/payments/);
 const unsafe=renderCalendarPaymentPage({model,returnReview:'https://evil.test/'});
 assert.doesNotMatch(unsafe,/evil\.test|data-payment-review-return/);
 assert.match(unsafe,/>Back to appointment<\/a>/);
});
