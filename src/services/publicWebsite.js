const { PUBLIC_SITE_ORIGIN } = require('../config/publicOrigins');
const {
  SHILOH_PUBLIC_LOCATION,
  SHILOH_TOWN_CENTRE_NEIGHBOURS,
} = require('../config/heidelbergGuide');
const {
  PUBLIC_BRAND_ASSET_VERSION,
  PUBLIC_CHROME_CSS,
  renderSiteHeader,
  renderSiteFooter,
} = require('./publicSiteChrome');
const {
  PUBLIC_BRAND_NAME,
  PUBLIC_BRAND_SUBTITLE,
  PUBLIC_TAGLINE,
  groupPublicCatalogue,
  publicBookingPathForService,
} = require('./publicPresentation');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const SITE_CSS = `
:root{--ink:#24352f;--muted:#53625c;--cream:#f7f3eb;--paper:#fff;--sage:#dce8da;--deep:#294b3e;--line:#dce2dd;--gold:#8a662f;--shadow:0 18px 50px rgba(36,53,47,.1)}*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--cream)}body{margin:0;color:var(--ink);background:var(--cream);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}a{color:inherit}.shell{width:min(1180px,calc(100% - 40px));margin:auto}.eyebrow{text-transform:uppercase;letter-spacing:.17em;font-size:11px;font-weight:850;color:var(--gold)}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.028em}h1{font-size:clamp(48px,6vw,78px);line-height:.98;margin:14px 0 20px}h2{font-size:clamp(34px,4vw,50px);line-height:1.04;margin:8px 0 14px}h3{font-size:24px;line-height:1.15;margin:0 0 10px}.lede{font-size:18px;color:var(--muted);max-width:690px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:27px}.button{min-height:48px;display:inline-flex;align-items:center;justify-content:center;padding:12px 19px;border-radius:12px;text-decoration:none;font-weight:850;border:1px solid var(--deep)}.button.primary{background:var(--deep);color:#fff}.button.secondary{background:transparent;color:var(--deep)}.home-hero{padding:62px 0 58px}.home-hero-grid{display:grid;grid-template-columns:1.03fr .97fr;gap:42px;align-items:center}.hero-visual{min-height:500px;border-radius:30px;overflow:hidden;position:relative;background:linear-gradient(180deg,rgba(20,36,30,.04),rgba(20,36,30,.58)),url('/assets/booking/treatment-room-side.webp') center/cover;box-shadow:var(--shadow)}.hero-visual-card{position:absolute;left:22px;right:22px;bottom:22px;padding:20px;border-radius:18px;background:rgba(247,243,235,.93);backdrop-filter:blur(12px)}.hero-visual-card p{margin:7px 0 0;color:var(--muted);font-size:14px}.section{padding:58px 0}.section.alt{background:#edf2eb;border-block:1px solid rgba(36,53,47,.06)}.section-head{display:flex;justify-content:space-between;align-items:end;gap:32px;margin-bottom:25px}.section-head p{max-width:610px;color:var(--muted);margin:0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{background:var(--paper);border:1px solid rgba(36,53,47,.08);border-radius:20px;padding:22px;box-shadow:0 6px 22px rgba(36,53,47,.04)}.card p{color:var(--muted);font-size:14px}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.pill{background:#f1f4ef;border-radius:999px;padding:6px 9px;font-size:12px;font-weight:800}.pill.price{background:#e4eee1;color:var(--deep)}.card-link{display:inline-flex;margin-top:10px;font-weight:850;color:var(--deep);text-decoration:none}.story{display:grid;grid-template-columns:.8fr 1.2fr;gap:38px;align-items:center}.story-image{min-height:330px;border-radius:24px;background:url('/assets/booking/pedicure-side.webp') center/cover;box-shadow:var(--shadow)}.story p{color:var(--muted);font-size:17px}.page-hero{padding:64px 0 48px}.page-hero .shell{max-width:1180px}.category{padding:31px 0;border-top:1px solid var(--line)}.category:first-child{border-top:0}.category-label{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin-bottom:16px}.category-label h2{font-size:34px}.category-label small{color:var(--muted)}.fact-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.fact{border-radius:18px;padding:20px;background:rgba(255,255,255,.68);border:1px solid rgba(36,53,47,.07)}.fact strong{display:block;margin-bottom:6px}.fact span{color:var(--muted);font-size:14px}.signature{padding:38px 0;background:#5f584f;color:#fff}.signature-copy{width:min(1180px,calc(100% - 40px));margin:auto;text-align:center;padding:30px;border:1px solid rgba(255,255,255,.18);border-radius:22px;background:rgba(255,255,255,.04)}.signature-copy .eyebrow{color:#ead6a9}.signature-copy h2{margin:8px 0 10px}.signature-copy p{margin:0;color:#eee7dc}.prose{max-width:790px}.prose p{color:var(--muted);font-size:17px}.contact-panel{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.contact-panel .card{min-height:210px}.contact-email{font-size:clamp(24px,2.7vw,38px);overflow-wrap:anywhere}.contact-email a{text-decoration-thickness:1px;text-underline-offset:4px}.client-portal{padding:14px 0 58px}.client-portal-card{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:28px;padding:28px 30px;border-radius:24px;background:linear-gradient(135deg,#edf2eb,#fff);border:1px solid rgba(36,53,47,.09);box-shadow:0 10px 30px rgba(36,53,47,.06)}.client-portal-card h2{margin:7px 0 9px}.client-portal-card p{margin:0;color:var(--muted);max-width:700px}.client-portal-card small{display:block;margin-top:9px;color:#68766f;font-size:12px}.client-portal-card .button{white-space:nowrap}.mobile-book{display:none}${PUBLIC_CHROME_CSS}
.welcome-offer{background:linear-gradient(90deg,#354f42,#496354);color:#fff;border-bottom:1px solid rgba(255,255,255,.16)}.welcome-offer .shell{display:flex;align-items:center;justify-content:center;gap:18px;min-height:54px;padding-block:8px}.welcome-offer__copy{display:flex;align-items:baseline;gap:10px}.welcome-offer strong{font-family:Georgia,"Times New Roman",serif;font-size:20px}.welcome-offer span{font-size:13px;color:#f4efe6}.welcome-offer a{padding:8px 13px;border-radius:999px;background:#fff;color:var(--deep);font-size:12px;font-weight:900;text-decoration:none;white-space:nowrap}.category-discovery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:16px}.category-discovery-card{display:flex;min-width:0;flex-direction:column;overflow:hidden;border:1px solid rgba(36,53,47,.1);border-radius:22px;background:#fff;box-shadow:0 8px 28px rgba(36,53,47,.055)}.category-discovery-card__visual{min-height:172px;background-color:#e8ece6;background-position:center;background-size:cover}.category-discovery-card__visual--massage{background-image:linear-gradient(rgba(25,47,39,.08),rgba(25,47,39,.22)),url('/assets/booking/treatment-room-side.webp')}.category-discovery-card__visual--foot{background-image:linear-gradient(rgba(25,47,39,.06),rgba(25,47,39,.18)),url('/assets/booking/pedicure-side.webp');background-position:center 58%}.category-discovery-card__visual--aesthetic,.category-discovery-card__visual--other{background-color:#eee9dd;background-image:radial-gradient(circle at 82% 18%,rgba(138,102,47,.16),transparent 32%),linear-gradient(145deg,rgba(255,255,255,.72),rgba(220,232,218,.56)),url('/assets/brand/shiloh-mark-512.png?v=${PUBLIC_BRAND_ASSET_VERSION}');background-position:center,center,center;background-repeat:no-repeat;background-size:auto,auto,136px}.category-discovery-card__body{display:flex;flex:1;flex-direction:column;padding:21px}.category-discovery-card__top{display:flex;align-items:start;justify-content:space-between;gap:14px}.category-discovery-card__top h3{margin:0}.category-count{flex:0 0 auto;border-radius:999px;background:#edf2eb;color:var(--deep);padding:5px 8px;font-size:11px;font-weight:850}.category-discovery-card p{margin:10px 0 14px;color:var(--muted);font-size:14px}.category-examples{display:grid;gap:5px;list-style:none;margin:0;padding:0;color:#40534a;font-size:12px}.category-examples li::before{content:"·";margin-right:7px;color:var(--gold);font-weight:900}.category-more{display:block;margin-top:7px;color:#68766f;font-size:11px}.category-discovery-card .card-link{margin-top:auto;padding-top:17px}.service-category-nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px;padding:12px;border:1px solid rgba(36,53,47,.08);border-radius:18px;background:rgba(255,255,255,.72)}.service-category-nav a{display:inline-flex;min-height:42px;align-items:center;border:1px solid var(--line);border-radius:999px;background:#fff;padding:8px 12px;color:var(--deep);font-size:12px;font-weight:800;text-decoration:none}.service-category-nav a:hover,.service-category-nav a:focus-visible{border-color:var(--deep);box-shadow:0 0 0 2px rgba(41,75,62,.1)}.category{scroll-margin-top:108px}.category-intro{max-width:650px;margin:0 0 18px;color:var(--muted)}.local-story{display:grid;grid-template-columns:.78fr 1.22fr;gap:0;border-radius:26px;overflow:hidden;background:var(--deep);color:#fff;box-shadow:var(--shadow)}.local-story__image{min-height:470px;background:url('/assets/booking/pedicure-side.webp') center/cover}.local-story__copy{display:flex;flex-direction:column;justify-content:center;padding:42px}.local-story__copy .eyebrow{color:#ead6a9}.local-story__copy h2{max-width:660px}.local-story__copy p{margin:0 0 15px;color:#e5eee9;font-size:16px}.local-story__copy .button.primary{background:#fff;color:var(--deep);border-color:#fff}.local-story__copy .button.secondary{color:#fff;border-color:rgba(255,255,255,.65)}.neighbour-list{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:10px 0 3px;padding:0}.neighbour-list li{padding:7px 10px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(255,255,255,.08);font-size:12px;font-weight:750}.local-story__note{display:block;margin-top:11px;color:#cbd8d2;font-size:11px}.community-intro{max-width:900px;text-align:center}.community-intro p{max-width:760px;margin:0 auto;color:var(--muted);font-size:17px}.community-intro .actions{justify-content:center}.community-intro .neighbour-list{justify-content:center;margin-top:22px}.community-intro .neighbour-list li{border-color:var(--line);background:#fff;color:var(--ink)}
.reviews-section{overflow:hidden;background:#f3eee4}.reviews-heading{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:22px}.reviews-summary{margin:0;color:var(--muted)}.reviews-summary strong{color:var(--ink)}.reviews-controls{display:flex;gap:8px}.reviews-control{width:46px;height:46px;border:1px solid rgba(36,53,47,.2);border-radius:50%;background:#fff;color:var(--deep);font-size:21px;cursor:pointer}.reviews-control:disabled{opacity:.4;cursor:default}.reviews-rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(310px,calc((100% - 32px)/3));gap:16px;overflow-x:auto;padding:3px 2px 18px;scroll-snap-type:x mandatory;scrollbar-width:thin;scrollbar-color:#a8b4ad transparent}.review-card{display:flex;min-height:270px;scroll-snap-align:start;flex-direction:column;padding:24px;border:1px solid rgba(36,53,47,.09);border-radius:22px;background:#fff;box-shadow:0 8px 28px rgba(36,53,47,.055)}.review-stars{color:#a8792d;font-size:18px;letter-spacing:.08em}.review-text{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:6;margin:16px 0;color:var(--ink);font-family:Georgia,"Times New Roman",serif;font-size:19px;line-height:1.45}.review-author{display:flex;align-items:center;gap:11px;margin-top:auto}.review-author img,.review-author__initial{width:38px;height:38px;flex:0 0 38px;border-radius:50%;object-fit:cover}.review-author__initial{display:grid;place-items:center;background:var(--sage);color:var(--deep);font-weight:900}.review-author strong,.review-author small{display:block}.review-author small{color:var(--muted)}.review-author a{text-decoration-thickness:1px;text-underline-offset:3px}.review-source{display:inline-flex;margin-top:12px;color:var(--deep);font-size:12px;font-weight:800}.reviews-attribution{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-top:10px;color:var(--muted);font-size:12px}.reviews-attribution a{font-weight:800;color:var(--deep)}.google-maps-attribution{white-space:nowrap;color:#5e5e5e;font-family:Roboto,Arial,sans-serif;font-size:12px;font-style:normal;font-weight:400;letter-spacing:normal}
@media(max-width:900px){.home-hero-grid,.story,.local-story{grid-template-columns:1fr}.client-portal-card{grid-template-columns:1fr;align-items:start}.hero-visual{min-height:340px}.local-story__image{min-height:300px}.grid,.fact-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.contact-panel{grid-template-columns:1fr}.reviews-rail{grid-auto-columns:minmax(300px,calc((100% - 16px)/2))}}
@media(max-width:700px){.welcome-offer .shell{align-items:flex-start;gap:9px;flex-direction:column;padding-block:10px}.welcome-offer__copy{display:block}.welcome-offer strong{margin-right:6px}.welcome-offer a{align-self:stretch;text-align:center}}
@media(max-width:700px){body{padding-bottom:74px}.shell{width:calc(100% - 30px)}.home-hero,.page-hero{padding:42px 0 38px}.home-hero-grid{gap:26px}h1{font-size:46px}.lede{font-size:16px}.hero-visual{min-height:300px;border-radius:22px}.hero-visual-card{left:14px;right:14px;bottom:14px}.section{padding:40px 0}.section-head{display:block}.grid,.fact-grid{grid-template-columns:1fr}.category-discovery-grid{grid-template-columns:1fr}.category-discovery-card__visual{min-height:150px}.service-category-nav{flex-wrap:nowrap;overflow-x:auto;margin-right:-15px;padding-right:27px;scrollbar-width:none}.service-category-nav::-webkit-scrollbar{display:none}.service-category-nav a{flex:0 0 auto}.local-story{border-radius:20px}.local-story__image{min-height:235px}.local-story__copy{padding:28px 20px}.local-story__copy h2{font-size:34px}.neighbour-list{gap:6px}.neighbour-list li{padding:6px 8px;font-size:11px}.client-portal{padding:4px 0 40px}.client-portal-card{padding:22px 18px;border-radius:18px}.client-portal-card .button{width:100%}.category{padding:25px 0;scroll-margin-top:84px}.category-label{display:block}.category-label h2{font-size:30px}.button{width:100%}.reviews-heading{display:block}.reviews-controls{margin-top:16px}.reviews-rail{grid-auto-columns:calc(100% - 28px);margin-right:-15px;padding-right:15px}.review-card{min-height:250px;padding:20px}.reviews-attribution{align-items:flex-start;flex-direction:column}.signature{padding:24px 0}.signature-copy{width:calc(100% - 30px);padding:24px 18px;border-radius:16px}.mobile-book{position:fixed;z-index:35;display:flex;left:10px;right:10px;bottom:10px;min-height:54px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 35px rgba(20,40,32,.22);align-items:center;justify-content:space-between;padding:9px 14px;text-decoration:none}.mobile-book span{font-size:11px;color:var(--muted)}.mobile-book strong{font-size:13px;color:var(--deep)}}
`;

