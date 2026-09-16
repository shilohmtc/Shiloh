const test=require('node:test');
const assert=require('node:assert/strict');
const {renderPaymentStatusPage}=require('../src/presentation/paymentStatusUx');

test('public payment status page is safe for a client without a Workspace session',()=>{const html=renderPaymentStatusPage({requestKey:'request_123',request:{amount:'20.00',state:'paid'}});assert.match(html,/Payment received/);assert.match(html,/do not need to pay again/);assert.doesNotMatch(html,/calendar\/payments\/appointments/);});
