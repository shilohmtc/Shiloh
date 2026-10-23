const base = require('./publicBookingPage');
const { PUBLIC_CHROME_CSS, renderSiteHeader, renderSiteFooter } = require('./publicSiteChrome');

function renderBookingPage(number, catalogue = [], selectedServiceId = '', options = {}) {
  let html = base.renderBookingPage(number, catalogue, selectedServiceId, options);

  html = html.replace('<body>', `<body>${renderSiteHeader('/book')}`);
  html = html.replace('<main>', '<main id="main-content">');
  html = html.replace(/<footer class="footer">[\s\S]*?<\/footer>/, renderSiteFooter());

  const oldGallery = /<section class="clinic-gallery"[\s\S]*?<\/section>/;
  html = html.replace(oldGallery, '');

  const descriptionCss = `
.service-card .service-description{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.55}
`;
  html = html.replace('</style>', `${PUBLIC_CHROME_CSS}${descriptionCss}</style>`);
  return html;
}

module.exports = { ...base, renderBookingPage };