function layout({ title, description, currentPath, body }) {
  const canonical = `${PUBLIC_SITE_ORIGIN}${currentPath}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${canonical}"><link rel="icon" type="image/png" sizes="192x192" href="/assets/brand/shiloh-mark-192.png?v=${PUBLIC_BRAND_ASSET_VERSION}"><link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/shiloh-apple-touch-180.png?v=${PUBLIC_BRAND_ASSET_VERSION}"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)} | Shiloh"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${PUBLIC_SITE_ORIGIN}/assets/brand/shiloh-logo-full.jpg"><title>${escapeHtml(title)} | Shiloh</title><style>${SITE_CSS}</style></head><body>${renderSiteHeader(currentPath)}<aside class="welcome-offer" aria-label="My Shiloh welcome offer"><div class="shell"><div class="welcome-offer__copy"><strong>R100 welcome voucher</strong><span>Complete your first My Shiloh registration to unlock it.</span></div><a href="/my-shiloh/#welcome-voucher">Claim my R100</a></div></aside>${body}${renderSiteFooter()}<a class="mobile-book" href="/book"><span>Ready when you are</span><strong>View services &amp; book →</strong></a></body></html>`;
}

function serviceGroups(catalogue = []) {
  return groupPublicCatalogue(catalogue);
}

