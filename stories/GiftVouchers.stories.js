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
    model: { client:{name:'Synthetic Client AN'}, policy:{configured:true,mode:'fixed_months',months:12}, ozowConfigured:true, receivedVouchers:[], orders:[] },
    csrfToken: 'storybook',
  })),
};

export const RecipientLinked = {
  render: () => surface(renderClientVoucherPage({
    model: {
      client:{name:'Synthetic Client BF'},
      policy:{configured:true,mode:'fixed_months',months:2},
      ozowConfigured:true,
      receivedVouchers:[
        {voucher_code:'SV-SYNTHETIC003',original_value:'1190.00',balance:'690.00',voucher_state:'active',issued_at:'2026-09-22T08:00:00.000Z',valid_until:'2026-11-22',from_name:'Synthetic Gift Person E',personal_message:'Synthetic voucher review message.',voucherPath:'/gift-vouchers/storybook-recipient-key'},
        {voucher_code:'SV-SYNTHETIC006',original_value:'500.00',balance:'0.00',voucher_state:'redeemed',issued_at:'2026-08-10T08:00:00.000Z',valid_until:'2026-10-10',from_name:'Synthetic Gift Person H',personal_message:null,voucherPath:'/gift-vouchers/storybook-used-key'},
      ],
      orders:[],
    },
    csrfToken:'storybook',
  })),
};

export const IssuedEnglish = {
  render: () => surface(renderPublicVoucherPage({ voucher:{recipient_name:'Synthetic Gift Person I',from_name:'Synthetic Client AN',personal_message:'Synthetic voucher review message.',language:'en',amount:'650.00',voucher_code:'SV-SYNTHETIC010',balance:'650.00',state:'active',valid_until:'2027-09-19'} })),
};

export const WorkspaceBalances = {
  render: () => surface(renderWorkspaceVoucherPage({
    model: { policy:{configured:true,mode:'fixed_months',months:12}, authority:{canIssue:true,canManage:true,canRedeem:true}, vouchers:[
      {voucher_code:'SV-SYNTHETIC010',recipient_name:'Synthetic Gift Person I',recipient_mobile:'27820000011',recipient_crm_v2_client_id:9012,original_value:'650.00',balance:'400.00',valid_until:'2027-09-19',state:'active'},
      {voucher_code:'SV-SYNTHETIC012',recipient_name:'Synthetic Gift Person N',recipient_mobile:'27820000014',recipient_crm_v2_client_id:null,original_value:'500.00',balance:'500.00',valid_until:'2027-11-21',state:'active',order_source:'walk_in',payment_method:'card_machine',stock_reference:'BOOK-0042'},
    ], recipientChanges:[
      {voucher_code:'SV-SYNTHETIC010',actor_name:'Synthetic Client AN',created_at:'2026-09-22T18:50:00.000Z',metadata:{fromRecipientName:'Synthetic Gift Person P',toRecipientName:'Synthetic Gift Person I',fromMobileLast4:'0016',toMobileLast4:'0017',linkStatus:'linked'}},
    ] },
    csrfToken: 'storybook', displayName: 'Synthetic Client AN',
  })),
};

export const WalkInPreprintedCapture = {
  render: () => surface(renderWorkspaceVoucherPage({
    model: { policy:{configured:true,mode:'fixed_months',months:2}, authority:{canIssue:true,canManage:true,canRedeem:true}, vouchers:[] },
    csrfToken: 'storybook', displayName: 'Synthetic Client AN',
  })),
};
