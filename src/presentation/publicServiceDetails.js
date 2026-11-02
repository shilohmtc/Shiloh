'use strict';

// Keep the complete owner-approved customer description, including qualifications.
// Native disclosure works without JavaScript and never substitutes booking notes.
function publicServiceDetails(description) {
  if (!description) return '';
  const text = String(description).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  return `<details class="service-details"><summary>About this service</summary><p class="service-description">${text}</p></details>`;
}

const publicServiceDetailsStyles = `.service-details{margin-top:12px;color:var(--ink)}.service-details summary{cursor:pointer;min-height:44px;padding:10px 0;font-size:14px;font-weight:750;color:var(--deep)}.service-details summary:focus-visible{outline:2px solid var(--deep);outline-offset:3px;border-radius:4px}.service-details .service-description{margin:4px 0 12px;font-size:14px;line-height:1.55}.treatment-card .card-link,.service-card .book-service{margin-top:auto;padding-top:14px}`;

module.exports = { publicServiceDetails, publicServiceDetailsStyles };
