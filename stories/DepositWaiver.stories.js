import presentation from '../src/presentation/calendarPaymentsUx.js';
import fixtures from './fixtures/bookingDepositWaiverPresentation.js';
const {renderCalendarPaymentPage,calendarPaymentsClientScript}=presentation;
function surface(options){const html=renderCalendarPaymentPage({model:fixtures.waiverFixture(options),csrfToken:'synthetic-csrf'});const root=document.createElement('div');root.innerHTML=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>`<style>${m[1]}</style>`).join('')+(html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]||'').replace(/<script[\s\S]*?<\/script>/g,'');setTimeout(()=>new Function(calendarPaymentsClientScript())(),0);return root;}
export default {title:'Workspace/Deposit waiver',parameters:{layout:'fullscreen'}};
export const Ordinary={render:()=>surface({})};
export const Shared={render:()=>surface({shared:true})};
export const Waived={render:()=>surface({waived:true})};
export const Forbidden={render:()=>surface({allowed:false})};
