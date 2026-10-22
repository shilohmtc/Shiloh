'use strict';
const { MORNING_TERMS } = require('../domain/websiteContent');
function esc(value = '') { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function postPath(post) { return `/${post.kind === 'offer' ? 'offers' : 'discover'}/${encodeURIComponent(post.slug)}`; }
function artwork(post, mediaPrefix = '/website-media/') {
  if(!post.imageId && post.kind==='offer' && post.ruleCode==='morning_welcome_v1')return '<img class="publication-image" src="/assets/website/shiloh-morning-welcome-offer-v1.webp" alt="Morning Welcome Offer: 20% off your first Shiloh visit." loading="lazy" decoding="async">';
  return post.imageId ? `<img class="publication-image" src="${mediaPrefix}${esc(post.imageId)}" alt="${esc(post.imageAlt)}" loading="lazy" decoding="async">` : '';
}
function card(post) {
  return `<article class="card publication-card">${artwork(post)}<div><div class="eyebrow">${post.kind === 'offer' ? 'Current offer' : `Discover Shiloh · Episode ${esc(post.episode)}`}</div><h3>${esc(post.title)}</h3><p>${esc(post.summary)}</p><a class="card-link" href="${postPath(post)}">${post.kind === 'offer' ? 'View the offer' : 'Read the episode'} →</a></div></article>`;
}
function homePublications(posts = []) {
  const latest = [posts.find(p=>p.kind === 'episode'),posts.find(p=>p.kind === 'offer')].filter(Boolean);
  if (!latest.length) return '';
  return `<section class="section home-publications" data-public-publications><div class="shell"><div class="section-head"><div><div class="eyebrow">A little more Shiloh</div><h2>Discover what’s new.</h2></div><p>Get to know our approach and find a little time for yourself.</p></div><div class="publication-grid">${latest.map(card).join('')}</div></div></section>`;
}
function listingBody(kind, posts) {
  const offer = kind === 'offer';
  return `<main id="main-content"><section class="page-hero"><div class="shell prose"><div class="eyebrow">${offer ? 'Current offers' : 'Discover Shiloh'}</div><h1>${offer ? 'A little time for you.' : 'Care, one story at a time.'}</h1><p class="lede">${offer ? 'Explore our current offers. You’ll see qualifying savings in your booking before you confirm.' : 'Meet our approach to massage, thoughtful treatments and feeling cared for.'}</p></div></section><section class="section alt"><div class="shell publication-grid">${posts.length ? posts.map(card).join('') : `<article class="card"><h2>${offer ? 'More good things to come.' : 'Our stories are on their way.'}</h2><p>${offer ? 'There are no current offers. You can still explore our services and available appointment times.' : 'Visit again soon to discover more about Shiloh.'}</p><a class="button primary" href="/book">View services &amp; book</a></article>`}</div></section></main>`;
}
function articleBody(post, { mediaPrefix, preview = false } = {}) {
  const offer = post.kind === 'offer';
  const paragraphs = String(post.body || '').split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
  return `<main id="main-content">${preview ? '<aside class="publication-preview shell" role="status">Preview — this view is private. <a href="/calendar/website">Back to Website</a></aside>' : ''}<section class="page-hero"><div class="shell prose"><a href="/${offer ? 'offers' : 'discover'}">← ${offer ? 'Current offers' : 'Discover Shiloh'}</a><div class="eyebrow">${offer ? 'Current offer' : `Discover Shiloh · Episode ${esc(post.episode)}`}</div><h1>${esc(post.title)}</h1><p class="lede">${esc(post.summary)}</p></div></section><section class="section alt"><article class="shell prose publication-article">${artwork(post,mediaPrefix)}${paragraphs}${offer ? `<section class="card publication-terms" aria-label="Offer conditions"><h2>Make the morning yours.</h2><ul>${MORNING_TERMS.map(term=>`<li>${esc(term)}</li>`).join('')}</ul></section>` : ''}<div class="actions"><a class="button primary" href="/book">${offer ? 'Choose your morning treatment' : 'Explore treatments &amp; book'}</a></div></article></section></main>`;
}
const editorialStyles = `.publication-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.publication-card{overflow:hidden;padding:0;display:flex;flex-direction:column}.publication-card>div{padding:24px}.publication-image{display:block;width:100%;height:auto;max-height:560px;object-fit:contain;background:#f7f3eb}.publication-card .publication-image{max-height:400px}.publication-card .eyebrow{margin-bottom:12px}.publication-article .publication-image{border-radius:20px;margin-bottom:30px}.publication-terms{margin-top:28px}.publication-terms h2{font-size:30px}.publication-terms li{margin:12px 0}.publication-preview{padding:14px;background:#ead6a9}.publication-card h3{font-size:30px}.home-publications .publication-image{display:none}.home-publications .publication-card>div{display:flex;flex-direction:column;flex:1}.home-publications .card-link{margin-top:auto}@media(max-width:760px){.publication-grid{grid-template-columns:1fr}.publication-card>div{padding:20px}}`;
module.exports = { esc, postPath, homePublications, listingBody, articleBody, editorialStyles };
