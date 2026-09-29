const express = require('express');
const { listPublicServices, getPublicService } = require('../services/serviceCatalogue');

const router = express.Router();
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#faf9f7;color:#25232a}.wrap{max-width:1050px;margin:auto;padding:28px 18px 60px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}.card{background:#fff;border:1px solid #e7e3de;border-radius:16px;overflow:hidden}.card img{width:100%;height:190px;object-fit:cover}.pad{padding:18px}.meta,.muted{color:#6e6872}.btn{display:inline-block;margin:8px 5px 0 0;padding:11px 15px;border-radius:999px;background:#27233b;color:#fff;text-decoration:none}.category{margin-top:34px}.hero{margin-bottom:28px}</style></head><body><main class="wrap">${body}</main></body></html>`;
}

router.get('/services', async (req, res, next) => {
  try {
    const services = await listPublicServices();
    const groups = new Map();
    for (const service of services) {
      if (!groups.has(service.category)) groups.set(service.category, []);
      groups.get(service.category).push(service);
    }
    let body = '<div class="hero"><h1>Shiloh Services</h1><p class="muted">Explore our current treatments, then continue in My Shiloh for availability and booking.</p></div>';
    for (const [category, items] of groups) {
      body += `<h2 class="category">${escapeHtml(category)}</h2><div class="grid">${items.map((service) => `<article class="card">${service.imageUrl ? `<img src="${escapeHtml(service.imageUrl)}" alt="${escapeHtml(service.name)}" loading="lazy">` : ''}<div class="pad"><h3>${escapeHtml(service.name)}</h3><p class="meta">${escapeHtml(service.duration)} · ${escapeHtml(service.price)}</p>${service.description ? `<p>${escapeHtml(service.description)}</p>` : '<p class="muted">Full treatment description coming soon.</p>'}${service.bookingNote ? `<p class="muted">${escapeHtml(service.bookingNote)}</p>` : ''}<a class="btn" href="/services/${service.id}">View treatment</a><a class="btn" href="/book?service=${encodeURIComponent(service.id)}">Continue in My Shiloh</a></div></article>`).join('')}</div>`;
    }
    return res.type('html').send(page('Shiloh Services', body));
  } catch (error) { return next(error); }
});

router.get('/services/:id', async (req, res, next) => {
  try {
    const service = await getPublicService(req.params.id);
    if (!service) return res.status(404).type('html').send(page('Treatment not found', '<h1>Treatment not found</h1><a href="/services">← All services</a>'));
    const body = `<a href="/services">← All services</a>${service.imageUrl ? `<p><img src="${escapeHtml(service.imageUrl)}" alt="${escapeHtml(service.name)}" style="width:100%;max-height:430px;object-fit:cover;border-radius:18px"></p>` : ''}<h1>${escapeHtml(service.name)}</h1><p class="meta">${escapeHtml(service.category)} · ${escapeHtml(service.duration)} · ${escapeHtml(service.price)}</p>${service.description ? `<p>${escapeHtml(service.description)}</p>` : '<p class="muted">Full treatment description coming soon.</p>'}${service.bookingNote ? `<p class="muted">${escapeHtml(service.bookingNote)}</p>` : ''}<a class="btn" href="/book?service=${encodeURIComponent(service.id)}">Continue in My Shiloh</a>`;
    return res.type('html').send(page(service.name, body));
  } catch (error) { return next(error); }
});

module.exports = router;
