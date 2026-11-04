import page from './fixtures/workspaceBrowserReview.generated/already-attended.html?url';
export default { title: 'Workspace/Already attended', parameters: { layout: 'fullscreen' } };
export const PastRequests = { render: () => `<iframe title="Already attended review" src="${page}" style="width:100%;height:100vh;border:0"></iframe>` };
