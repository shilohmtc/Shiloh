const { PUBLIC_CHROME_CSS, renderSiteHeader, renderSiteFooter } = require('./publicSiteChrome');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const SITE_CSS = `
:root{--ink:#24352f;--muted:#53625c;--cream:#f7f3eb;--paper:#fff;--sage:#dce8da;--deep:#294b3e;--line:#dce2dd;--gold:#8a662f;--shadow:0 18px 50px rgba(36,53,47,.1)}*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--cream)}body{margin:0;color:var(--ink);background:var(--cream);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}a{color:inherit}.shell{width:min(1180px,calc(100% - 40px));margin:auto}.eyebrow{text-transform:uppercase;letter-spacing:.17em;font-size:11px;font-weight:850;color:var(--gold)}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.028em}h1{font-size:clamp(48px,6vw,78px);line-height:.98;margin:14px 0 20px}h2{font-size:clamp(34px,4vw,50px);line-height:1.04;margin:8px 0 14px}h3{font-size:24px;line-height:1.15;margin:0 0 10px}.lede{font-size:18px;color:var(--muted);max-width:690px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:27px}.button{min-height:48px;display:inline-flex;align-items:center;justify-content:center;padding:12px 19px;border-radius:12px;text-decoration:none;font-weight:850;border:1px solid var(--deep)}.button.primary{background:var(--deep);color:#fff}.button.secondary{background:transparent;color:var(--deep)}.home-hero{padding:62px 0 58px}.home-hero-grid{display:grid;grid-template-columns:1.03fr .97fr;gap:42px;align-items:center}.hero-visual{min-height:500px;border-radius:30px;overflow:hidden;position:relative;background:linear-gradient(180deg,rgba(20,36,30,.04),rgba(20,36,30,.58)),url('/assets/booking/treatment-room-side.webp') center/cover;box-shadow:var(--shadow)}.hero-visual-card{position:absolute;left:22px;right:22px;bottom:22px;padding:20px;border-radius:18px;background:rgba(247,243,235,.93);backdrop-filter:blur(12px)}.hero-visual-card p{margin:7px 0 0;color:var(--muted);font-size:14px}.section{padding:58px 0}.section.alt{background:#edf2eb;border-block:1px solid rgba(36,53,47,.06)}.section-head{display:flex;justify-content:space-between;align-items:end;gap:32px;margin-bottom:25px}.section-head p{max-width:610px;color:var(--muted);margin:0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{background:var(--paper);border:1px solid rgba(36,53,47,.08);border-radius:20px;padding:22px;box-shadow:0 6px 22px rgba(36,53,47,.04)}.card p{color:var(--muted);font-size:14px}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.pill{background:#f1f4ef;border-radius:999px;padding:6px 9px;font-size:12px;font-weight:800}.pill.price{background:#e4eee1;color:var(--deep)}.card-link{display:inline-flex;margin-top:10px;font-weight:850;color:var(--deep);text-decoration:none}.story{display:grid;grid-template-columns:.8fr 1.2fr;gap:38px;align-items:center}.story-image{min-height:330px;border-radius:24px;background:url('/assets/booking/pedicure-side.webp') center/cover;box-shadow:var(--shadow)}.story p{color:var(--muted);font-size:17px}.page-hero{padding:64px 0 48px}.page-hero .shell{max-width:1180px}.category{padding:31px 0;border-top:1px solid var(--line)}.category:first-child{border-top:0}.category-label{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin-bottom:16px}.category-label h2{font-size:34px}.category-label small{color:var(--muted)}.fact-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.fact{border-radius:18px;padding:20px;background:rgba(255,255,255,.68);border:1px solid rgba(36,53,47,.07)}.fact strong{display:block;margin-bottom:6px}.fact span{color:var(--muted);font-size:14px}.signature{padding:26px 0;background:#5f584f}.signature img{display:block;width:min(1500px,calc(100% - 28px));height:auto;margin:auto;border-radius:18px}.prose{max-width:790px}.prose p{color:var(--muted);font-size:17px}.contact-panel{display:grid;grid-template-columns:1fr 1fr;gap:18px}.contact-panel .card{min-height:210px}.mobile-book{display:none}${PUBLIC_CHROME_CSS}
@media(max-width:900px){.home-hero-grid,.story{grid-template-columns:1fr}.hero-visual{min-height:340px}.grid,.fact-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.contact-panel{grid-template-columns:1fr}}
@media(max-width:700px){body{padding-bottom:74px}.shell{width:calc(100% - 30px)}.home-hero,.page-hero{padding:42px 0 38px}.home-hero-grid{gap:26px}h1{font-size:46px}.lede{font-size:16px}.hero-visual{min-height:300px;border-radius:22px}.hero-visual-card{left:14px;right:14px;bottom:14px}.section{padding:40px 0}.section-head{display:block}.grid,.fact-grid{grid-template-columns:1fr}.category{padding:25px 0}.category-label{display:block}.category-label h2{font-size:30px}.button{width:100%}.signature img{width:calc(100% - 18px);border-radius:13px}.mobile-book{position:fixed;z-index:35;display:flex;left:10px;right:10px;bottom:10px;min-height:54px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 35px rgba(20,40,32,.22);align-items:center;justify-content:space-between;padding:9px 14px;text-decoration:none}.mobile-book span{font-size:11px;color:var(--muted)}.mobile-book strong{font-size:13px;color:var(--deep)}}
`;

