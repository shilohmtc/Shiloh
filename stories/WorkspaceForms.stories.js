import ux from '../src/presentation/workspaceFormsUx.js';

const authority = { displayName:'Christel', formScope:'all_business', businessRole:'owner' };
const appointments = [
  {id:901,clientName:'Example Client',services:'Hot Stone Massage',startsAt:'2026-10-07T08:00:00Z',practitioners:'Abigail',canOpen:true,canPrepareIpad:true,readiness:{ready:false,label:'Required forms outstanding'},forms:[{title:'Massage consultation',status:'opened',canComplete:true}]},
  {id:902,clientName:'Another Client',services:'Swedish Massage',startsAt:'2026-10-07T09:00:00Z',practitioners:'Christel',canOpen:true,canPrepareIpad:true,readiness:{ready:true,label:'Required forms complete'},forms:[{title:'Massage consultation',status:'completed',submissionId:701}]},
];
const historyItems = [{kind:'client',reference:'701',clientName:'Another Client',formTitle:'Massage consultation',services:['Swedish Massage'],practitioners:['Christel'],appointmentStartsAt:'2026-10-07T09:00:00Z',submittedAt:'2026-10-06T08:00:00Z',signedAt:'2026-10-06T08:00:00Z',status:'completed',canOpen:true}];
function surface(model) {
  // Express serves this official mark at /calendar/pwa/icon-192.png in production.
  const page = ux.renderFormsPage(model).replaceAll('/calendar/pwa/icon-192.png?v=official-brand-v4','/assets/brand/shiloh-mark-192.png');
  const root = document.createElement('div');
  root.innerHTML = `<style>${page.match(/<style>([\s\S]*?)<\/style>/)?.[1] || ''}</style>${page.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || ''}`;
  return root;
}
export default {title:'Workspace/Required forms',parameters:{layout:'fullscreen'}};
export const BeforeTreatment = {render:()=>surface({authority,treatmentQueue:{appointments},templates:[],activity:{opened:1,completed:1},submissions:{items:historyItems}})};
export const PractitionerQueue = {render:()=>surface({authority:{...authority,displayName:'Abigail',formScope:'own_staff',businessRole:'practitioner'},treatmentQueue:{appointments:[{...appointments[0],canPrepareIpad:false}]}})};
export const ReceptionHistory = {render:()=>surface({authority:{...authority,displayName:'Reception',businessRole:'booking_operator'},history:{items:historyItems.map(item=>({...item,canOpen:false})),search:'',page:0,hasMore:true}})};
export const ReviewerHistory = {render:()=>surface({authority,history:{items:historyItems,search:'Client',page:1,hasMore:true}})};

export const AppointmentContext = {render:()=>surface({authority,appointmentId:901,returnHref:'/calendar?view=week&date=2026-10-07&appointment=901',treatmentQueue:{appointments:[appointments[0]]},templates:[],submissions:{items:[]}})};
