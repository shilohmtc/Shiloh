import presentation from '../src/presentation/giftVoucherUx.js';

const { renderClientVoucherPage, renderPublicVoucherPage, renderWorkspaceVoucherPage } = presentation;

function surface(pageHtml) {
  const styles = [...String(pageHtml).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
  const body = String(pageHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] || '';
  return `<style>${styles}</style>${body.replace(/<script[\s\S]*?<\/script>/g, '')}`;
}

export default { title: 'Shiloh/Gift vouchers' };

export const ClientPurchase = {
  render: () => surface(renderClientVoucherPage({
    model: { client:{name:'Christel'}, policy:{configured:true,mode:'fixed_months',months:12}, ozowConfigured:true, orders:[] },
    csrfToken: 'storybook',
  })),
};

export const IssuedEnglish = {
  render: () => surface(renderPublicVoucherPage({ voucher:{recipient_name:'Naledi',from_name:'Christel',personal_message:'A little time to rest and restore.',language:'en',amount:'650.00',voucher_code:'SV-4A7F31B920CC',balance:'650.00',state:'active',valid_until:'2027-09-19'} })),
};

export const WorkspaceBalances = {
  render: () => surface(renderWorkspaceVoucherPage({
    model: { policy:{configured:true,mode:'fixed_months',months:12}, authority:{canManage:true,canRedeem:true}, vouchers:[{voucher_code:'SV-4A7F31B920CC',recipient_name:'Naledi',original_value:'650.00',balance:'400.00',valid_until:'2027-09-19',state:'active'}] },
    csrfToken: 'storybook', displayName: 'Christel',
  })),
};
