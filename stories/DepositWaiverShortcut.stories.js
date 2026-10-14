import sparse from './fixtures/workspaceBrowserReview.generated/waiver-shortcut-sparse.html?url';
import busy from './fixtures/workspaceBrowserReview.generated/waiver-shortcut-busy.html?url';
import restricted from './fixtures/workspaceBrowserReview.generated/waiver-shortcut-restricted.html?url';
const iframe=url=>`<iframe title="Dashboard deposit waiver shortcut" src="${url}" style="width:100%;height:100vh;border:0"></iframe>`;
export default {title:'Workspace/Deposit waiver shortcut',parameters:{layout:'fullscreen'}};
export const Sparse={render:()=>iframe(sparse)};
export const Busy={render:()=>iframe(busy)};
export const Restricted={render:()=>iframe(restricted)};
