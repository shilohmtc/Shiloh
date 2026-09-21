'use strict';

const { groupPublicCatalogue, sanitizePublicCatalogue } = require('../services/publicPresentation');

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function fixedServicePrice(service = {}) {
  const rawAmount = Number(service.amount);
  if (Number.isFinite(rawAmount) && rawAmount >= 0) return rawAmount;
  const text = String(service.price || '').replace(/\s/g, '').replace(',', '.');
  const fixed = text.match(/^R(\d+(?:\.\d{1,2})?)$/i);
  if (fixed) return Number(fixed[1]);
  const range = text.match(/^R?(\d+(?:\.\d{1,2})?)[-–—]R?(\d+(?:\.\d{1,2})?)$/i);
  return range ? Number(range[1]) : null;
}

function qualifyingServices(catalogue = [], minimumBookingValue = 450, eligibleServiceIds = null) {
  const minimum = Number(minimumBookingValue);
  const allowedIds = Array.isArray(eligibleServiceIds) ? new Set(eligibleServiceIds.map(Number)) : null;
  return sanitizePublicCatalogue(catalogue).filter((service) => {
    const price = fixedServicePrice(service);
    return Number.isFinite(price) && price >= minimum && (!allowedIds || allowedIds.has(Number(service.id)));
  });
}

