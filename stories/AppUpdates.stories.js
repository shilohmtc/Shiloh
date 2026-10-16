import workspace from './fixtures/workspaceBrowserReview.generated/update-workspace.html?url';
import client from './fixtures/workspaceBrowserReview.generated/update-client.html?url';
const frame = url => `<iframe title="Synthetic app update review" style="width:100%;height:100vh;border:0" src="${url}"></iframe>`;
export default { title: 'Shared/App Updates' };
export const Workspace = { render: () => frame(workspace) };
export const MyShiloh = { render: () => frame(client) };