function layout({ title, description, currentPath, body }) {
  const canonical = `https://app.shilohmtc.co.za${currentPath}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)} | Shiloh"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}"><title>${escapeHtml(title)} | Shiloh</title><style>${SITE_CSS}</style></head><body>${renderSiteHeader(currentPath)}${body}${renderSiteFooter()}<a class="mobile-book" href="/book"><span>Ready when you are</span><strong>View treatments &amp; book →</strong></a></body></html>`;
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
  const description = service.description ? `<p>${escapeHtml(service.description)}</p>` : '';
  return `<article class="card treatment-card" data-service-id="${escapeHtml(service.id)}"><h3>${escapeHtml(service.name)}</h3><div class="meta"><span class="pill">${escapeHtml(service.duration)}</span><span class="pill price">${escapeHtml(service.price)}</span></div>${description}<a class="card-link" href="/book">Book this treatment →</a></article>`;
}

function renderHome(catalogue = []) {
  const featured = catalogue.slice(0, 3);
  const featuredMarkup = featured.length
    ? featured.map(serviceCard).join('')
    : '<article class="card"><h3>Explore our treatments</h3><p>Our live treatment list is temporarily unavailable. You can still continue to booking for help.</p><a class="card-link" href="/book">Continue to booking →</a></article>';
  return layout({
    title: 'Massage Therapy and Aesthetic Clinic',
    description:
      'Discover Shiloh Massage Therapy and Aesthetic Clinic in Heidelberg, Gauteng. Explore current treatments and book with Shiloh.',
    currentPath: '/',
    body: `<main id="main-content"><section class="home-hero"><div class="shell home-hero-grid"><div><div class="eyebrow">Massage therapy and aesthetic care</div><h1>Feel cared for, from the first hello.</h1><p class="lede">Discover Shiloh’s current treatments, find the care that suits you, and continue into one simple booking journey when you are ready.</p><div class="actions"><a class="button primary" href="/book">View treatments &amp; book</a><a class="button secondary" href="/about">Meet Shiloh</a></div></div><div class="hero-visual" role="img" aria-label="Inside a calm Shiloh treatment room"><div class="hero-visual-card"><div class="eyebrow">Inside Shiloh</div><h3>Clinical care. Personal touch.</h3><p>A calm, considered clinic experience in Heidelberg.</p></div></div></div></section><section class="section alt"><div class="shell"><div class="section-head"><div><div class="eyebrow">Current treatments</div><h2>Start with what you need.</h2></div><p>These treatments come directly from the same live catalogue used for booking, so names, timing and prices stay aligned.</p></div><div class="grid">${featuredMarkup}</div><div class="actions"><a class="button secondary" href="/treatments">Explore all treatments</a></div></div></section><section class="section"><div class="shell story"><div class="story-image" role="img" aria-label="Inside Shiloh’s pedicure care space"></div><div><div class="eyebrow">The Shiloh experience</div><h2>Personal care, without the guesswork.</h2><p>Browse with clarity, choose what feels right, and let Shiloh guide the final appointment details. Availability is checked during the existing booking journey.</p><div class="actions"><a class="button primary" href="/book">Book with Shiloh</a><a class="button secondary" href="/contact">Plan your visit</a></div></div></div></section><section class="signature"><img src="/assets/booking/inside-shiloh-signature.png" alt="Inside Shiloh — clinical care, personal touch, beautifully you"></section></main>`,
  });
}

function renderTreatments(catalogue = []) {
  const groups = serviceGroups(catalogue);
  const content = groups.size
    ? [...groups.entries()]
        .map(
          ([category, services]) =>
            `<section class="category"><div class="category-label"><h2>${escapeHtml(category)}</h2><small>${services.length} treatment${services.length === 1 ? '' : 's'}</small></div><div class="grid">${services.map(serviceCard).join('')}</div></section>`,
        )
        .join('')
    : '<section class="card"><h2>Treatments are temporarily unavailable</h2><p>Please continue to booking for assistance. We have not substituted a second catalogue.</p></section>';
  return layout({
    title: 'Treatments',
    description:
      'Browse Shiloh’s current client-bookable massage therapy and aesthetic treatments, timing and prices.',
    currentPath: '/treatments',
    body: `<main id="main-content"><section class="page-hero"><div class="shell"><div class="eyebrow">Treatments</div><h1>Choose with clarity.</h1><p class="lede">Browse current client-bookable treatments, timing and prices. When you select Book, you continue into Shiloh’s existing booking journey.</p><div class="actions"><a class="button primary" href="/book">View booking catalogue</a></div></div></section><section class="section alt"><div class="shell" data-public-treatment-catalogue>${content}</div></section></main>`,
  });
}

