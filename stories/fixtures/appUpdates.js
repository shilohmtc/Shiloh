const { renderDashboardPage } = require('../../src/presentation/workspaceDashboardUx');
const { dashboardModel } = require('./workspaceBrowserReview');
const { renderMyShilohPage } = require('../../src/presentation/myShilohPwa');
const { workspacePwaClientScript } = require('../../src/presentation/workspacePwa');
const { workspaceNavigationClientScript } = require('../../src/presentation/workspaceShell');
const { workspaceIconClientScript } = require('../../src/presentation/workspaceIconClient');
const { confirmationClientScript } = require('../../src/presentation/workspaceConfirmation');

// Synthetic waiting worker. Activation occurs only when a test explicitly emits it.
function updateHarness({ waiting = true } = {}) {
  return `(()=>{window.syntheticUpdateMessages=[];window.syntheticUpdateChecks=0;const worker={postMessage:message=>{if(window.syntheticUpdateFailure)throw Error('Synthetic worker failure');window.syntheticUpdateMessages.push(message);}};const registration=new EventTarget();registration.waiting=${waiting ? 'worker' : 'null'};registration.update=async()=>{window.syntheticUpdateChecks++;};const container=new EventTarget();container.controller={};container.register=async()=>registration;container.ready=Promise.resolve(registration);Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:container});Object.defineProperty(navigator,'standalone',{configurable:true,value:true});window.syntheticRegistration=registration;window.syntheticWorker=worker;window.syntheticRevealUpdate=()=>{registration.waiting=worker;const installing=new EventTarget();installing.state='installed';registration.installing=installing;registration.dispatchEvent(new Event('updatefound'));installing.dispatchEvent(new Event('statechange'));};})();`;
}
function appUpdatesHtml(app = 'workspace', options = {}) {
  let html = app === 'workspace'
    ? renderDashboardPage(dashboardModel())
    : renderMyShilohPage({ crmAvailable: true, client: { id: '913', name: 'Synthetic Client', firstName: 'Synthetic' }, catalogue: [] });
  html = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const script = app === 'workspace'
    ? `<script>${workspaceNavigationClientScript()}${workspaceIconClientScript()}${workspacePwaClientScript()}</script>`
    : `<script>${confirmationClientScript()}</script><script src="/my-shiloh/assets/app.js"></script>`;
  return html.replace('</body>', `<script>${updateHarness(options)}</script>${script}</body>`);
}
module.exports = { appUpdatesHtml, updateHarness };
