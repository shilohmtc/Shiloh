const {
  PUBLIC_BRAND_NAME,
  sanitizePublicCatalogue,
  groupPublicCatalogue,
  toPublicService,
  normalizePublicServiceId,
} = require('./publicPresentation');

const BOOKING_MESSAGE = "Hi Shiloh 👋 I'd like to book an appointment.";
const PUBLIC_CONTACT_EMAIL = 'info@shilohmtc.co.za';

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function buildWhatsAppBookingUrl(number, serviceName = '') {
  const digits = String(number || '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const message = serviceName ? `Hi Shiloh 👋 I'd like to book ${serviceName}.` : BOOKING_MESSAGE;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
function resolveSelectedPublicService(catalogue = [], selectedServiceId = '') {
  const id = normalizePublicServiceId(selectedServiceId);
  if (!id) return null;
  return (
    sanitizePublicCatalogue(catalogue).find(
      (service) => normalizePublicServiceId(service.id) === id,
    ) || null
  );
}
function buildContactHelpUrl(serviceName = '') {
  const subject = serviceName ? `Help with ${serviceName}` : 'Booking help';
  return `mailto:${PUBLIC_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
function renderServiceCard(number, service, selectedServiceId = '') {
  const publicService = toPublicService(service);
  const id = normalizePublicServiceId(publicService.id);
  const selected = Boolean(id && id === normalizePublicServiceId(selectedServiceId));
  const url = buildWhatsAppBookingUrl(number, publicService.name);
  const anchor = id ? ` id="service-${escapeHtml(id)}"` : '';
  const selectedAttributes = selected
    ? ` data-selected-service="true" aria-label="${escapeHtml(`${publicService.name}, selected service`)}"`
    : '';
  const description = publicService.description
    ? `<p class="service-description">${escapeHtml(publicService.description)}</p>`
    : '';
  return `<article${anchor} class="service-card${selected ? ' selected' : ''}"${selectedAttributes}><div><h3>${escapeHtml(publicService.name)}</h3><div class="meta"><span>${escapeHtml(publicService.duration)}</span><strong>${escapeHtml(publicService.price)}</strong></div>${description}</div>${url ? `<a class="book-service" href="${escapeHtml(url)}" rel="noopener">${selected ? 'Continue with this service' : 'Book this service'} <span>→</span></a>` : ''}</article>`;
}
function renderCatalogue(number, catalogue, selectedServiceId = '') {
  const groups = groupPublicCatalogue(catalogue);
  if (!groups.size) return '<p class="empty">Our service catalogue is temporarily unavailable. Please try again shortly or email Shiloh for help.</p>';
  return [...groups.entries()].map(([category, services], index) => `<section class="category" id="category-${index}"><div class="category-head"><span>Shiloh services</span><h2>${escapeHtml(category)}</h2><small>${services.length} service${services.length === 1 ? '' : 's'}</small></div><div class="service-grid">${services.map((service) => renderServiceCard(number, service, selectedServiceId)).join('')}</div></section>`).join('');
}
function renderBookingPage(number, catalogue = [], selectedServiceId = '') {
  const publicCatalogue = sanitizePublicCatalogue(catalogue);
  const selectedService = resolveSelectedPublicService(publicCatalogue, selectedServiceId);
  const selectedName = selectedService?.name || '';
  const generalWhatsAppUrl = buildWhatsAppBookingUrl(number);
  const whatsappUrl = buildWhatsAppBookingUrl(number, selectedName);
  const helpUrl = buildContactHelpUrl(selectedName);
  const selectionSummary = selectedService
    ? `<aside class="selection-summary" aria-label="Selected service"><span>Your choice is saved</span><strong>${escapeHtml(selectedName)}</strong><small>We’ll include it when you continue to WhatsApp.</small></aside>`
    : '';
  const cta = whatsappUrl
    ? `<a class="cta" href="${escapeHtml(whatsappUrl)}" rel="noopener">${selectedService ? 'Continue with this service' : 'Continue with Shiloh on WhatsApp'} <b>→</b></a>`
    : `<div class="cta unavailable booking-fallback" role="status"><strong>WhatsApp is taking a short pause.</strong><span>${selectedService ? 'Your choice is safe here. ' : ''}Please try again shortly, or <a href="${escapeHtml(helpUrl)}">email Shiloh for help</a>.</span></div>`;
  const askCta = generalWhatsAppUrl ? `<a class="ask-shiloh" href="${escapeHtml(generalWhatsAppUrl)}" rel="noopener">Not sure what to choose? <strong>Ask Shiloh</strong> →</a>` : '';
  const categories = [...groupPublicCatalogue(publicCatalogue).keys()];
  const categoryNav = categories.length ? `<nav class="category-nav" aria-label="Service categories">${categories.map((name, i) => `<a href="#category-${i}">${escapeHtml(name)}</a>`).join('')}</nav>` : '';
  const mobileCta = whatsappUrl ? `<a class="mobile-book" href="${escapeHtml(whatsappUrl)}" rel="noopener"><span>${selectedService ? 'Your choice is saved' : 'WhatsApp Shiloh'}</span><strong>${selectedService ? `Continue with ${escapeHtml(selectedName)}` : 'Check availability & book'}</strong></a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><meta name="description" content="Explore services and book with ${escapeHtml(PUBLIC_BRAND_NAME)} in Heidelberg, Gauteng."><title>Book with Shiloh | Massage & Aesthetic Clinic</title><style>
:root{--ink:#24352f;--muted:#53625c;--cream:#f7f3eb;--paper:#fff;--sage:#dce8da;--deep:#294b3e;--line:#dce2dd;--gold:#8a662f}*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--cream)}body{margin:0;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5;overflow-x:hidden}a{color:inherit}.shell{width:min(1320px,calc(100% - 48px));margin:auto}.hero{min-height:365px;display:grid;align-items:center;background:linear-gradient(90deg,rgba(24,45,37,.88),rgba(24,45,37,.55) 44%,rgba(24,45,37,.1)),url('/assets/booking/reception.svg') center 46%/cover;color:#fff}.hero-inner{padding:52px 0;max-width:690px}.eyebrow,.category-head span{text-transform:uppercase;letter-spacing:.17em;font-size:11px;font-weight:800}.hero h1{font-family:Georgia,"Times New Roman",serif;font-size:clamp(42px,5.2vw,68px);line-height:1;letter-spacing:-.035em;font-weight:500;margin:13px 0 14px}.hero p{font-size:17px;max-width:610px;color:#eef3ef;margin:0}.cta{display:inline-flex;align-items:center;justify-content:space-between;gap:28px;margin-top:22px;padding:15px 18px;border-radius:12px;background:#fff;color:var(--deep);text-decoration:none;font-weight:800;min-width:315px}.selection-summary{display:grid;gap:3px;margin-top:22px;padding:14px 16px;border:1px solid rgba(255,255,255,.32);border-radius:14px;background:rgba(255,255,255,.12);backdrop-filter:blur(8px)}.selection-summary span{font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.12em}.selection-summary strong{font-family:Georgia,"Times New Roman",serif;font-size:22px;font-weight:500}.selection-summary small{color:#eef3ef}.booking-fallback{display:grid;justify-items:start;gap:4px;max-width:560px}.booking-fallback strong{font-family:Georgia,"Times New Roman",serif;font-size:20px}.booking-fallback span{font-size:14px;font-weight:600}.booking-fallback a{text-underline-offset:3px}.intro{padding:36px 0 20px}.intro-top{display:flex;align-items:end;justify-content:space-between;gap:32px;margin-bottom:21px}.intro-copy{max-width:720px}.intro h2,.category h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.025em}.intro h2{font-size:clamp(32px,3.5vw,46px);line-height:1.05;margin:7px 0 10px}.intro p{color:var(--muted);margin:0}.ask-shiloh{flex:0 0 auto;text-decoration:none;background:var(--sage);border:1px solid #cad9c8;border-radius:14px;padding:14px 16px;font-size:14px}.category-nav{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:20px}.category-nav a{white-space:nowrap;text-decoration:none;border:1px solid var(--line);background:#fff;padding:8px 12px;border-radius:999px;font-size:12px;font-weight:750}.clinic-gallery{width:min(1160px,calc(100% - 48px));margin:2px auto 26px;display:grid;grid-template-columns:1.35fr .65fr;gap:14px}.gallery-photo{height:168px;border-radius:19px;background-size:cover;background-position:center;box-shadow:0 8px 28px rgba(36,53,47,.08);border:1px solid rgba(36,53,47,.08);overflow:hidden}.gallery-pedicure{background-image:linear-gradient(rgba(36,53,47,.04),rgba(36,53,47,.04)),url('/assets/booking/pedicure-side.webp');background-position:center 58%}.gallery-treatment{background-image:linear-gradient(rgba(36,53,47,.03),rgba(36,53,47,.03)),url('/assets/booking/treatment-room-side.webp');background-position:center 55%}.catalogue{width:min(1160px,calc(100% - 48px));margin:auto;padding-bottom:60px}.category{scroll-margin-top:18px;padding:29px 0 35px;border-top:1px solid var(--line)}.category-head{margin-bottom:17px}.category-head span{color:var(--gold)}.category h2{font-size:clamp(29px,3vw,39px);line-height:1.05;margin:4px 0}.category-head small{color:var(--muted);font-size:12px}.service-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.service-card{background:var(--paper);border:1px solid rgba(36,53,47,.08);border-radius:17px;padding:20px;display:flex;flex-direction:column;justify-content:space-between;min-height:175px;box-shadow:0 5px 20px rgba(36,53,47,.045);scroll-margin-top:18px}.service-card.selected{border-color:var(--deep);box-shadow:0 0 0 3px rgba(41,75,62,.12),0 10px 28px rgba(36,53,47,.1)}.service-card.selected::before{content:"Your choice";align-self:flex-start;margin-bottom:12px;padding:5px 8px;border-radius:999px;background:var(--deep);color:#fff;font-size:10px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.service-card h3{font-family:Georgia,"Times New Roman",serif;font-size:23px;line-height:1.12;margin:0 0 11px}.meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.meta span,.meta strong{background:#f1f4ef;border-radius:999px;padding:6px 9px;font-size:12px;font-weight:800}.meta strong{background:#e4eee1;color:var(--deep)}.book-service{display:flex;justify-content:space-between;align-items:center;margin-top:17px;padding-top:13px;border-top:1px solid var(--line);color:var(--deep);font-size:14px;font-weight:800;text-decoration:none}.clinic{background:var(--deep);color:#fff;padding:46px 0}.clinic-row{display:grid;grid-template-columns:.9fr 1.1fr;gap:48px}.clinic h2{font-family:Georgia,"Times New Roman",serif;font-size:clamp(34px,4vw,46px);line-height:1.05;font-weight:500;margin:6px 0 12px}.clinic p{color:#dce7e1;margin:0}.clinic-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.clinic-fact{border:1px solid rgba(255,255,255,.18);border-radius:15px;padding:18px;background:rgba(255,255,255,.05)}.clinic-fact strong{display:block;font-size:14px;margin-bottom:5px}.clinic-fact span{color:#dce7e1;font-size:12px}.footer{padding:24px 0 88px;color:var(--muted);font-size:13px}.footer-inner{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.footer strong{color:var(--ink)}.empty{padding:24px;background:#fff;border-radius:16px}.mobile-book{display:none}@media(max-width:980px){.service-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.clinic-row{grid-template-columns:1fr}.intro-top{align-items:flex-start}.shell{width:min(100% - 36px,1180px)}.catalogue,.clinic-gallery{width:min(100% - 36px,1180px)}}@media(max-width:700px){body{padding-bottom:72px}.shell,.catalogue,.clinic-gallery{width:calc(100% - 30px)}.hero{min-height:390px;background-position:60% center}.hero-inner{padding:42px 0}.hero h1{font-size:44px}.hero p{font-size:15px}.cta{min-width:0;width:100%;gap:14px}.intro{padding:28px 0 14px}.intro-top{display:block}.intro h2{font-size:34px}.ask-shiloh{display:inline-flex;margin-top:18px}.category-nav{flex-wrap:nowrap;overflow-x:auto;margin-right:-15px;padding-right:15px;scrollbar-width:none}.category-nav::-webkit-scrollbar{display:none}.clinic-gallery{grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px}.gallery-photo{height:104px;border-radius:14px}.service-grid,.clinic-facts{grid-template-columns:1fr}.service-card{min-height:0}.category{padding:25px 0 29px}.clinic{padding:38px 0}.footer{padding-bottom:24px}.mobile-book{position:fixed;display:flex;z-index:20;left:10px;right:10px;bottom:10px;background:#fff;color:var(--deep);border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 35px rgba(20,40,32,.22);padding:10px 14px;text-decoration:none;align-items:center;justify-content:space-between;gap:12px}.mobile-book span{font-size:11px;color:var(--muted)}.mobile-book strong{font-size:13px;text-align:right}}
</style></head><body><header class="hero"><div class="shell hero-inner"><div class="eyebrow">${escapeHtml(PUBLIC_BRAND_NAME)}</div><h1>Your appointment starts with Shiloh.</h1><p>Explore our services, then continue on WhatsApp to check real availability and complete your booking.</p>${selectionSummary}${cta}</div></header><main><section class="intro" id="choose-with-shiloh"><div class="shell"><div class="intro-top"><div class="intro-copy"><div class="eyebrow">Our services</div><h2>Choose a service, or let Shiloh guide you.</h2><p>Browse our current services below. Choose one to take it straight into WhatsApp, or ask Shiloh to help you decide.</p></div>${askCta}</div>${categoryNav}</div></section><section class="clinic-gallery" aria-label="Inside Shiloh"><div class="gallery-photo gallery-pedicure" role="img" aria-label="Shiloh pedicure area"></div><div class="gallery-photo gallery-treatment" role="img" aria-label="Inside a Shiloh room"></div></section><div class="catalogue">${renderCatalogue(number, publicCatalogue, selectedService?.id)}</div><section class="clinic"><div class="shell clinic-row"><div><div class="eyebrow">Book with confidence</div><h2>A simple booking experience.</h2><p>Choose what suits you, then Shiloh will help you find an eligible practitioner and an available time.</p></div><div class="clinic-facts"><div class="clinic-fact"><strong>Current services</strong><span>Our active Shiloh service catalogue.</span></div><div class="clinic-fact"><strong>Real availability</strong><span>Checked when you continue your booking.</span></div><div class="clinic-fact"><strong>WhatsApp booking</strong><span>Your chosen service goes with you into Shiloh.</span></div></div></div></section></main><footer class="footer"><div class="shell footer-inner"><strong>${escapeHtml(PUBLIC_BRAND_NAME)}</strong><span>37 Jacobs Street, Heidelberg, Gauteng</span><span>Availability is confirmed when Shiloh completes your booking.</span></div></footer>${mobileCta}</body></html>`;
}
module.exports = {
  BOOKING_MESSAGE,
  PUBLIC_CONTACT_EMAIL,
  buildWhatsAppBookingUrl,
  buildContactHelpUrl,
  resolveSelectedPublicService,
  renderBookingPage,
  renderCatalogue,
};
