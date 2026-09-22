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
    model: { client:{name:'Christel'}, policy:{configured:true,mode:'fixed_months',months:12}, ozowConfigured:true, receivedVouchers:[], orders:[] },
    csrfToken: 'storybook',
  })),
};

export const RecipientLinked = {
  render: () => surface(renderClientVoucherPage({
    model: {
      client:{name:'Evelyn'},
      policy:{configured:true,mode:'fixed_months',months:2},
      ozowConfigured:true,
      receivedVouchers:[
        {voucher_code:'SV-EVELYN123456',balance:'900.00',voucher_state:'active',from_name:'Tinkie',voucherPath:'/gift-vouchers/storybook-recipient-key'},
      ],
      orders:[],
    },
    csrfToken:'storybook',
  })),
};

export const IssuedEnglish = {
  render: () => surface(renderPublicVoucherPage({ voucher:{recipient_name:'Naledi',from_name:'Christel',personal_message:'A little time to rest and restore.',language:'en',amount:'650.00',voucher_code:'SV-4A7F31B920CC',balance:'650.00',state:'active',valid_until:'2027-09-19'} })),
};

export const WorkspaceBalances = {
  render: () => surface(renderWorkspaceVoucherPage({
    model: { policy:{configured:true,mode:'fixed_months',months:12}, authority:{canIssue:true,canManage:true,canRedeem:true}, vouchers:[
      {voucher_code:'SV-4A7F31B920CC',recipient_name:'Naledi',original_value:'650.00',balance:'400.00',valid_until:'2027-09-19',state:'active'},
      {voucher_code:'SV-A2F8CBC24FCA',recipient_name:'Chenique Botha',original_value:'500.00',balance:'500.00',valid_until:'2027-11-21',state:'active',order_source:'walk_in',payment_method:'card_machine',stock_reference:'BOOK-0042'},
    ] },
    csrfToken: 'storybook', displayName: 'Christel',
  })),
};

export const WalkInPreprintedCapture = {
  render: () => surface(renderWorkspaceVoucherPage({
    model: { policy:{configured:true,mode:'fixed_months',months:2}, authority:{canIssue:true,canManage:true,canRedeem:true}, vouchers:[] },
    csrfToken: 'storybook', displayName: 'Christel',
  })),
};
