'use strict';
// Financial rows for the focused notification-delivery mocks. Native PostgreSQL
// and the payment-choice integration suite separately exercise these queries.
function callbackFinancialRows(sql,request){
 if(sql.startsWith('SELECT payment_request_id FROM payment_ledger_entries'))return {rows:[]};
 if(sql==='SELECT payment_account_id FROM payment_requests WHERE request_key=$1')return {rows:[{payment_account_id:request.payment_account_id}]};
 if(sql==='SELECT * FROM booking_payment_accounts WHERE id=$1 FOR UPDATE')return {rows:[{id:request.payment_account_id,canonical_amount_due:'250.00',currency:'ZAR'}]};
 if(sql.includes('received_today')&&sql.includes('FROM payment_ledger_entries'))return {rows:[{paid:'0.00',refunded:'0.00',prior_paid:'0.00',transferred_out:'0.00',received_today:'0.00',received_before:'0.00'}]};
 if(sql.includes('AS noncash_entries'))return {rows:[{amount:'0.00',treatment_amount:'0.00',gift_amount:'0.00',noncash_entries:[]}]};
 if(sql.includes('FROM booking_loyalty_allocations'))return {rows:[{amount:'0.00'}]};
 if(sql.startsWith('SELECT id,request_key,provider,')||sql.startsWith('SELECT id,entry_type,amount,'))return {rows:[]};
 return null;
}
module.exports={callbackFinancialRows};
