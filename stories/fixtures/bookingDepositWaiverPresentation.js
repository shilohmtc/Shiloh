'use strict';
const {paymentFixture}=require('../../tests/fixtures/bookingPaymentPresentation');
function waiverFixture({shared=false,waived=false,allowed=true}={}){
 const model=paymentFixture({paid:false,awaitingDeposit:true});
 model.subject={...model.subject,status:'confirmed',pricingRevision:'2026-10-14T08:00:00.000Z',serviceName:'Synthetic relaxation treatment',...(shared?{groupId:70}:{})};
 model.authority.canWaiveDeposit=allowed;
 model.payment={...model.payment,state:'partially_paid',netPaid:'50.00',outstanding:'1400.00',entries:[{entry_type:'payment',method:'cash',amount:'50.00',created_at:'2026-10-14T09:00Z'}]};
 model.deposit.requirement={...model.deposit.requirement,id:90,state:waived?'waived':'awaiting',net_paid:'50.00'};
 model.deposit.scope={members:[{appointmentId:779,clientName:'Synthetic Aloe',serviceName:'Synthetic relaxation treatment'},...(shared?[{appointmentId:780,clientName:'Synthetic Fynbos',serviceName:'Synthetic guest treatment'}]:[])]};
 if(waived){model.depositWaiverEvidence={reason:'Agreed deposit exception',actorName:'Synthetic Reception',createdAt:'2026-10-14T10:00Z'};model.payment.requests=model.payment.requests.map(r=>({...r,state:'cancelled'}));}
 model.rewards=null;model.noncash={eligible:false};
 return model;
}
module.exports={waiverFixture};
