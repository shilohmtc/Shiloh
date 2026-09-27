import planning from '../src/presentation/myShilohPlanningRequest.js';
import dashboard from '../src/presentation/workspaceDashboardUx.js';
import myShiloh from '../src/presentation/myShilohPwa.js';

function surface(html) {
  const source = String(html);
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  const root = document.createElement('div');
  root.innerHTML = `<style>${styles}</style><div data-story-surface>${body.replace(/<script[\s\S]*?<\/script>/g,'')}</div>`;
  return root;
}

export default { title:'Client/Planning requests', parameters:{ layout:'fullscreen', a11y:{ test:'error' } } };

export const FlexibleRequest = {
  render:()=>surface(planning.renderPlanningRequestPage({ clientFirstName:'Jean-Pierre', csrfToken:'storybook',
    practitioners:[{ id:7,name:'Abigail' }], requests:[] })),
};

export const GroupOccasion = {
  render:()=>{
    const root=surface(planning.renderPlanningRequestPage({ clientFirstName:'Jean-Pierre', csrfToken:'storybook',
      practitioners:[{ id:7,name:'Abigail' }], requests:[{ id:81,request_kind:'group',status:'planning',service_detail:'Spa afternoon for friends' }] }));
    root.querySelector('[name="kind"][value="group"]').checked=true;
    root.querySelector('[data-group-guests]').hidden=false;
    root.querySelector('[name="specialOccasion"][value="yes"]').checked=true;
    root.querySelector('[data-occasion-detail]').hidden=false;
    return root;
  },
};

export const ReceptionAttention = {
  render:()=>surface(dashboard.renderDashboardPage({ requestedDateKey:'2026-09-27',operationalDateKey:'2026-09-27',
    displayName:'Christel',mode:'owner_overview',appointments:[],carryOver:[],teamGroups:[],awaitingFinalization:[],
    bookingRequests:[],rescheduleRequests:[],holidayDecisions:[],calendar:{ timeline:{ staff:[] } },
    planningRequests:[{ id:81,request_kind:'group',status:'requested',client_name:'Jean-Pierre',
      service_detail:'Spa afternoon for friends',guest_count:4,special_occasion:true,occasion_note:'Birthday',
      preferred_date:'2026-10-02',preferred_daypart:'afternoon' }],
  })),
};

export const HumanHandoff = {
  render:()=>{
    const root=surface(myShiloh.renderMyShilohPage({
      client:{ id:22,firstName:'Jane' }, whatsappNumber:'27836835433',
      humanWhatsAppNumber:'27662399138', humanHandoffActive:true,
    }));
    root.insertAdjacentHTML('afterbegin','<link rel="stylesheet" href="/my-shiloh/assets/app.css">');
    root.querySelector('[data-app-frame]').hidden=false;
    root.querySelector('[data-view="shiloh"]').hidden=false;
    return root;
  },
};

export const ReceptionHumanHandoff = {
  render:()=>surface(dashboard.renderDashboardPage({ requestedDateKey:'2026-09-27',operationalDateKey:'2026-09-27',
    displayName:'Christel',mode:'owner_overview',appointments:[],carryOver:[],teamGroups:[],awaitingFinalization:[],
    bookingRequests:[],rescheduleRequests:[],holidayDecisions:[],calendar:{ timeline:{ staff:[] } },
    humanHandoffs:[{ id:92,client_name:'Jane',client_mobile:'27662399138' }],
  })),
};
