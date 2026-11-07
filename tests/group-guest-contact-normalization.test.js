const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeGuest,ensureDistinctGroupGuests}=require('../src/services/calendarGroupBooking');
test('absent guest mobiles require explicit intent and a reviewed-organiser path; ordinary normalization remains strict',()=>{
 const raw={name:'Synthetic guest',mobile:'',noMobile:true};
 assert.throws(()=>normalizeGuest(raw),{code:'GROUP_GUEST_CONTACT_REVIEW'});
 assert.throws(()=>normalizeGuest({...raw,noMobile:false},{allowNoMobile:true}),{code:'GROUP_INVALID_MOBILE'});
 assert.throws(()=>normalizeGuest({...raw,mobile:'0810000001'},{allowNoMobile:true}),{code:'GROUP_GUEST_CONTACT_REVIEW'});
 const guest=normalizeGuest(raw,{allowNoMobile:true});assert.equal(guest.mobile,null);assert.equal(guest.noMobile,true);assert.equal(guest.clientId,null);
 const direct=normalizeGuest({name:'Synthetic direct',mobile:'0810000001'});assert.equal(direct.mobile,'27810000001');assert.equal(Object.hasOwn(direct,'noMobile'),false);
});
test('multiple phoneless guests remain distinct; duplicate canonical IDs or recorded mobiles are still refused',()=>{
 const guest=n=>normalizeGuest({name:'Synthetic '+['Alpha','Beta','Gamma'][n-1],mobile:'',noMobile:true,clientId:n},{allowNoMobile:true});
 assert.doesNotThrow(()=>ensureDistinctGroupGuests([guest(1),guest(2),guest(3)]));
 assert.throws(()=>ensureDistinctGroupGuests([guest(1),guest(1),guest(3)]),{code:'GROUP_DUPLICATE_CLIENT'});
 const direct=normalizeGuest({name:'Synthetic direct',mobile:'0810000001'});
 assert.throws(()=>ensureDistinctGroupGuests([direct,direct,guest(3)]),{code:'GROUP_DUPLICATE_MOBILE'});
 assert.throws(()=>ensureDistinctGroupGuests([{mobile:null},{mobile:null},{mobile:null}]),{code:'GROUP_INVALID_MOBILE'});
});
