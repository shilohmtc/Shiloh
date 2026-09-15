const {
  PUBLIC_BRAND_NAME,
  PUBLIC_BRAND_SUBTITLE,
} = require('./publicPresentation');

const NAV_ITEMS = [
  ['/', 'Home'],
  ['/treatments', 'Services'],
  ['/about', 'About'],
  ['/contact', 'Contact'],
  ['/book', 'Book'],
];

const PUBLIC_CHROME_CSS = `
.skip-link{position:fixed;left:12px;top:-60px;z-index:100;background:#fff;color:#294b3e;padding:10px 14px;border-radius:10px;font-weight:800}.skip-link:focus{top:12px}.site-header{position:sticky;top:0;z-index:40;background:rgba(247,243,235,.94);backdrop-filter:blur(14px);border-bottom:1px solid rgba(36,53,47,.1)}.site-header-row{width:min(1180px,calc(100% - 40px));min-height:72px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:24px}.site-brand{display:flex;flex-direction:column;text-decoration:none;line-height:1}.site-brand strong{font-family:Georgia,"Times New Roman",serif;font-size:27px;font-weight:500;letter-spacing:-.035em}.site-brand span{margin-top:5px;color:#53625c;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.site-nav{display:flex;align-items:center;gap:4px}.site-nav a{padding:10px 12px;border-radius:999px;text-decoration:none;font-size:14px;font-weight:750}.site-nav a:hover,.site-nav a:focus-visible,.site-nav a[aria-current="page"]{background:#dce8da;color:#294b3e}.site-nav .site-book{background:#294b3e;color:#fff;padding-inline:18px}.site-nav .site-book:hover,.site-nav .site-book:focus-visible,.site-nav .site-book[aria-current="page"]{background:#1f3b30;color:#fff}.mobile-nav{display:none;position:relative}.mobile-nav summary{list-style:none;cursor:pointer;border:1px solid #cad4ce;border-radius:999px;padding:9px 13px;font-weight:800}.mobile-nav summary::-webkit-details-marker{display:none}.mobile-nav-panel{position:absolute;right:0;top:48px;min-width:210px;padding:8px;background:#fff;border:1px solid #dce2dd;border-radius:15px;box-shadow:0 14px 36px rgba(36,53,47,.16)}.mobile-nav-panel a{display:block;text-decoration:none;padding:11px 12px;border-radius:10px;font-weight:750}.mobile-nav-panel a[aria-current="page"]{background:#dce8da}.site-footer{background:#294b3e;color:#fff;padding:38px 0}.site-footer-row{width:min(1180px,calc(100% - 40px));margin:auto;display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:28px}.site-footer strong{font-family:Georgia,"Times New Roman",serif;font-size:22px;font-weight:500}.site-footer p,.site-footer a{color:#dce7e1;font-size:13px}.site-footer p{margin:7px 0 0}.site-footer a{text-decoration-thickness:1px;text-underline-offset:3px}.signature-copy .eyebrow{color:#fff}@media(max-width:760px){.site-header-row{width:calc(100% - 30px);min-height:64px}.site-brand span{display:none}.site-nav{display:none}.mobile-nav{display:block}.site-footer-row{width:calc(100% - 30px);grid-template-columns:1fr;gap:18px}}
`;

function renderLinks(currentPath, className = 'site-nav') {
  return `<nav class="${className}" aria-label="Primary navigation">${NAV_ITEMS.map(
    ([href, label]) => {
      const current = currentPath === href ? ' aria-current="page"' : '';
      const bookClass = href === '/book' ? ' class="site-book"' : '';
      return `<a href="${href}"${bookClass}${current}>${label}</a>`;
    },
  ).join('')}</nav>`;
}

function renderSiteHeader(currentPath) {
  return `<a class="skip-link" href="#main-content">Skip to content</a><header class="site-header"><div class="site-header-row"><a class="site-brand" href="/" aria-label="Shiloh home"><strong>Shiloh</strong><span>${PUBLIC_BRAND_SUBTITLE}</span></a>${renderLinks(currentPath)}<details class="mobile-nav"><summary>Menu</summary><div class="mobile-nav-panel">${renderLinks(currentPath, 'mobile-nav-links')}</div></details></div></header>`;
}

function renderSiteFooter() {
  return `<footer class="site-footer"><div class="site-footer-row"><div><strong>${PUBLIC_BRAND_NAME}</strong><p>Personal massage and aesthetic services in Heidelberg.</p></div><div><b>Visit</b><p>37 Jacobs Street<br>Heidelberg, Gauteng</p></div><div><b>Appointments</b><p><a href="/book">View services and book</a><br><a href="/privacy">Privacy policy</a><br>Availability is confirmed when Shiloh completes your booking.</p></div></div></footer>`;
}

module.exports = { NAV_ITEMS, PUBLIC_CHROME_CSS, renderSiteHeader, renderSiteFooter };
