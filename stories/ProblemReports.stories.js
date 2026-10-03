import presentation from '../src/presentation/workspaceProblemReportsUx.js';

const report = {
  reference:'SH-261003-SYNTHETIC', status:'new', category:'profile', reporterType:'client', reporterName:'Synthetic Client', source:'my_shiloh', description:'My personal details were not saving.', expectedBehavior:'My profile should remember the details.', createdAt:'2026-10-03T08:00:00Z', updatedAt:'2026-10-03T08:00:00Z', resolutionNote:null, hasScreenshot:false,
};
function surface(canManage) {
  const html = presentation.renderProblemReportsPage({model:{displayName:canManage?'Jean-Pierre':'Synthetic Staff',canManage,canSubmit:true,reports:canManage?[report,...['booking','profile','payments'].map((category,index)=>({...report,category,reference:'SH-261003-SYNTHETIC'+index,reporterName:'Synthetic Client '+(index+2),description:'A detailed issue report that remains fully available when expanded. '.repeat(6)}))]:[report]}});
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script src=[\s\S]*?<\/script>/g,'');
  return `<style>${styles}</style><div data-story-problem-reports>${body}</div>`;
}
export default {title:'Workspace/Problem reports',parameters:{layout:'fullscreen'}};
export const JpInbox = {render:()=>surface(true)};
export const StaffSubmission = {render:()=>surface(false)};
