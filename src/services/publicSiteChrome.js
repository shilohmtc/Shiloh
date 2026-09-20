const {
  PUBLIC_BRAND_NAME,
  PUBLIC_BRAND_SUBTITLE,
  PUBLIC_TAGLINE,
} = require('./publicPresentation');

const NAV_ITEMS = [
  ['/', 'Home'],
  ['/treatments', 'Services'],
  ['/about', 'About'],
  ['/visit', 'Visit Heidelberg'],
  ['/contact', 'Contact'],
  ['/my-shiloh/', 'My Shiloh'],
  ['/book', 'Book'],
];

const PUBLIC_CHROME_CSS = `
.skip-link{position:fixed;left:12px;top:-60px;z-index:100;background:#fff;color:#294b3e;padding:10px 14px;border-radius:10px;font-weight:800}.skip-link:focus{top:12px}.site-header{position:sticky;top:0;z-index:40;background:rgba(250,247,240,.96);backdrop-filter:blur(14px);border-bottom:1px solid rgba(36,53,47,.1);box-shadow:0 5px 22px rgba(36,53,47,.035)}.site-header-row{width:min(1180px,calc(100% - 40px));min-height:82px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:24px}.site-brand{display:flex;align-items:center;gap:11px;min-width:220px;text-decoration:none;color:#24352f}.site-brand-mark{display:block;width:58px;height:58px;flex:0 0 58px;border-radius:18px;object-fit:cover;box-shadow:0 7px 22px rgba(46,64,51,.1)}.site-brand-copy{display:flex;flex-direction:column;line-height:1}.site-brand-name{font-family:Georgia,"Times New Roman",serif;font-size:29px;font-weight:500;letter-spacing:-.04em;color:#6e5a40}.site-brand-subtitle{margin-top:6px;color:#53625c;font-size:8px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.site-nav{display:flex;align-items:center;gap:3px}.site-nav a{padding:10px 11px;border-radius:999px;text-decoration:none;font-size:13px;font-weight:750}.site-nav a:hover,.site-nav a:focus-visible,.site-nav a[aria-current="page"]{background:#dce8da;color:#294b3e}.site-nav .site-client{background:rgba(255,255,255,.72);border:1px solid #cbd6cf;color:#294b3e;padding-inline:15px}.site-nav .site-client:hover,.site-nav .site-client:focus-visible{background:#edf2eb;border-color:#b8c7be}.site-nav .site-book{background:#294b3e;color:#fff;padding-inline:17px}.site-nav .site-book:hover,.site-nav .site-book:focus-visible,.site-nav .site-book[aria-current="page"]{background:#1f3b30;color:#fff}.mobile-nav{display:none;position:relative}.mobile-nav summary{list-style:none;cursor:pointer;border:1px solid #cad4ce;border-radius:999px;padding:9px 13px;font-weight:800}.mobile-nav summary::-webkit-details-marker{display:none}.mobile-nav-panel{position:absolute;right:0;top:48px;min-width:220px;padding:8px;background:#fff;border:1px solid #dce2dd;border-radius:15px;box-shadow:0 14px 36px rgba(36,53,47,.16)}.mobile-nav-panel a{display:block;text-decoration:none;padding:11px 12px;border-radius:10px;font-weight:750}.mobile-nav-panel a[aria-current="page"]{background:#dce8da}.mobile-nav-panel .mobile-client{margin:4px 0;background:#edf2eb;border:1px solid #d7e1da}.mobile-nav-panel .mobile-client span,.mobile-nav-panel .mobile-client small{display:block}.mobile-nav-panel .mobile-client small{margin-top:2px;color:#68766f;font-size:10px;font-weight:650;letter-spacing:.01em}.site-footer{position:relative;overflow:hidden;background:#294b3e;color:#fff;padding:54px 0 34px}.site-footer::after{content:"";position:absolute;right:-95px;bottom:-125px;width:310px;height:310px;border:1px solid rgba(233,214,169,.14);border-radius:50%;box-shadow:0 0 0 42px rgba(233,214,169,.035),0 0 0 88px rgba(233,214,169,.025);pointer-events:none}.site-footer-row{position:relative;z-index:1;width:min(1180px,calc(100% - 40px));margin:auto;display:grid;grid-template-columns:minmax(310px,1.45fr) 1fr 1fr;gap:42px}.site-footer-brand{display:grid;grid-template-columns:86px minmax(0,1fr);align-items:center;gap:18px}.site-footer-mark{display:block;width:86px;height:86px;border-radius:24px;object-fit:cover;box-shadow:0 10px 28px rgba(8,20,15,.2)}.site-footer-name{display:block;font-family:Georgia,"Times New Roman",serif;font-size:33px;font-weight:500;letter-spacing:-.04em;color:#f3e9d7}.site-footer-subtitle{display:block;margin-top:6px;color:#dce7e1;font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.site-footer-tagline{margin-top:12px!important;color:#ead6a9!important;font-family:Georgia,"Times New Roman",serif;font-size:17px!important}.site-footer-heading{display:block;color:#fff;font-size:12px;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.site-footer p,.site-footer a{color:#dce7e1;font-size:13px}.site-footer p{margin:10px 0 0;line-height:1.75}.site-footer a{text-decoration-thickness:1px;text-underline-offset:3px}.site-footer a:hover,.site-footer a:focus-visible{color:#fff}.site-footer-note{grid-column:1/-1;margin-top:2px!important;padding-top:22px;border-top:1px solid rgba(255,255,255,.14);color:#bfcfc7!important;font-size:11px!important}.signature-copy .eyebrow{color:#fff}@media(max-width:1030px){.site-header-row{gap:14px}.site-brand{min-width:auto}.site-brand-subtitle{display:none}.site-nav a{padding-inline:9px;font-size:12px}}@media(max-width:760px){.site-header-row{width:calc(100% - 30px);min-height:72px}.site-brand{gap:9px}.site-brand-mark{width:50px;height:50px;flex-basis:50px;border-radius:15px}.site-brand-name{font-size:26px}.site-brand-subtitle{display:block;font-size:7px;letter-spacing:.08em}.site-nav{display:none}.mobile-nav{display:block}.site-footer{padding:42px 0 28px}.site-footer-row{width:calc(100% - 30px);grid-template-columns:1fr;gap:27px}.site-footer-brand{grid-template-columns:72px 1fr}.site-footer-mark{width:72px;height:72px;border-radius:20px}.site-footer-name{font-size:29px}.site-footer-note{grid-column:auto;margin-top:0!important}}@media(max-width:390px){.site-brand-subtitle{display:none}}
`;