function welcomeVoucherBookingUrl(number, serviceName = '') {
  const digits = String(number || '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const name = String(serviceName || 'a qualifying treatment').trim();
  const message = `Hi Shiloh 👋 I'd like to book ${name}. I also want to use my R100 My Shiloh welcome voucher. Please help me choose an available time.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function renderService(service, number) {
  const url = welcomeVoucherBookingUrl(number, service.name);
  const description = service.description ? `<p>${escapeHtml(service.description)}</p>` : '';
  const action = url
    ? `<a class="choose" href="${escapeHtml(url)}" rel="noopener">Choose this treatment <span>→</span></a>`
    : '<span class="unavailable">WhatsApp booking is temporarily unavailable.</span>';
  return `<article class="service"><h3>${escapeHtml(service.name)}</h3><div class="facts"><span>${escapeHtml(service.duration)}</span><strong>${escapeHtml(service.price)}</strong></div>${description}${action}</article>`;
}

function renderMyShilohWelcomeVoucherBooking({ number, catalogue = [], minimumBookingValue = 450, eligibleServiceIds = null } = {}) {
  const minimum = Number(minimumBookingValue) || 450;
  const eligible = qualifyingServices(catalogue, minimum, eligibleServiceIds);
  const groups = groupPublicCatalogue(eligible);
  const services = groups.size
    ? [...groups.entries()].map(([category, rows]) => `<section class="category"><div class="category-head"><span>Qualifying treatments</span><h2>${escapeHtml(category)}</h2></div><div class="service-grid">${rows.map((service) => renderService(service, number)).join('')}</div></section>`).join('')
    : '<div class="empty">No fixed-price qualifying treatments are available online right now. Please ask Shiloh for help.</div>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#465746"><link rel="manifest" href="/my-shiloh/manifest.webmanifest"><link rel="apple-touch-icon" href="/my-shiloh/assets/apple-touch-icon-180.png"><title>Choose a qualifying treatment | My Shiloh</title><style>
:root{--ink:#23342d;--muted:#657169;--paper:#fffdfa;--cream:#f8f4ec;--leaf:#244c3d;--sage:#e7eee7;--line:#d9dfd8;--gold:#96703b}*{box-sizing:border-box}html{background:var(--cream)}body{margin:0;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45}.shell{width:min(760px,calc(100% - 28px));margin:auto}.top{position:sticky;top:0;z-index:10;background:rgba(248,244,236,.95);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}.top .shell{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:16px}.back,.check{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border-radius:13px;text-decoration:none;font-weight:800}.back{color:var(--leaf)}.check{padding:0 14px;background:var(--leaf);color:#fff;font-size:13px}.intro{padding:30px 0 20px}.eyebrow,.category-head span{text-transform:uppercase;letter-spacing:.15em;font-size:10px;font-weight:850;color:var(--gold)}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.025em}h1{font-size:clamp(36px,9vw,54px);line-height:1.02;margin:9px 0 13px}.intro>p{margin:0;color:var(--muted);font-size:15px}.path{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:22px 0 10px}.path div{padding:13px;border:1px solid var(--line);border-radius:15px;background:var(--paper)}.path b{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--sage);color:var(--leaf);font-size:12px}.path strong{display:block;margin-top:9px;font-size:12px}.path small{display:block;margin-top:3px;color:var(--muted);font-size:10px}.notice{padding:14px 16px;border-radius:15px;background:#fff6df;border:1px solid #ead9af;font-size:12px}.category{padding:26px 0;border-top:1px solid var(--line)}.category h2{font-size:29px;margin:4px 0 15px}.service-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.service{display:flex;flex-direction:column;padding:17px;border-radius:18px;background:var(--paper);border:1px solid var(--line);box-shadow:0 7px 22px rgba(35,52,45,.05)}.service h3{font-size:21px;line-height:1.15;margin:0 0 10px}.service p{color:var(--muted);font-size:12px;margin:8px 0}.facts{display:flex;gap:7px;flex-wrap:wrap}.facts span,.facts strong{padding:5px 8px;border-radius:999px;background:var(--sage);font-size:11px}.choose{display:flex;justify-content:space-between;gap:10px;margin-top:auto;padding-top:14px;color:var(--leaf);font-size:12px;font-weight:850;text-decoration:none}.unavailable{margin-top:auto;padding-top:14px;color:#8a413b;font-size:11px}.empty{margin:20px 0;padding:20px;border:1px solid var(--line);border-radius:18px;background:var(--paper)}.bottom{position:sticky;bottom:0;padding:10px 0 calc(10px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--cream) 26%)}.bottom .check{width:100%;min-height:50px}.foot{padding:8px 0 28px;color:var(--muted);font-size:11px}@media(max-width:560px){.path{grid-template-columns:1fr}.path div{display:grid;grid-template-columns:28px 1fr;column-gap:9px}.path strong{margin-top:1px}.path small{grid-column:2}.service-grid{grid-template-columns:1fr}.top .shell{min-height:64px}h1{font-size:39px}}
</style></head><body><header class="top"><div class="shell"><a class="back" href="/my-shiloh/#welcome-voucher">← My Shiloh</a><a class="check" href="/my-shiloh/#welcome-voucher">Check my booking</a></div></header><main class="shell"><section class="intro"><div class="eyebrow">R100 welcome voucher</div><h1>Choose a qualifying treatment.</h1><p>Only eligible treatments priced at R${escapeHtml(minimum.toFixed(0))} or more are shown. The welcome voucher does not apply to Marietjie’s services. Your R100 is applied after the appointment has been confirmed.</p><div class="path" aria-label="How the voucher works"><div><b>1</b><strong>Choose a treatment</strong><small>We include your voucher request in WhatsApp.</small></div><div><b>2</b><strong>Confirm the booking</strong><small>Shiloh confirms the practitioner, date and time.</small></div><div><b>3</b><strong>Apply the R100</strong><small>Return to your voucher and tap “Apply R100 to this booking”.</small></div></div><div class="notice"><strong>Your voucher is not spent when you choose a treatment.</strong> It is applied once, securely, to the confirmed booking you select in My Shiloh.</div></section>${services}<p class="foot">Marietjie’s services, packages, products, gift vouchers and treatments below R${escapeHtml(minimum.toFixed(0))} are not included.</p></main><div class="bottom"><div class="shell"><a class="check" href="/my-shiloh/#welcome-voucher">Return and check for my booking</a></div></div></body></html>`;
}

module.exports = {
  fixedServicePrice,
  qualifyingServices,
  welcomeVoucherBookingUrl,
  renderMyShilohWelcomeVoucherBooking,
};
