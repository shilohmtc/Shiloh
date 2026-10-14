'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {waiverFixture}=require('../stories/fixtures/bookingDepositWaiverPresentation');
const {renderCalendarPaymentPage}=require('../src/presentation/calendarPaymentsUx');
const {paymentPosition}=require('../src/services/myShilohExperienceOrchestrator');
const {depositSettlementPosition,buildClientDepositPolicyNotice}=require('../src/services/bookingDepositPolicy');
test('waived status is distinct from actual payment; original requirement and treatment balance remain truthful',()=>{
 const model=waiverFixture({waived:true});const html=renderCalendarPaymentPage({model});assert.match(html,/Deposit waived/);assert.doesNotMatch(html,/Deposit paid|data-deposit-waiver-form|data-copy-link/);assert.match(html,/Balance to pay<\/small><strong>R1\u00a0400,00/);assert.match(html,/R50,00/);assert.equal(model.deposit.requirement.required_amount,'725.00');
 assert.deepEqual(depositSettlementPosition({state:'waived',required_amount:'725.00'},50),{satisfied:false,outstanding:'0.00'});const position=paymentPosition({depositState:'waived',state:'partially_paid',outstanding:'1400.00'});assert.equal(position.state,'partially_paid');assert.match(position.label,/Deposit waived.*R1400 outstanding/);assert.equal(position.actionPath,null);assert.match(buildClientDepositPolicyNotice({applicable:true,waived:true}),/waived/);
});
test('waiver form exposes explicit whole shared scope only to allowed current authority and escapes audit details',()=>{
 const model=waiverFixture({shared:true});let html=renderCalendarPaymentPage({model});assert.match(html,/Whole shared booking/);assert.match(html,/Synthetic Aloe/);assert.match(html,/Synthetic Fynbos/);assert.match(html,/maxlength="240"/);assert.match(html,/Waive deposit/);
 model.authority.canWaiveDeposit=false;html=renderCalendarPaymentPage({model});assert.doesNotMatch(html,/data-deposit-waiver-form/);
 const waived=waiverFixture({waived:true});waived.depositWaiverEvidence.reason='<script>unsafe</script>';waived.depositWaiverEvidence.actorName='<b>actor</b>';html=renderCalendarPaymentPage({model:waived});assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.match(html,/&lt;b&gt;actor&lt;\/b&gt;/);assert.doesNotMatch(html,/<script>unsafe/);
});
