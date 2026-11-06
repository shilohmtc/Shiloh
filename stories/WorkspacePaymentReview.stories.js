import presentation from '../src/presentation/workspacePaymentReviewUx.js';
const member = (id, name, date) => ({ appointmentId:id,clientName:name,serviceName:'Synthetic treatment',startsAt:date,staffNames:['Synthetic practitioner'] });
const first = member(701,'Synthetic Client One','2026-10-31T09:30:00Z');
const second = member(702,'Synthetic Client Two','2026-11-02T10:00:00Z');
const reviewFixture = { state:'known',restricted:false,after:null,next:'725',items:[
  { appointmentId:701,groupId:null,members:[first],state:'outstanding',outstanding:'450.00',currency:'ZAR',reason:'Completed visit balance' },
  { appointmentId:702,groupId:91,members:[second,member(703,'Synthetic Client Three','2026-11-02T10:00:00Z')],state:'outstanding',outstanding:'800.00',currency:'ZAR',reason:'Whole booking balance' },
  { appointmentId:704,groupId:null,members:[member(704,'Synthetic Client Four','2026-10-30T08:00:00Z')],state:'review',outstanding:null,reason:'Payment receipt needs verification' },
] };
const depositFixture = { unavailable:false,items:[{accountId:81,appointmentId:705,state:'partial',outstanding:'150.00',hasLink:true,canWaiveDeposit:true,members:[member(705,'Synthetic Client Five','2026-12-15T09:00:00Z')]}] };
function surface(model) {
 const html=presentation.renderWorkspacePaymentReview(model).replaceAll('/calendar/pwa/icon-192.png', '/assets/pwa/shiloh-pwa-192.png'),root=document.createElement('div');
 root.innerHTML=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>`<style>${m[1]}</style>`).join('')+html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g,'');
 return root;
}
export default { title:'Workspace/Unfinished payments',parameters:{layout:'fullscreen',a11y:{test:'error'}} };
export const Populated={render:()=>surface({review:reviewFixture,deposits:depositFixture})};
export const Unavailable={render:()=>surface({review:{state:'unavailable'},deposits:depositFixture})};
export const Restricted={render:()=>surface({review:{state:'restricted'},deposits:null})};
export const EmptyPage={render:()=>surface({review:{state:'known',items:[],after:'725',next:'750'},deposits:{items:[]}})};