function renderLinks(currentPath, className = 'site-nav') {
  return `<nav class="${className}" aria-label="Primary navigation">${NAV_ITEMS.map(
    ([href, label]) => {
      const current = currentPath === href ? ' aria-current="page"' : '';
      const desktopClass = href === '/book' ? 'site-book' : href === '/my-shiloh/' ? 'site-client' : '';
      const mobileClient = className === 'mobile-nav-links' && href === '/my-shiloh/';
      const classAttr = desktopClass && className === 'site-nav'
        ? ` class="${desktopClass}"`
        : mobileClient
          ? ' class="mobile-client"'
          : '';
      const content = mobileClient
        ? `<span>${label}</span><small>My bookings &amp; profile</small>`
        : label;
      return `<a href="${href}"${classAttr}${current}>${content}</a>`;
    },
  ).join('')}</nav>`;
}

function renderSiteHeader(currentPath) {
  return `<a class="skip-link" href="#main-content">Skip to content</a><header class="site-header"><div class="site-header-row"><a class="site-brand" href="/" aria-label="Shiloh home"><img class="site-brand-mark" src="/assets/brand/shiloh-mark-192.png" alt="" width="192" height="192"><span class="site-brand-copy"><strong class="site-brand-name">${PUBLIC_BRAND_NAME}</strong><small class="site-brand-subtitle">${PUBLIC_BRAND_SUBTITLE}</small></span></a>${renderLinks(currentPath)}<details class="mobile-nav"><summary>Menu</summary><div class="mobile-nav-panel">${renderLinks(currentPath, 'mobile-nav-links')}</div></details></div></header>`;
}

function renderSiteFooter() {
  return `<footer class="site-footer"><div class="site-footer-row"><div><div class="site-footer-brand"><img class="site-footer-mark" src="/assets/brand/shiloh-mark-192.png" alt="" width="192" height="192"><div><strong class="site-footer-name">${PUBLIC_BRAND_NAME}</strong><span class="site-footer-subtitle">${PUBLIC_BRAND_SUBTITLE}</span><p class="site-footer-tagline">${PUBLIC_TAGLINE}</p></div></div></div><div><strong class="site-footer-heading">Visit Shiloh</strong><p>37 Jacobs Street<br>Heidelberg, Gauteng<br><a href="/contact">Contact &amp; directions</a><br><a href="/visit">Explore Heidelberg</a></p></div><div><strong class="site-footer-heading">Appointments</strong><p><a href="/book">View services and book</a><br><a href="/my-shiloh/">Open My Shiloh</a><br><a href="mailto:info@shilohmtc.co.za">Email Shiloh</a><br><a href="/privacy">Privacy policy</a></p></div><p class="site-footer-note">Personal massage and aesthetic services in Heidelberg. Availability is confirmed when Shiloh completes your booking.</p></div></footer>`;
}

module.exports = { NAV_ITEMS, PUBLIC_CHROME_CSS, renderSiteHeader, renderSiteFooter };