function serviceCategoryAnchor(category = '') {
  const slug = String(category || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `category-${slug || 'services'}`;
}

function serviceCategoryPresentation(category = '') {
  const label = String(category || '').toLowerCase();
  if (label === 'body & wellness') {
    return {
      visual: 'massage',
      visualLabel: 'Inside a calm Shiloh service room',
      copy: 'Explore supportive body and wellness services with clear timing and prices.',
    };
  }
  if (label === 'permanent makeup') {
    return {
      visual: 'aesthetic',
      visualLabel: 'Shiloh botanical mark',
      copy: 'Explore Shiloh’s permanent makeup choices and continue to book when you are ready.',
    };
  }
  if (label === 'advanced aesthetics') {
    return {
      visual: 'aesthetic',
      visualLabel: 'Shiloh botanical mark',
      copy: 'Explore Shiloh’s advanced aesthetic choices with clear timing and prices.',
    };
  }
  if (/pedicure|foot|feet|nail|gel/.test(label)) {
    return {
      visual: 'foot',
      visualLabel: 'Inside Shiloh’s pedicure care space',
      copy: 'Foot, nail and finishing care for time that feels entirely your own.',
    };
  }
  if (/facial|aesthetic|skin|brow|lash|wax/.test(label)) {
    return {
      visual: 'aesthetic',
      visualLabel: 'Shiloh botanical mark',
      copy: 'Explore Shiloh’s current aesthetic choices with clear timing and prices.',
    };
  }
  if (/massage|body|couple/.test(label)) {
    return {
      visual: 'massage',
      visualLabel: 'Inside a calm Shiloh massage room',
      copy: 'Unhurried massage choices for the kind of pause you need today.',
    };
  }
  return {
    visual: 'other',
    visualLabel: 'Shiloh botanical mark',
    copy: 'Explore this part of Shiloh’s current service collection at your own pace.',
  };
}

function serviceCategoryNavigation(groups) {
  if (!groups.size) return '';
  return `<nav class="service-category-nav" aria-label="Service categories" data-public-category-navigation>${[...groups.keys()].map((category) => `<a href="#${escapeHtml(serviceCategoryAnchor(category))}">${escapeHtml(category)}</a>`).join('')}</nav>`;
}

function serviceCategoryDiscoveryCard(category, services) {
  const presentation = serviceCategoryPresentation(category);
  const examples = services.slice(0, 2);
  const remaining = Math.max(0, services.length - examples.length);
  return `<article class="category-discovery-card" data-public-service-category="${escapeHtml(category)}"><div class="category-discovery-card__visual category-discovery-card__visual--${presentation.visual}" role="img" aria-label="${escapeHtml(presentation.visualLabel)}"></div><div class="category-discovery-card__body"><div class="category-discovery-card__top"><h3>${escapeHtml(category)}</h3><span class="category-count">${services.length} service${services.length === 1 ? '' : 's'}</span></div><p>${escapeHtml(presentation.copy)}</p><ul class="category-examples" aria-label="Examples from ${escapeHtml(category)}">${examples.map((service) => `<li>${escapeHtml(service.name)}</li>`).join('')}</ul>${remaining ? `<small class="category-more">+ ${remaining} more current choice${remaining === 1 ? '' : 's'}</small>` : ''}<a class="card-link" href="/treatments#${escapeHtml(serviceCategoryAnchor(category))}">Explore ${escapeHtml(category)} →</a></div></article>`;
}

function serviceCard(service) {
  const bookingPath = publicBookingPathForService(service);
  const description = service.description
    ? `<p class="service-description">${escapeHtml(service.description)}</p>`
    : '';
  return `<article class="card treatment-card" data-service-id="${escapeHtml(service.id)}"><h3>${escapeHtml(service.name)}</h3><div class="meta"><span class="pill">${escapeHtml(service.duration)}</span><span class="pill price">${escapeHtml(service.price)}</span></div>${description}<a class="card-link" href="${escapeHtml(bookingPath)}">Book this service →</a></article>`;
}

function signatureBlock() {
  return `<section class="signature"><div class="signature-copy"><div class="eyebrow">Inside Shiloh</div><h2>${escapeHtml(PUBLIC_TAGLINE)}</h2><p>Shiloh · ${escapeHtml(PUBLIC_BRAND_SUBTITLE)}</p></div></section>`;
}

function townCentreNeighbourList() {
  return `<ul class="neighbour-list" aria-label="Businesses near Shiloh">${SHILOH_TOWN_CENTRE_NEIGHBOURS.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`;
}

function reviewCard(review = {}) {
  const rating = Math.max(0, Math.min(5, Math.round(Number(review.rating) || 0)));
  const authorName = review.authorName || 'Google reviewer';
  const authorLabel = review.authorUrl
    ? `<a href="${escapeHtml(review.authorUrl)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(authorName)}</strong></a>`
    : `<strong>${escapeHtml(authorName)}</strong>`;
  const avatar = review.authorPhotoUrl
    ? `<img src="${escapeHtml(review.authorPhotoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="review-author__initial" aria-hidden="true">${escapeHtml(authorName.charAt(0).toUpperCase())}</span>`;
  const source = review.reviewUrl
    ? `<a class="review-source" href="${escapeHtml(review.reviewUrl)}" target="_blank" rel="noopener noreferrer">View review on Google Maps →</a>`
    : '';
  return `<article class="review-card"><div class="review-stars" aria-label="${rating} out of 5 stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div><p class="review-text">“${escapeHtml(review.text || '')}”</p><div class="review-author">${avatar}<div>${authorLabel}<small>${escapeHtml(review.relativePublishTime || '')}</small></div></div>${source}</article>`;
}

function buildGoogleReviewsMarkup(preview = null) {
  const place = preview?.place || {};
  const reviews = Array.isArray(preview?.reviews) ? preview.reviews : [];
  const summary = Number.isFinite(place.rating) && Number.isFinite(place.ratingCount)
    ? `<strong>${escapeHtml(place.rating)}</strong> from ${escapeHtml(place.ratingCount)} Google reviews`
    : 'Loading recent Google reviews…';
  const mapsUrl = place.mapsUrl || 'https://www.google.com/maps/search/?api=1&query=Shiloh%20Massage%20Therapy%20%26%20Aesthetic%20Clinic%20Heidelberg%20Gauteng';
  const cards = reviews.length
    ? reviews.map(reviewCard).join('')
    : '<article class="review-card"><p class="review-text">Loading recent client reviews…</p><div class="review-author"><span class="review-author__initial" aria-hidden="true">S</span><div><strong>Shiloh</strong><small>Google reviews</small></div></div></article>';
  return `<section class="section reviews-section" data-google-reviews><div class="shell"><div class="reviews-heading"><div><div class="eyebrow">Kind words from our clients</div><h2>Loved in Heidelberg.</h2><p class="reviews-summary" data-reviews-summary aria-live="polite">${summary}</p></div><div class="reviews-controls" aria-label="Review carousel controls"><button class="reviews-control" type="button" data-reviews-previous aria-label="Previous review">←</button><button class="reviews-control" type="button" data-reviews-next aria-label="Next review">→</button></div></div><div class="reviews-rail" data-reviews-rail aria-label="Google client reviews">${cards}</div><div class="reviews-attribution"><span>Reviews supplied by Google and shown with reviewer attribution.</span><a data-reviews-google-link href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">Read all reviews on Google →</a></div></div><script>(function(){'use strict';var root=document.querySelector('[data-google-reviews]');if(!root)return;var rail=root.querySelector('[data-reviews-rail]');var summary=root.querySelector('[data-reviews-summary]');var previous=root.querySelector('[data-reviews-previous]');var next=root.querySelector('[data-reviews-next]');var googleLink=root.querySelector('[data-reviews-google-link]');var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;var timer=null;function stars(rating){var value=Math.max(0,Math.min(5,Math.round(Number(rating)||0)));return {value:value,text:'★★★★★'.slice(0,value)+'☆☆☆☆☆'.slice(value)}}function author(review){var row=document.createElement('div');row.className='review-author';if(review.authorPhotoUrl){var image=document.createElement('img');image.src=review.authorPhotoUrl;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';row.appendChild(image)}else{var initial=document.createElement('span');initial.className='review-author__initial';initial.setAttribute('aria-hidden','true');initial.textContent=(review.authorName||'G').charAt(0).toUpperCase();row.appendChild(initial)}var copy=document.createElement('div');var name=document.createElement('strong');name.textContent=review.authorName||'Google reviewer';if(review.authorUrl){var link=document.createElement('a');link.href=review.authorUrl;link.target='_blank';link.rel='noopener noreferrer';link.appendChild(name);copy.appendChild(link)}else{copy.appendChild(name)}var time=document.createElement('small');time.textContent=review.relativePublishTime||'';copy.appendChild(time);row.appendChild(copy);return row}function render(data){if(!data||data.status!=='live'||!data.reviews||!data.reviews.length)return;rail.textContent='';data.reviews.forEach(function(review){var card=document.createElement('article');card.className='review-card';var score=stars(review.rating);var starsNode=document.createElement('div');starsNode.className='review-stars';starsNode.setAttribute('aria-label',score.value+' out of 5 stars');starsNode.textContent=score.text;card.appendChild(starsNode);var quote=document.createElement('p');quote.className='review-text';quote.textContent='“'+review.text+'”';card.appendChild(quote);card.appendChild(author(review));rail.appendChild(card)});if(data.place){if(Number.isFinite(data.place.rating)&&Number.isFinite(data.place.ratingCount)){summary.textContent='';var strong=document.createElement('strong');strong.textContent=String(data.place.rating);summary.appendChild(strong);summary.appendChild(document.createTextNode(' from '+data.place.ratingCount+' Google reviews'))}if(data.place.mapsUrl)googleLink.href=data.place.mapsUrl}updateControls();start()}function step(direction){var card=rail.querySelector('.review-card');if(!card)return;var gap=parseFloat(getComputedStyle(rail).columnGap)||16;rail.scrollBy({left:direction*(card.getBoundingClientRect().width+gap),behavior:reduce?'auto':'smooth'})}function updateControls(){var many=rail.querySelectorAll('.review-card').length>1;previous.disabled=!many;next.disabled=!many}function stop(){if(timer){window.clearInterval(timer);timer=null}}function start(){stop();if(!reduce&&rail.querySelectorAll('.review-card').length>1){timer=window.setInterval(function(){var atEnd=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-8;if(atEnd)rail.scrollTo({left:0,behavior:'smooth'});else step(1)},7000)}}previous.addEventListener('click',function(){step(-1)});next.addEventListener('click',function(){step(1)});root.addEventListener('mouseenter',stop);root.addEventListener('mouseleave',start);root.addEventListener('focusin',stop);root.addEventListener('focusout',start);root.addEventListener('touchstart',stop,{passive:true});updateControls();fetch('/reviews/google',{headers:{Accept:'application/json'}}).then(function(response){if(!response.ok)throw new Error('Reviews unavailable');return response.json()}).then(render).catch(function(){updateControls()});start()})();</script></section>`;
}

function googleReviewsSection(preview = null) {
  return buildGoogleReviewsMarkup(preview)
    .replace('data-reviews-rail aria-label=', 'data-reviews-rail tabindex="0" aria-label=')
    .replace(
      'Reviews supplied by Google and shown with reviewer attribution.',
      '<span class="google-maps-attribution" translate="no">Google Maps</span> · Reviews are shown in Google Maps relevance order.',
    )
    .replace('Read all reviews on Google →', 'Read all reviews on Google Maps →')
    .replace(
      'card.appendChild(author(review));rail.appendChild(card)',
      "card.appendChild(author(review));if(review.reviewUrl){var source=document.createElement('a');source.className='review-source';source.href=review.reviewUrl;source.target='_blank';source.rel='noopener noreferrer';source.textContent='View review on Google Maps →';card.appendChild(source)}rail.appendChild(card)",
    )
    .replace(
      "fetch('/reviews/google',{headers:{Accept:'application/json'}})",
      "fetch('/reviews/google',{headers:{Accept:'application/json'},cache:'no-store'})",
    );
}

function renderHome(catalogue = [], options = {}) {
  const groups = serviceGroups(catalogue);
  const discoveryMarkup = groups.size
    ? [...groups.entries()].map(([category, services]) => serviceCategoryDiscoveryCard(category, services)).join('')
    : '<article class="card"><h3>Explore our services</h3><p>Our live service list is temporarily unavailable. You can still continue to booking for help.</p><a class="card-link" href="/book">Continue to booking →</a></article>';
  return layout({
    title: PUBLIC_BRAND_SUBTITLE,
    description: `Discover ${PUBLIC_BRAND_NAME} in Heidelberg, Gauteng. Explore current services and book with Shiloh.`,
    currentPath: '/',
    body: `<main id="main-content"><section class="home-hero"><div class="shell home-hero-grid"><div><div class="eyebrow">In the heart of Heidelberg</div><h1>Feel cared for, from the first hello.</h1><p class="lede">Massage and aesthetic services at ${escapeHtml(SHILOH_PUBLIC_LOCATION.streetAddress)}, in Heidelberg’s newly renovated town centre. Explore what suits you and continue into one simple booking journey when you are ready.</p><div class="actions"><a class="button primary" href="/book">View services &amp; book</a><a class="button secondary" href="/about">Meet Shiloh</a></div></div><div class="hero-visual" role="img" aria-label="Inside a calm Shiloh room"><div class="hero-visual-card"><div class="eyebrow">Inside Shiloh</div><h3>${escapeHtml(PUBLIC_TAGLINE)}</h3><p>A calm, considered Shiloh experience in Heidelberg.</p></div></div></div></section><section class="section alt" data-public-service-discovery><div class="shell"><div class="section-head"><div><div class="eyebrow">Find what feels right</div><h2>What would you like today?</h2></div><p>Choose a category to explore Shiloh’s current services, timing and prices. Everything comes from the same live catalogue used for booking.</p></div><div class="category-discovery-grid">${discoveryMarkup}</div><div class="actions"><a class="button primary" href="/treatments">View all current services</a><a class="button secondary" href="/book#choose-with-shiloh">Not sure? Ask Shiloh</a></div></div></section>${googleReviewsSection(options.reviewPreview)}<section class="section"><div class="shell"><div class="local-story" data-public-visit-shiloh><div class="local-story__image" role="img" aria-label="Inside Shiloh’s pedicure care space"></div><div class="local-story__copy"><div class="eyebrow">Come visit Shiloh</div><h2>Come experience the new heart of Heidelberg.</h2><p>Shiloh is situated at ${escapeHtml(SHILOH_PUBLIC_LOCATION.streetAddress)}, in the heart of Heidelberg’s newly renovated town centre. Enjoy time for yourself at Shiloh, then discover the food, coffee and local businesses surrounding us.</p>${townCentreNeighbourList()}<small class="local-story__note">Our neighbours are independent local businesses. Please confirm their current details directly.</small><div class="actions"><a class="button primary" href="/contact">Plan your visit</a><a class="button secondary" href="/visit">Explore Heidelberg</a></div></div></div></div></section><section class="client-portal"><div class="shell"><div class="client-portal-card"><div><div class="eyebrow">For returning clients</div><h2>Already part of Shiloh?</h2><p>Open your private My Shiloh space to sign in securely, book again and stay close to Shiloh. Your appointment, form and payment views will live here as the client experience grows.</p><small>No app-store download required.</small></div><a class="button secondary" href="/my-shiloh/">Open My Shiloh</a></div></div></section>${signatureBlock()}</main>`,
  });
}

function renderTreatments(catalogue = []) {
  const groups = serviceGroups(catalogue);
  const content = groups.size
    ? [...groups.entries()]
        .map(
          ([category, services]) =>
            `<section class="category" id="${escapeHtml(serviceCategoryAnchor(category))}"><div class="category-label"><h2>${escapeHtml(category)}</h2><small>${services.length} service${services.length === 1 ? '' : 's'}</small></div><p class="category-intro">${escapeHtml(serviceCategoryPresentation(category).copy)}</p><div class="grid">${services.map(serviceCard).join('')}</div></section>`,
        )
        .join('')
    : '<section class="card"><h2>Services are temporarily unavailable</h2><p>Please continue to booking for assistance. We have not substituted a second catalogue.</p></section>';
  return layout({
    title: 'Services',
    description: 'Browse Shiloh’s current client-bookable massage and aesthetic services, timing and prices.',
    currentPath: '/treatments',
    body: `<main id="main-content"><section class="page-hero"><div class="shell"><div class="eyebrow">Services</div><h1>Choose with clarity.</h1><p class="lede">Browse current client-bookable services, timing and prices. When you select Book, you continue into Shiloh’s existing booking journey.</p><div class="actions"><a class="button primary" href="/book">View booking catalogue</a><a class="button secondary" href="/book#choose-with-shiloh">Not sure? Ask Shiloh</a></div></div></section><section class="section alt"><div class="shell" data-public-treatment-catalogue>${serviceCategoryNavigation(groups)}${content}</div></section></main>`,
  });
}

function renderAbout() {
  return layout({
    title: 'About',
    description: `Meet ${PUBLIC_BRAND_NAME} and discover our personal approach in Heidelberg.`,
    currentPath: '/about',
    body: `<main id="main-content"><section class="page-hero"><div class="shell prose"><div class="eyebrow">About Shiloh</div><h1>Care designed around the person in front of us.</h1><p class="lede">Shiloh brings massage and aesthetic services together in a calm Heidelberg setting, with a practical focus on clear choices and a personal client experience.</p><div class="actions"><a class="button primary" href="/book">Book with Shiloh</a><a class="button secondary" href="/treatments">Explore services</a></div></div></section><section class="section alt"><div class="shell fact-grid"><div class="fact"><strong>Personal</strong><span>A focused experience shaped around what you are looking for.</span></div><div class="fact"><strong>Clear</strong><span>Current service information leads into one trusted booking journey.</span></div><div class="fact"><strong>Local</strong><span>Visit Shiloh at 37 Jacobs Street in Heidelberg, Gauteng.</span></div></div></section>${signatureBlock()}</main>`,
  });
}

function renderContact() {
  return layout({
    title: 'Contact',
    description: `Plan your visit to ${PUBLIC_BRAND_NAME} at 37 Jacobs Street, Heidelberg, Gauteng.`,
    currentPath: '/contact',
    body: `<main id="main-content"><section class="page-hero"><div class="shell"><div class="eyebrow">Contact</div><h1>Come find Shiloh in Heidelberg.</h1><p class="lede">For service selection and appointment availability, use our booking journey. Your chosen service goes with you when you continue.</p></div></section><section class="section alt"><div class="shell contact-panel"><article class="card"><div class="eyebrow">Visit</div><h2>${escapeHtml(SHILOH_PUBLIC_LOCATION.streetAddress)}</h2><p>${escapeHtml(SHILOH_PUBLIC_LOCATION.locality)}, ${escapeHtml(SHILOH_PUBLIC_LOCATION.region)}, ${escapeHtml(SHILOH_PUBLIC_LOCATION.country)}</p></article><article class="card"><div class="eyebrow">Email</div><h2 class="contact-email"><a href="mailto:info@shilohmtc.co.za">info@shilohmtc.co.za</a></h2><p>Email us for general enquiries and follow-ups.</p></article><article class="card"><div class="eyebrow">Appointments</div><h2>Ready to book?</h2><p>See current services and prices, then continue with Shiloh to check availability.</p><a class="button primary" href="/book">View services &amp; book</a></article></div></section><section class="section"><div class="shell community-intro" data-public-town-centre><div class="eyebrow">Our Heidelberg neighbourhood</div><h2>Great neighbours make life more beautiful.</h2><p>Shiloh is part of a growing town-centre community. Make time for your treatment, slow down, and enjoy the food, coffee and everyday local businesses around us.</p>${townCentreNeighbourList()}<div class="actions"><a class="button secondary" href="/visit">Explore Heidelberg</a></div></div></section></main>`,
  });
}

function livePlacesWidget() {
  return `<section class="section alt"><div class="shell"><div class="section-head"><div><div class="eyebrow">Live local search</div><h2>Find places near Shiloh.</h2></div><p>Current listings are loaded from Google Maps when configured. Confirm details directly with each venue.</p></div><div class="actions"><button class="button primary" type="button" data-live-places-query="guesthouses and hotels">Find accommodation</button><button class="button secondary" type="button" data-live-places-query="places of interest and attractions">Find places to visit</button></div><div class="grid" data-live-places-results aria-live="polite"><article class="card"><p>Choose a search to load current local listings.</p></article></div></div><script>(function(){'use strict';var host=document.querySelector('[data-live-places-results]');if(!host)return;function load(query){host.textContent='';var loading=document.createElement('article');loading.className='card';loading.textContent='Loading current listings…';host.appendChild(loading);fetch('/visit/places?query='+encodeURIComponent(query),{headers:{Accept:'application/json'},cache:'no-store'}).then(function(r){return r.json()}).then(function(data){host.textContent='';if(!data.places||!data.places.length){var empty=document.createElement('article');empty.className='card';empty.textContent='Live search is not configured or returned no results. Use the accommodation starting points above.';host.appendChild(empty);return}data.places.forEach(function(place){var card=document.createElement('article');card.className='card';var title=document.createElement('h3');title.textContent=place.name||'Local place';card.appendChild(title);var details=document.createElement('p');details.textContent=[place.address,place.rating!==null?'Rating '+place.rating+(place.ratingCount?' ('+place.ratingCount+' reviews)':''):null,place.openNow===true?'Open now':place.openNow===false?'Currently closed':null,place.phone].filter(Boolean).join(' · ');card.appendChild(details);if(place.mapsUrl){var link=document.createElement('a');link.className='card-link';link.href=place.mapsUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open in Google Maps →';card.appendChild(link)}host.appendChild(card)})}).catch(function(){host.textContent='';var error=document.createElement('article');error.className='card';error.textContent='Live local search is temporarily unavailable. Please use the links above or contact the venue directly.';host.appendChild(error)})}document.querySelectorAll('[data-live-places-query]').forEach(function(button){button.addEventListener('click',function(){load(button.getAttribute('data-live-places-query'))})})})();</script></section>`;
}

function renderVisit() {
  return layout({
    title: 'Visit Heidelberg',
    description: 'Plan a Heidelberg, Gauteng visit with local places of interest and accommodation starting points near Shiloh.',
    currentPath: '/visit',
    body: `<main id="main-content"><section class="page-hero"><div class="shell prose"><div class="eyebrow">Visit Heidelberg</div><h1>Make a little time for Heidelberg.</h1><p class="lede">Coming to Shiloh from out of town? Here are a few local starting points for nature, heritage and a comfortable place to stay.</p><div class="actions"><a class="button primary" href="/book">Book with Shiloh</a><a class="button secondary" href="/contact">Find us</a></div></div></section>${livePlacesWidget()}<section class="section alt"><div class="shell"><div class="section-head"><div><div class="eyebrow">Places of interest</div><h2>Explore the town and its surroundings.</h2></div><p>Check current access, opening times and tour arrangements directly before travelling.</p></div><div class="grid"><article class="card"><h3>Suikerbosrand Nature Reserve</h3><p>A nearby Gauteng nature destination for scenic drives, hiking and outdoor time.</p><a class="card-link" href="https://www.gov.za/about-sa/tourism" rel="noopener noreferrer">Gauteng tourism overview →</a></article><article class="card"><h3>Heidelberg Heritage Museum</h3><p>A restored railway-station precinct with local history and railway heritage experiences.</p><a class="card-link" href="https://visit.gauteng.net/visit/the-heidelberg-heritage-museum-vg" rel="noopener noreferrer">Visit Gauteng →</a></article><article class="card"><h3>Heidelberg heritage</h3><p>Historic buildings and local stories make the town centre worth exploring at an unhurried pace.</p><a class="card-link" href="https://www.sedibeng.gov.za/tourism_vaal.html" rel="noopener noreferrer">Sedibeng tourism routes →</a></article></div></div></section><section class="section"><div class="shell"><div class="section-head"><div><div class="eyebrow">Places to stay</div><h2>Accommodation starting points.</h2></div><p>These are independent venues. Contact them directly to confirm current rates, availability and facilities.</p></div><div class="grid"><article class="card"><h3>Heidelberg Lodge</h3><p>Guesthouse accommodation at 27 Jacobs Street, Heidelberg.</p><a class="card-link" href="https://heidelberglodge.co.za/" rel="noopener noreferrer">View Heidelberg Lodge →</a></article><article class="card"><h3>Suikerbosrand Guesthouse</h3><p>A local Heidelberg guesthouse with direct contact details online.</p><a class="card-link" href="https://www.suikerbosrandguesthouse.co.za/contact-us/" rel="noopener noreferrer">Contact Suikerbosrand Guesthouse →</a></article><article class="card"><h3>Picanha Guesthouse</h3><p>Self-catering accommodation in Heidelberg.</p><a class="card-link" href="https://picanhaguesthouse.co.za/" rel="noopener noreferrer">View Picanha Guesthouse →</a></article></div></div></section>${signatureBlock()}</main>`,
  });
}

function buildPrivacyPage() {
  return layout({
    title: 'Privacy Policy',
    description: `How ${PUBLIC_BRAND_NAME} collects, uses and protects personal information.`,
    currentPath: '/privacy',
    body: `<main id="main-content"><section class="page-hero"><div class="shell prose"><div class="eyebrow">Privacy</div><h1>Your information, handled with care.</h1><p class="lede">This policy explains how ${escapeHtml(PUBLIC_BRAND_NAME)} processes personal information when you contact us, use our website or WhatsApp assistant, or make and manage an appointment.</p><p><strong>Effective date:</strong> 13 September 2026</p></div></section><section class="section alt"><div class="shell prose"><h2>Information we process</h2><p>We may process your name, cellphone number, messages, appointment details, service choices, communication preferences, and information you choose to provide about your appointment needs. We also keep limited technical and security records needed to operate and protect Shiloh.</p><h2>Why we use it</h2><p>We use personal information to answer enquiries, identify and assist clients, arrange and manage appointments, send relevant service messages, maintain accurate business records, protect our services, and meet legal obligations. We use it only for a lawful, relevant purpose.</p><h2>Service providers</h2><p>Shiloh uses trusted providers where needed to deliver its services, including Meta and WhatsApp for messaging, Render for application and database hosting, OpenAI for assisted message responses, and Google for calendar operations. These providers process limited information for the service they supply and may process it outside South Africa under their applicable safeguards.</p><h2>Retention and security</h2><p>We keep personal information only for as long as it is reasonably needed for business operations, security, legal obligations, and legitimate record keeping. Shiloh applies access controls, secure connections, protected credentials, and data-minimisation measures. No internet service can promise absolute security, but we work to prevent unauthorised access, loss, misuse, or disclosure.</p><h2>Your choices and rights</h2><p>You may ask us to explain the information we hold about you, correct inaccurate information, or consider a deletion, restriction, or objection request where the law allows. You may also withdraw optional communication preferences. Some appointment or transaction records may need to be retained for lawful reasons.</p><h2>Contact Shiloh</h2><p>For a privacy question or request, contact Shiloh through our official WhatsApp conversation or visit us at 37 Jacobs Street, Heidelberg, Gauteng. We may need to verify your identity before acting on a request.</p><h2>Updates</h2><p>We may update this policy when our services or legal duties change. The current version and effective date will remain available on this page.</p></div></section></main>`,
  });
}

function renderPrivacy() {
  return buildPrivacyPage().replace(
    'and Google for calendar operations.',
    'and Google for calendar and Google Maps review services. Google services are governed by Google’s <a href="https://policies.google.com/terms" rel="noopener noreferrer">Terms of Service</a> and <a href="https://policies.google.com/privacy" rel="noopener noreferrer">Privacy Policy</a>.',
  );
}

module.exports = {
  PUBLIC_SITE_ORIGIN,
  escapeHtml,
  renderHome,
  googleReviewsSection,
  renderTreatments,
  renderAbout,
  renderContact,
  renderVisit,
  renderPrivacy,
  serviceGroups,
  serviceCategoryAnchor,
  serviceCategoryPresentation,
};