function renderAbout() {
  return layout({
    title: 'About',
    description:
      'Meet Shiloh Massage Therapy and Aesthetic Clinic and discover our personal approach to care in Heidelberg.',
    currentPath: '/about',
    body: `<main id="main-content"><section class="page-hero"><div class="shell prose"><div class="eyebrow">About Shiloh</div><h1>Care designed around the person in front of us.</h1><p class="lede">Shiloh brings massage therapy and aesthetic care together in a calm Heidelberg clinic, with a practical focus on clear choices and a personal client experience.</p><div class="actions"><a class="button primary" href="/book">Book with Shiloh</a><a class="button secondary" href="/treatments">Explore treatments</a></div></div></section><section class="section alt"><div class="shell fact-grid"><div class="fact"><strong>Personal</strong><span>A focused clinic experience shaped around the care you are looking for.</span></div><div class="fact"><strong>Clear</strong><span>Current treatment information leads into one trusted booking journey.</span></div><div class="fact"><strong>Local</strong><span>Visit Shiloh at 37 Jacobs Street in Heidelberg, Gauteng.</span></div></div></section><section class="signature"><img src="/assets/booking/inside-shiloh-signature.png" alt="Inside Shiloh — clinical care, personal touch, beautifully you"></section></main>`,
  });
}

function renderContact() {
  return layout({
    title: 'Contact',
    description:
      'Plan your visit to Shiloh Massage Therapy and Aesthetic Clinic at 37 Jacobs Street, Heidelberg, Gauteng.',
    currentPath: '/contact',
    body: `<main id="main-content"><section class="page-hero"><div class="shell"><div class="eyebrow">Contact</div><h1>Come find Shiloh in Heidelberg.</h1><p class="lede">For treatment selection and appointment availability, use our booking journey. Your chosen treatment goes with you when you continue.</p></div></section><section class="section alt"><div class="shell contact-panel"><article class="card"><div class="eyebrow">Visit</div><h2>37 Jacobs Street</h2><p>Heidelberg, Gauteng, South Africa</p></article><article class="card"><div class="eyebrow">Appointments</div><h2>Ready to book?</h2><p>See current treatments and prices, then continue with Shiloh to check availability.</p><a class="button primary" href="/book">View treatments &amp; book</a></article></div></section></main>`,
  });
}

function renderPrivacy() {
  return layout({
    title: 'Privacy Policy',
    description:
      'How Shiloh Massage Therapy and Aesthetic Clinic collects, uses and protects personal information.',
    currentPath: '/privacy',
    body: `<main id="main-content"><section class="page-hero"><div class="shell prose"><div class="eyebrow">Privacy</div><h1>Your information, handled with care.</h1><p class="lede">This policy explains how Shiloh Massage Therapy and Aesthetic Clinic processes personal information when you contact us, use our website or WhatsApp assistant, or make and manage an appointment.</p><p><strong>Effective date:</strong> 13 September 2026</p></div></section><section class="section alt"><div class="shell prose"><h2>Information we process</h2><p>We may process your name, cellphone number, messages, appointment details, treatment choices, communication preferences, and information you choose to provide about your care needs. We also keep limited technical and security records needed to operate and protect Shiloh.</p><h2>Why we use it</h2><p>We use personal information to answer enquiries, identify and assist clients, arrange and manage appointments, send relevant service messages, maintain accurate clinic records, protect our services, and meet legal obligations. We use it only for a lawful, relevant purpose.</p><h2>Service providers</h2><p>Shiloh uses trusted providers where needed to deliver its services, including Meta and WhatsApp for messaging, Render for application and database hosting, OpenAI for assisted message responses, and Google for calendar operations. These providers process limited information for the service they supply and may process it outside South Africa under their applicable safeguards.</p><h2>Retention and security</h2><p>We keep personal information only for as long as it is reasonably needed for clinic operations, safety, legal obligations, and legitimate record keeping. Shiloh applies access controls, secure connections, protected credentials, and data-minimisation measures. No internet service can promise absolute security, but we work to prevent unauthorised access, loss, misuse, or disclosure.</p><h2>Your choices and rights</h2><p>You may ask us to explain the information we hold about you, correct inaccurate information, or consider a deletion, restriction, or objection request where the law allows. You may also withdraw optional communication preferences. Some clinic or transaction records may need to be retained for lawful reasons.</p><h2>Contact Shiloh</h2><p>For a privacy question or request, contact Shiloh through our official WhatsApp conversation or visit us at 37 Jacobs Street, Heidelberg, Gauteng. We may need to verify your identity before acting on a request.</p><h2>Updates</h2><p>We may update this policy when our services or legal duties change. The current version and effective date will remain available on this page.</p></div></section></main>`,
  });
}

module.exports = {
  escapeHtml,
  renderHome,
  renderTreatments,
  renderAbout,
  renderContact,
  renderPrivacy,
  serviceGroups,
};
