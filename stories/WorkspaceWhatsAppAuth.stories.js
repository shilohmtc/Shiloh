import presentation from '../src/presentation/workspaceWhatsAppUx.js';
export default { title:'Workspace/WhatsApp authentication draft' };
function render(admin=false) {
  const html=presentation.workspaceWhatsAppPage({admin});
  return `<style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style>${html.match(/<body>([\s\S]*?)<\/body>/)[1]}`;
}
export const SignIn={render:()=>render()};
export const AdministratorApproval={render:()=>render(true)};
