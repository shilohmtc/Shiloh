const base = require('./publicBookingPage');
const { PUBLIC_CHROME_CSS, renderSiteHeader, renderSiteFooter } = require('./publicSiteChrome');
const { PUBLIC_BRAND_NAME, PUBLIC_TAGLINE } = require('./publicPresentation');

const VISUAL_BREAK = `<section class="inside-shiloh-break" aria-label="Inside Shiloh"><div class="inside-shiloh-break-copy"><span>Inside Shiloh</span><strong>${PUBLIC_TAGLINE}</strong><small>${PUBLIC_BRAND_NAME}</small></div></section>`;

function insertInsideShilohSignatures(html, catalogue = []) {
  const categories = [...new Set(catalogue.map((service) => service.category))];
  const massageIndex = categories.indexOf('Massage');
  if (massageIndex < 0) return html;

  const massageSection = `<section class="category" id="category-${massageIndex}">`;
  html = html.replace(massageSection, `${VISUAL_BREAK}${massageSection}`);

  if (categories.length > 2) {
    let middleIndex = Math.floor(categories.length / 2);
    if (middleIndex === massageIndex) middleIndex += 1;
    const middleSection = `<section class="category" id="category-${middleIndex}">`;
    html = html.replace(middleSection, `${VISUAL_BREAK}${middleSection}`);
  }

  html = html.replace(
    '</div><section class="clinic">',
    `${VISUAL_BREAK}</div><section class="clinic">`,
  );
  return html;
}

function renderBookingPage(number, catalogue = []) {
  let html = base.renderBookingPage(number, catalogue);

  html = html.replace('<body>', `<body>${renderSiteHeader('/book')}`);
  html = html.replace('<main>', '<main id="main-content">');
  html = html.replace(/<footer class="footer">[\s\S]*?<\/footer>/, renderSiteFooter());

  const oldGallery = /<section class="clinic-gallery"[\s\S]*?<\/section>/;
  html = html.replace(oldGallery, '');
  html = insertInsideShilohSignatures(html, catalogue);

  const visualBreakCss = `
.inside-shiloh-break{width:calc(100% + 280px);margin:26px -140px 32px;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(36,53,47,.12);border:1px solid rgba(36,53,47,.08);background:#5f584f;color:#fff}.inside-shiloh-break-copy{min-height:170px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px}.inside-shiloh-break-copy span{font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.17em;color:#ead6a9}.inside-shiloh-break-copy strong{font-family:Georgia,"Times New Roman",serif;font-size:clamp(28px,3.4vw,46px);font-weight:500;letter-spacing:-.025em;margin:7px 0 9px}.inside-shiloh-break-copy small{color:#eee7dc;font-size:13px}.catalogue>.inside-shiloh-break:first-child{margin-top:4px;margin-bottom:30px}.catalogue>.inside-shiloh-break:last-child{margin-top:34px;margin-bottom:8px}@media(max-width:1280px){.inside-shiloh-break{width:100%;margin:24px 0 30px}}@media(max-width:700px){.inside-shiloh-break{border-radius:16px;margin:20px 0 24px}.inside-shiloh-break-copy{min-height:145px;padding:24px 18px}}
`;
  html = html.replace('</style>', `${PUBLIC_CHROME_CSS}${visualBreakCss}</style>`);
  return html;
}

module.exports = { ...base, renderBookingPage };
