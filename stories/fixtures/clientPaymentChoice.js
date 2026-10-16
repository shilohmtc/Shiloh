'use strict';
function choiceFixture(kind='ordinary'){
 const model={available:true,scopeLabel:'This appointment only',message:'Choose an amount to review. The deposit is part-payment, not an extra fee. Full payment does not change cancellation or refund rules.',amountDue:'1000.00',recordedMoney:'0.00',appliedCredits:'0.00',remaining:'1000.00',depositRequired:'500.00',depositRemaining:'500.00',review:'synthetic-review',appointments:[{service:'Synthetic relaxation treatment',when:'2 Nov 2026, 10:00',amount:'1000.00'}],choices:[{key:'deposit',label:'Pay deposit',amount:'500.00'},{key:'full',label:'Pay remaining amount in full',amount:'1000.00'}]};
 if(kind==='waived'){model.depositWaived=true;model.depositRemaining='0.00';model.choices.shift();}
 if(kind==='partial'){model.recordedMoney='200.00';model.appliedCredits='100.00';model.remaining='700.00';model.depositRemaining='300.00';model.choices[0].amount='300.00';model.choices[1].amount='700.00';}
 if(kind==='shared')return {available:false,reason:'shared_scope',message:'Reception must confirm which shared booking charges you may pay. Your existing payer-bound payment remains separate.'};
 if(kind==='pending'){model.choices=[];model.reason='existing_attempt';model.message='An earlier payment attempt must finish or be reviewed before the amount can change. Returning from Ozow does not cancel that attempt.';}
 if(kind==='settled'){model.choices=[];model.remaining='0.00';model.depositRemaining='0.00';model.recordedMoney='1000.00';model.message='No treatment payment remains.';}
 if(kind==='group'){model.scopeLabel='All 2 appointments in this booking, all belonging to you';model.appointments=[{service:'Synthetic relaxation treatment',when:'2 Nov 2026, 10:00',amount:'600.00'},{service:'Synthetic facial treatment',when:'2 Nov 2026, 11:15',amount:'400.00'}];}
 return model;
}
module.exports={choiceFixture};
