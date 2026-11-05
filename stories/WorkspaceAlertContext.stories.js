import presentation from '../src/presentation/workspacePwa.js';
import shell from '../src/presentation/workspaceShell.js';
const { workspaceAlertDescription } = presentation;
const { escapeHtml } = shell;
export default { title: 'Workspace/Alert context', parameters: { layout: 'fullscreen' } };
export const Examples = { render: () => `<style>body{margin:0;background:#f4f3ed;color:#20322b;font-family:system-ui,sans-serif}.alert-examples{max-width:680px;margin:auto;padding:24px}.alert-examples h1{font-size:1.5rem}.alert-example{background:#fffdf9;border:1px solid #dce3dd;border-radius:16px;padding:20px;margin:16px 0}.alert-example h2{font-size:1rem;margin:0 0 8px}.alert-example p{line-height:1.5;margin:0}.alert-example small{display:block;color:#52645b;margin-top:12px}</style><main class="alert-examples"><h1>Workspace notification wording</h1><p>Content preview. The device controls notification appearance.</p>${[
  ['Booking request',{count:1,categories:['booking_request']}],
  ['Planning request',{count:1,categories:['planning']}],
  ['Combined updates',{count:3,categories:['booking_request','planning','handoff']}],
  ['Session expired or connection unavailable',null],
].map(([label,result])=>`<article class="alert-example"><h2>Shiloh Workspace</h2><p>${escapeHtml(workspaceAlertDescription(result))}</p><small>${escapeHtml(label)}</small></article>`).join('')}</main>` };
