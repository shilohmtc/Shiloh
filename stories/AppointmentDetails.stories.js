import editable from './fixtures/workspaceBrowserReview.generated/appointment-details.html?url';
import pending from './fixtures/workspaceBrowserReview.generated/appointment-details-pending.html?url';
import readOnly from './fixtures/workspaceBrowserReview.generated/appointment-details-read-only.html?url';
export default {title:'Calendar/Appointment details',parameters:{layout:'fullscreen'}};
const frame=src=>`<iframe title="Synthetic appointment details" src="${src}?view=week&date=2026-10-07&staff=all&phoneStaff=all" style="width:100%;height:100vh;border:0"></iframe>`;
export const Editable={render:()=>frame(editable)};
export const Pending={render:()=>frame(pending)};
export const ReadOnly={render:()=>frame(readOnly)};
