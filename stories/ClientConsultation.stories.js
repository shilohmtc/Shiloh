import ux from '../src/presentation/clientConsultationFormUx.js';
const model = {accessToken:'A'.repeat(43),form:{title:'Synthetic consultation',consentText:'Synthetic demonstration declaration.',sections:[]},appointment:{},values:{signature_name:'Synthetic Example'}};
function surface(html) {
  const root=document.createElement('div');
  root.innerHTML=`<style>${html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || ''}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || ''}`;
  return root;
}
export default {title:'My Shiloh/Consultation completion',parameters:{layout:'fullscreen'}};
export const Form = {render:()=>surface(ux.renderClientConsultationFormPage(model))};
export const Received = {render:()=>surface(ux.renderCompletedPage())};
