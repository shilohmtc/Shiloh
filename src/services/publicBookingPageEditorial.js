const base = require('./publicBookingPage');
const { PUBLIC_SITE_ORIGIN } = require('../config/publicOrigins');
const { PUBLIC_CHROME_CSS, renderSiteHeader, renderSiteFooter } = require('./publicSiteChrome');

function renderBookingPage(number, catalogue = [], selectedServiceId = '', options = {}) {
  let html = base.renderBookingPage(number, catalogue, selectedServiceId, options);
  const canonical = `${PUBLIC_SITE_ORIGIN}/book`;
  const description = html.match(/<meta name="description" content="([^"]*)">/)[1];
  html = html.replace('</head>', `<link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="Book with Shiloh | Massage &amp; Aesthetic Clinic"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${PUBLIC_SITE_ORIGIN}/assets/brand/shiloh-logo-full.jpg"></head>`);

  html = html.replace('<body>', `<body>${renderSiteHeader('/book')}`);
  html = html.replace('<main>', '<main id="main-content">');
  html = html.replace(/<footer class="footer">[\s\S]*?<\/footer>/, renderSiteFooter());

  const oldGallery = /<section class="clinic-gallery"[\s\S]*?<\/section>/;
  html = html.replace(oldGallery, '');

  const descriptionCss = `
.service-card{scroll-margin-top:8rem}
.service-card .service-description{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.55}
`;
  html = html.replace('</style>', `${PUBLIC_CHROME_CSS}${descriptionCss}</style>`);
  return html;
}

module.exports = { ...base, renderBookingPage };
