import ux from '../src/presentation/clinicTabletBookedUx.js';
const form={completed:false,form:{title:'Your visit details',consentText:'I confirm these synthetic details are correct.',settings:{signature_required:true},sections:[]},appointment:{},prefill:{}};
function surface(model){const html=ux.tabletBookedPage({csrf:'synthetic-csrf',...model});const node=document.createElement('div');node.innerHTML=`${[...html.matchAll(/<style>[\s\S]*?<\/style>/g)].map(match=>match[0]).join('')}${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]||''}`;return node;}
export default {title:'Clinic tablet/Booked client',parameters:{layout:'fullscreen'}};
export const Welcome={render:()=>surface({state:'start'})};
export const WhatsAppCode={render:()=>surface({state:'code'})};
export const ChooseVisit={render:()=>surface({state:'choose',visits:[{id:'42',label:'11 Nov, 10:30 · Synthetic massage'},{id:'45',label:'11 Nov, 14:00 · Synthetic facial'}]})};
export const RequiredForm={render:()=>surface({state:'form',position:1,total:2,assignmentId:'7',model:form})};
export const ReceptionHelp={render:()=>surface({state:'help'})};
export const Complete={render:()=>surface({state:'finished'})};
