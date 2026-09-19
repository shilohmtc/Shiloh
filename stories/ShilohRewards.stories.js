import presentation from '../src/presentation/shilohRewardsUx.js';

const { renderClientRewardsPage, renderWorkspaceRewardsPage } = presentation;
function surface(pageHtml){const styles=[...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');const body=String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1]||'';return `<style>${styles}</style>${body.replace(/<script[\s\S]*?<\/script>/g,'')}`;}
const base={client:{id:12,name:'Christel'},policy:{earnRate:5,unlockThreshold:100,expiryMode:'no_expiry'},entries:[],appointments:[{id:713,starts_at:'2026-09-24T08:00:00Z',status:'confirmed',total_price:'650.00',service_name:'Lymphatic Drainage Session'}]};

export default{title:'Shiloh/Shiloh Rewards'};
export const BuildingTowardUnlock={render:()=>surface(renderClientRewardsPage({model:{...base,wallet:{balance:72.5,credited:72.5,used:0,unlocked:false}},csrfToken:'storybook'}))};
export const ReadyToUse={render:()=>surface(renderClientRewardsPage({model:{...base,wallet:{balance:132.5,credited:182.5,used:50,unlocked:true},entries:[{entry_type:'earn',signed_amount:'32.50',notes:'5% Shiloh Reward on completed, paid treatment',created_at:'2026-09-19T10:00:00Z'},{entry_type:'redeem',signed_amount:'-50.00',notes:'Applied to a Shiloh booking',created_at:'2026-09-10T10:00:00Z'}]},csrfToken:'storybook'}))};
export const WorkspaceBalances={render:()=>surface(renderWorkspaceRewardsPage({model:{policy:{earnRate:5,unlockThreshold:100},authority:{canManage:true,canRedeem:true},wallets:[{crm_v2_client_id:12,name:'Christel',normalized_mobile:'27821234567',balance:'132.50',latest_activity:'2026-09-19T10:00:00Z'}]},csrfToken:'storybook',displayName:'Christel'}))};
