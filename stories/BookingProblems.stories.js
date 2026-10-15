import recent from './fixtures/workspaceBrowserReview.generated/booking-problems-recent.html?raw';
import unavailable from './fixtures/workspaceBrowserReview.generated/booking-problems-unavailable.html?raw';
export default { title:'Workspace/Booking problems',parameters:{layout:'fullscreen'} };
function surface(html) {
  const styles=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n');
  const body=html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g,'');
  const root=document.createElement('div');root.innerHTML='<style>'+styles+'</style>'+body;
  return root;
}
export const RecentProblems={render:()=>surface(recent)};
export const SupportUnavailable={render:()=>surface(unavailable)};
