const base = require('./publicBookingPage');
const { PUBLIC_CHROME_CSS, renderSiteHeader, renderSiteFooter } = require('./publicSiteChrome');
const {
  PUBLIC_BRAND_NAME,
  PUBLIC_TAGLINE,
  neutralizePublicLabel,
  sanitizePublicCatalogue,
} = require('./publicPresentation');

const VISUAL_BREAK = `<section class="inside-shiloh-break" aria-label="Inside Shiloh"><div class="inside-shiloh-break-copy"><span>Inside Shiloh</span><strong>${PUBLIC_TAGLINE}</strong><small>${PUBLIC_BRAND_NAME}</small></div></section>`;

function publicCategories(catalogue = []) {
  return [...new Set(sanitizePublicCatalogue(catalogue).map((service) => service.category))];
}

function insertInsideShilohSignatures(html, catalogue = []) {
  const categories = publicCategories(catalogue);
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

function extractCategorySection(html, index) {
  const match = html.match(
    new RegExp(`<section class="category" id="category-${index}">[\\s\\S]*?<\\/section>`),
  );
  return match ? match[0] : null;
}

function groupSpecialtyCategories(html, catalogue = []) {
  const categories = publicCategories(catalogue);
  const rows = [
    ['Profosma Jet Plasma', 'Plasma Fibroblast Consultation', 'Plasma Fibroblast Prices'],
    ['1. SQT BioMicroneedling', '2. SQT BioMicroneedling'],
    ['HIFU', 'Vaginal Tightening & Rejuvenation', 'Neo Pelvic Therapy'],
  ].map((row) => row.map(neutralizePublicLabel));

  for (const row of rows) {
    const indexes = row.map((name) => categories.indexOf(name));
    if (indexes.some((index) => index < 0)) continue;

    const sections = indexes.map((index) => extractCategorySection(html, index));
    if (sections.some((section) => !section)) continue;

    // Categories do not need to be adjacent in the canonical catalogue. Remove
    // each complete section, then insert the approved row where the earliest
    // member originally appeared. This changes presentation only, not catalogue data.
    const positions = sections.map((section) => html.indexOf(section));
    const insertionPosition = Math.min(...positions);
    const marker = `__SHILOH_SPECIALTY_ROW_${indexes.join('_')}__`;
    const earliestSection = sections[positions.indexOf(insertionPosition)];
    html = html.replace(earliestSection, marker);
    for (const section of sections) {
      if (section !== earliestSection) html = html.replace(section, '');
    }

    const columns = row.length === 3 ? ' specialty-category-row--three' : '';
    html = html.replace(
      marker,
      `<div class="specialty-category-row${columns}">${sections.join('')}</div>`,
    );
  }
  return html;
}

function renderBookingPage(number, catalogue = []) {
  let html = base.renderBookingPage(number, catalogue);

  html = html.replace('<body>', `<body>${renderSiteHeader('/book')}`);
  html = html.replace('<main>', '<main id="main-content">');
  html = html.replace(/<footer class="footer">[\s\S]*?<\/footer>/, renderSiteFooter());

  const oldGallery = /<section class="clinic-gallery"[\s\S]*?<\/section>/;
  html = html.replace(oldGallery, '');

  html = groupSpecialtyCategories(html, catalogue);
  html = insertInsideShilohSignatures(html, catalogue);

  const visualBreakCss = `
.inside-shiloh-break{width:calc(100% + 280px);margin:26px -140px 32px;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(36,53,47,.12);border:1px solid rgba(36,53,47,.08);background:#5f584f;color:#fff}.inside-shiloh-break-copy{min-height:170px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px}.inside-shiloh-break-copy span{font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.17em;color:#fff}.inside-shiloh-break-copy strong{font-family:Georgia,"Times New Roman",serif;font-size:clamp(28px,3.4vw,46px);font-weight:500;letter-spacing:-.025em;margin:7px 0 9px}.inside-shiloh-break-copy small{color:#eee7dc;font-size:13px}.catalogue>.inside-shiloh-break:first-child{margin-top:4px;margin-bottom:30px}.catalogue>.inside-shiloh-break:last-child{margin-top:34px;margin-bottom:8px}.specialty-category-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:stretch}.specialty-category-row--three{grid-template-columns:repeat(3,minmax(0,1fr))}.specialty-category-row>.category{min-width:0}.specialty-category-row .service-grid{grid-template-columns:1fr}.specialty-category-row .service-card{height:100%}@media(max-width:1280px){.inside-shiloh-break{width:100%;margin:24px 0 30px}.specialty-category-row--three{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.inside-shiloh-break{border-radius:16px;margin:20px 0 24px}.inside-shiloh-break-copy{min-height:145px;padding:24px 18px}.specialty-category-row,.specialty-category-row--three{grid-template-columns:1fr;gap:0}}
`;
  html = html.replace('</style>', `${PUBLIC_CHROME_CSS}${visualBreakCss}</style>`);
  return html;
}

module.exports = { ...base, renderBookingPage };
