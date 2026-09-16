const { PUBLIC_CHROME_CSS, renderSiteHeader, renderSiteFooter } = require('./publicSiteChrome');
const {
  PUBLIC_BRAND_NAME,
  PUBLIC_BRAND_SUBTITLE,
  PUBLIC_TAGLINE,
  sanitizePublicCatalogue,
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
:root{--ink:#24352f;--muted:#53625c;--cream:#f7f3eb;--paper:#fff;--sage:#dce8da;--deep:#294b3e;--line:#dce2dd;--gold:#8a662f;--shadow:0 18px 50px rgba(36,53,47,.1)}*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--cream)}body{margin:0;color:var(--ink);background:var(--cream);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}a{color:inherit}.shell{width:min(1180px,calc(100% - 40px));margin:auto}.eyebrow{text-transform:uppercase;letter-spacing:.17em;font-size:11px;font-weight:850;color:var(--gold)}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.028em}h1{font-size:clamp(48px,6vw,78px);line-height:.98;margin:14px 0 20px}h2{font-size:clamp(34px,4vw,50px);line-height:1.04;margin:8px 0 14px}h3{font-size:24px;line-height:1.15;margin:0 0 10px}.lede{font-size:18px;color:var(--muted);max-width:690px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:27px}.button{min-height:48px;display:inline-flex;align-items:center;justify-content:center;padding:12px 19px;border-radius:12px;text-decoration:none;font-weight:850;border:1px solid var(--deep)}.button.primary{background:var(--deep);color:#fff}.button.secondary{background:transparent;color:var(--deep)}.home-hero{padding:62px 0 58px}.home-hero-grid{display:grid;grid-template-columns:1.03fr .97fr;gap:42px;align-items:center}.hero-visual{min-height:500px;border-radius:30px;overflow:hidden;position:relative;background:linear-gradient(180deg,rgba(20,36,30,.04),rgba(20,36,30,.58)),url('/assets/booking/treatment-room-side.webp') center/cover;box-shadow:var(--shadow)}.hero-visual-card{position:absolute;left:22px;right:22px;bottom:22px;padding:20px;border-radius:18px;background:rgba(247,243,235,.93);backdrop-filter:blur(12px)}.hero-visual-card p{margin:7px 0 0;color:var(--muted);font-size:14px}.section{padding:58px 0}.section.alt{background:#edf2eb;border-block:1px solid rgba(36,53,47,.06)}.section-head{display:flex;justify-content:space-between;align-items:end;gap:32px;margin-bottom:25px}.section-head p{max-width:610px;color:var(--muted);margin:0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{background:var(--paper);border:1px solid rgba(36,53,47,.08);border-radius:20px;padding:22px;box-shadow:0 6px 22px rgba(36,53,47,.04)}.card p{color:var(--muted);font-size:14px}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.pill{background:#f1f4ef;border-radius:999px;padding:6px 9px;font-size:12px;font-weight:800}.pill.price{background:#e4eee1;color:var(--deep)}.card-link{display:inline-flex;margin-top:10px;font-weight:850;color:var(--deep);text-decoration:none}.story{display:grid;grid-template-columns:.8fr 1.2fr;gap:38px;align-items:center}.story-image{min-height:330px;border-radius:24px;background:url('/assets/booking/pedicure-side.webp') center/cover;box-shadow:var(--shadow)}.story p{color:var(--muted);font-size:17px}.page-hero{padding:64px 0 48px}.page-hero .shell{max-width:1180px}.category{padding:31px 0;border-top:1px solid var(--line)}.category:first-child{border-top:0}.category-label{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin-bottom:16px}.category-label h2{font-size:34px}.category-label small{color:var(--muted)}.fact-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.fact{border-radius:18px;padding:20px;background:rgba(255,255,255,.68);border:1px solid rgba(36,53,47,.07)}.fact strong{display:block;margin-bottom:6px}.fact span{color:var(--muted);font-size:14px}.signature{padding:38px 0;background:#5f584f;color:#fff}.signature-copy{width:min(1180px,calc(100% - 40px));margin:auto;text-align:center;padding:30px;border:1px solid rgba(255,255,255,.18);border-radius:22px;background:rgba(255,255,255,.04)}.signature-copy .eyebrow{color:#ead6a9}.signature-copy h2{margin:8px 0 10px}.signature-copy p{margin:0;color:#eee7dc}.prose{max-width:790px}.prose p{color:var(--muted);font-size:17px}.contact-panel{display:grid;grid-template-columns:1fr 1fr;gap:18px}.contact-panel .card{min-height:210px}.mobile-book{display:none}${PUBLIC_CHROME_CSS}
@media(max-width:900px){.home-hero-grid,.story{grid-template-columns:1fr}.hero-visual{min-height:340px}.grid,.fact-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.contact-panel{grid-template-columns:1fr}}
@media(max-width:700px){body{padding-bottom:74px}.shell{width:calc(100% - 30px)}.home-hero,.page-hero{padding:42px 0 38px}.home-hero-grid{gap:26px}h1{font-size:46px}.lede{font-size:16px}.hero-visual{min-height:300px;border-radius:22px}.hero-visual-card{left:14px;right:14px;bottom:14px}.section{padding:40px 0}.section-head{display:block}.grid,.fact-grid{grid-template-columns:1fr}.category{padding:25px 0}.category-label{display:block}.category-label h2{font-size:30px}.button{width:100%}.signature{padding:24px 0}.signature-copy{width:calc(100% - 30px);padding:24px 18px;border-radius:16px}.mobile-book{position:fixed;z-index:35;display:flex;left:10px;right:10px;bottom:10px;min-height:54px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 35px rgba(20,40,32,.22);align-items:center;justify-content:space-between;padding:9px 14px;text-decoration:none}.mobile-book span{font-size:11px;color:var(--muted)}.mobile-book strong{font-size:13px;color:var(--deep)}}
`;

function layout({ title, description, currentPath, body }) {
  const canonical = `https://app.shilohmtc.co.za${currentPath}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)} | Shiloh"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}"><title>${escapeHtml(title)} | Shiloh</title><style>${SITE_CSS}</style></head><body>${renderSiteHeader(currentPath)}${body}${renderSiteFooter()}<a class="mobile-book" href="/book"><span>Ready when you are</span><strong>View services &amp; book →</strong></a></body></html>`;
}

function serviceGroups(catalogue = []) {
  const groups = new Map();
  for (const service of catalogue) {
    if (!groups.has(service.category)) groups.set(service.category, []);
    groups.get(service.category).push(service);
  }
  return groups;
}

function serviceCard(service) {
  return `<article class="card treatment-card" data-service-id="${escapeHtml(service.id)}"><h3>${escapeHtml(service.name)}</h3><div class="meta"><span class="pill">${escapeHtml(service.duration)}</span><span class="pill price">${escapeHtml(service.price)}</span></div><a class="card-link" href="/book">Book this service →</a></article>`;
}

function signatureBlock() {
  return `<section class="signature"><div class="signature-copy"><div class="eyebrow">Inside Shiloh</div><h2>${escapeHtml(PUBLIC_TAGLINE)}</h2><p>Shiloh · ${escapeHtml(PUBLIC_BRAND_SUBTITLE)}</p></div></section>`;
}

function renderHome(catalogue = []) {
  const publicCatalogue = sanitizePublicCatalogue(catalogue);
  const featured = publicCatalogue.slice(0, 3);
  const featuredMarkup = featured.length
    ? featured.map(serviceCard).join('')
    : '<article class="card"><h3>Explore our services</h3><p>Our live service list is temporarily unavailable. You can still continue to booking for help.</p><a class="card-link" href="/book">Continue to booking →</a></article>';
  return layout({
    title: PUBLIC_BRAND_SUBTITLE,
    description: `Discover ${PUBLIC_BRAND_NAME} in Heidelberg, Gauteng. Explore current services and book with Shiloh.`,
    currentPath: '/',
    body: `<main id="main-content"><section class="home-hero"><div class="shell home-hero-grid"><div><div class="eyebrow">Massage and aesthetic services</div><h1>Feel cared for, from the first hello.</h1><p class="lede">Discover Shiloh’s current services, find what suits you, and continue into one simple booking journey when you are ready.</p><div class="actions"><a class="button primary" href="/book">View services &amp; book</a><a class="button secondary" href="/about">Meet Shiloh</a></div></div><div class="hero-visual" role="img" aria-label="Inside a calm Shiloh room"><div class="hero-visual-card"><div class="eyebrow">Inside Shiloh</div><h3>${escapeHtml(PUBLIC_TAGLINE)}</h3><p>A calm, considered Shiloh experience in Heidelberg.</p></div></div></div></section><section class="section alt"><div class="shell"><div class="section-head"><div><div class="eyebrow">Current services</div><h2>Start with what you need.</h2></div><p>These services come directly from the same live catalogue used for booking, so names, timing and prices stay aligned.</p></div><div class="grid">${featuredMarkup}</div><div class="actions"><a class="button secondary" href="/treatments">Explore all services</a></div></div></section><section class="section"><div class="shell story"><div class="story-image" role="img" aria-label="Inside Shiloh’s pedicure care space"></div><div><div class="eyebrow">The Shiloh experience</div><h2>Personal care, without the guesswork.</h2><p>Browse with clarity, choose what feels right, and let Shiloh guide the final appointment details. Availability is checked during the existing booking journey.</p><div class="actions"><a class="button primary" href="/book">Book with Shiloh</a><a class="button secondary" href="/contact">Plan your visit</a></div></div></div></section>${signatureBlock()}</main>`,
  });
}

function renderTreatments(catalogue = []) {
  const groups = serviceGroups(sanitizePublicCatalogue(catalogue));
  const content = groups.size
    ? [...groups.entries()]
        .map(
          ([category, services]) =>
            `<section class="category"><div class="category-label"><h2>${escapeHtml(category)}</h2><small>${services.length} service${services.length === 1 ? '' : 's'}</small></div><div class="grid">${services.map(serviceCard).join('')}</div></section>`,
        )
        .join('')
    : '<section class="card"><h2>Services are temporarily unavailable</h2><p>Please continue to booking for assistance. We have not substituted a second catalogue.</p></section>';
  return layout({
    title: 'Services',
    description: 'Browse Shiloh’s current client-bookable massage and aesthetic services, timing and prices.',
    currentPath: '/treatments',
    body: `<main id="main-content"><section class="page-hero"><div class="shell"><div class="eyebrow">Services</div><h1>Choose with clarity.</h1><p class="lede">Browse current client-bookable services, timing and prices. When you select Book, you continue into Shiloh’s existing booking journey.</p><div class="actions"><a class="button primary" href="/book">View booking catalogue</a></div></div></section><section class="section alt"><div class="shell" data-public-treatment-catalogue>${content}</div></section></main>`,
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
    body: `<main id="main-content"><section class="page-hero"><div class="shell"><div class="eyebrow">Contact</div><h1>Come find Shiloh in Heidelberg.</h1><p class="lede">For service selection and appointment availability, use our booking journey. Your chosen service goes with you when you continue.</p></div></section><section class="section alt"><div class="shell contact-panel"><article class="card"><div class="eyebrow">Visit</div><h2>37 Jacobs Street</h2><p>Heidelberg, Gauteng, South Africa</p></article><article class="card"><div class="eyebrow">Appointments</div><h2>Ready to book?</h2><p>See current services and prices, then continue with Shiloh to check availability.</p><a class="button primary" href="/book">View services &amp; book</a></article></div></section></main>`,
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
    body: `<main id="main-content"><section class="page-hero"><div class="shell prose"><div class="eyebrow">Visit Heidelberg</div><h1>Make a little time for Heidelberg.</h1><p class="lede">Coming to Shiloh from out of town? Here are a few local starting points for nature, heritage and a comfortable place to stay.</p><div class="actions"><a class="button primary" href="/book">Book with Shiloh</a><a class="button secondary" href="/contact">Find us</a></div></div></section>${livePlacesWidget()}<section class="section alt"><div class="shell"><div class="section-head"><div><div class="eyebrow">Places of interest</div><h2>Explore the town and its surroundings.</h2></div><p>Check current access, opening times and tour arrangements directly before travelling.</p></div><div class="grid"><article class="card"><h3>Suikerbosrand Nature Reserve</h3><p>A nearby Gauteng nature destination for scenic drives, hiking and outdoor time.</p><a class="card-link" href="https://www.gov.za/about-sa/tourism" rel="noopener noreferrer">Gauteng tourism overview →</a></article><article class="card"><h3>Heidelberg Heritage Museum</h3><p>A restored railway-station precinct with local history and railway heritage experiences.</p><a class="card-link" href="https://visit.gauteng.net/visit/the-heidelberg-heritage-museum-vg" rel="noopener noreferrer">Visit Gauteng →</a></article><article class="card"><h3>Heidelberg heritage</h3><p>Historic buildings and local stories make the town centre worth exploring at an unhurried pace.</p><a class="card-link" href="https://www.sedibeng.gov.za/tourism_vaal.html" rel="noopener noreferrer">Sedibeng tourism routes →</a></article></div></div></section><section class="section"><div class="shell"><div class="section-head"><div><div class="eyebrow">Places to stay</div><h2>Accommodation starting points.</h2></div><p>These are independent venues and directories. Contact them directly to confirm current rates, availability and facilities.</p></div><div class="grid"><article class="card"><h3>Heidelberg Lodge</h3><p>Guesthouse accommodation at 27 Jacobs Street, Heidelberg.</p><a class="card-link" href="https://heidelberglodge.co.za/" rel="noopener noreferrer">View Heidelberg Lodge →</a></article><article class="card"><h3>Suikerbosrand Guesthouse</h3><p>A local Heidelberg guesthouse with direct contact details online.</p><a class="card-link" href="https://www.suikerbosrandguesthouse.co.za/contact-us/" rel="noopener noreferrer">Contact Suikerbosrand Guesthouse →</a></article><article class="card"><h3>Picanha Guesthouse</h3><p>Self-catering accommodation in Heidelberg.</p><a class="card-link" href="https://picanhaguesthouse.co.za/" rel="noopener noreferrer">View Picanha Guesthouse →</a></article><article class="card"><h3>Hello Heidelberg</h3><p>A local accommodation and travel hub with guesthouses, hotels, B&amp;Bs and self-catering options.</p><a class="card-link" href="https://www.helloheidelberg.co.za/accommodation-travel" rel="noopener noreferrer">Browse the local directory →</a></article></div></div></section>${signatureBlock()}</main>`,
  });
}

function renderPrivacy() {
  return layout({
    title: 'Privacy Policy',
    description: `How ${PUBLIC_BRAND_NAME} collects, uses and protects personal information.`,
    currentPath: '/privacy',
    body: `<main id="main-content"><section class="page-hero"><div class="shell prose"><div class="eyebrow">Privacy</div><h1>Your information, handled with care.</h1><p class="lede">This policy explains how ${escapeHtml(PUBLIC_BRAND_NAME)} processes personal information when you contact us, use our website or WhatsApp assistant, or make and manage an appointment.</p><p><strong>Effective date:</strong> 13 September 2026</p></div></section><section class="section alt"><div class="shell prose"><h2>Information we process</h2><p>We may process your name, cellphone number, messages, appointment details, service choices, communication preferences, and information you choose to provide about your appointment needs. We also keep limited technical and security records needed to operate and protect Shiloh.</p><h2>Why we use it</h2><p>We use personal information to answer enquiries, identify and assist clients, arrange and manage appointments, send relevant service messages, maintain accurate business records, protect our services, and meet legal obligations. We use it only for a lawful, relevant purpose.</p><h2>Service providers</h2><p>Shiloh uses trusted providers where needed to deliver its services, including Meta and WhatsApp for messaging, Render for application and database hosting, OpenAI for assisted message responses, and Google for calendar operations. These providers process limited information for the service they supply and may process it outside South Africa under their applicable safeguards.</p><h2>Retention and security</h2><p>We keep personal information only for as long as it is reasonably needed for business operations, security, legal obligations, and legitimate record keeping. Shiloh applies access controls, secure connections, protected credentials, and data-minimisation measures. No internet service can promise absolute security, but we work to prevent unauthorised access, loss, misuse, or disclosure.</p><h2>Your choices and rights</h2><p>You may ask us to explain the information we hold about you, correct inaccurate information, or consider a deletion, restriction, or objection request where the law allows. You may also withdraw optional communication preferences. Some appointment or transaction records may need to be retained for lawful reasons.</p><h2>Contact Shiloh</h2><p>For a privacy question or request, contact Shiloh through our official WhatsApp conversation or visit us at 37 Jacobs Street, Heidelberg, Gauteng. We may need to verify your identity before acting on a request.</p><h2>Updates</h2><p>We may update this policy when our services or legal duties change. The current version and effective date will remain available on this page.</p></div></section></main>`,
  });
}

module.exports = {
  escapeHtml,
  renderHome,
  renderTreatments,
  renderAbout,
  renderContact,
  renderVisit,
  renderPrivacy,
  serviceGroups,
};
