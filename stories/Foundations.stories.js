import tokenModule from '../src/presentation/shilohUxTokens.js';
import iconModule from '../src/presentation/shilohIcon.js';
import primitiveModule from '../src/presentation/shilohUiPrimitives.js';

const { SHILOH_UX_TOKENS } = tokenModule;
const { SHILOH_ICONS, renderShilohIcon } = iconModule;
const { shilohUiPrimitiveStyles } = primitiveModule;

const shell = (body) => `
  <style>
    ${shilohUiPrimitiveStyles()}
    body{margin:0;background:#f7faf8;color:#203129;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    .foundations{max-width:980px;margin:0 auto;padding:28px;}
    .foundations h2{margin:0 0 8px;font-size:22px}.foundations p{color:#66766e;margin:0 0 22px;}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}
    .card{background:white;border:1px solid #dce5df;border-radius:14px;padding:14px;min-height:76px;box-sizing:border-box;}
    .swatch{height:38px;border-radius:10px;border:1px solid rgba(0,0,0,.08);margin-bottom:9px;}
    .token-name{font-weight:700;font-size:13px}.token-value{font-size:12px;color:#66766e;margin-top:4px;word-break:break-all;}
    .icon-card{display:flex;align-items:center;gap:10px}.icon-card span{font-size:13px;font-weight:650;}
  </style>
  <div class="foundations">${body}</div>`;

export default {
  title: 'Foundations/Shiloh Design System',
  parameters: { layout: 'fullscreen' },
};

export const SemanticColours = {
  render: () => shell(`
    <h2>Semantic colours</h2>
    <p>Presentation roles only. Staff identity accents and appointment-state colours remain separate concepts.</p>
    <div class="grid">
      ${Object.entries(SHILOH_UX_TOKENS.color).map(([name, value]) => `
        <div class="card"><div class="swatch" style="background:${value}"></div><div class="token-name">${name}</div><div class="token-value">${value}</div></div>
      `).join('')}
    </div>`),
};

export const OfficialBrandColours = {
  render: () => {
    const brandColours = Object.entries(SHILOH_UX_TOKENS.color)
      .filter(([name]) => name.startsWith('brand'));
    return shell(`
      <h2>Official brand colours</h2>
      <p>The approved logo values remain identical in light and dark mode. Icon canvas ivory is reserved for the app icon and matching launch background.</p>
      <div class="grid">
        ${brandColours.map(([name, value]) => `
          <div class="card"><div class="swatch" style="background:${value}"></div><div class="token-name">${name}</div><div class="token-value">${value}</div></div>
        `).join('')}
      </div>`);
  },
};

export const StaffAccentPalette = {
  render: () => shell(`
    <h2>Unassigned staff accent palette</h2>
    <p>These are visual candidates only; this foundation does not map colours to staff identities or create roster authority.</p>
    <div class="grid">
      ${SHILOH_UX_TOKENS.staffAccentPalette.map((value, index) => `
        <div class="card"><div class="swatch" style="background:${value}"></div><div class="token-name">Accent ${index + 1}</div><div class="token-value">${value}</div></div>
      `).join('')}
    </div>`),
};

export const CanonicalIcons = {
  render: () => shell(`
    <h2>Canonical Lucide vocabulary</h2>
    <p>Features consume semantic Shiloh names rather than embedding arbitrary SVG paths.</p>
    <div class="grid">
      ${Object.keys(SHILOH_ICONS).map((name) => `
        <div class="card icon-card">${renderShilohIcon(name, { size: 22 })}<span>${name}</span></div>
      `).join('')}
    </div>`),
};

export const ResponsiveContracts = {
  render: () => shell(`
    <h2>Responsive contracts</h2>
    <p>Shared semantics, device-appropriate interaction.</p>
    <div class="grid">
      <div class="card"><div class="token-name">Phone max</div><div class="token-value">${SHILOH_UX_TOKENS.breakpoint.phoneMax}</div></div>
      <div class="card"><div class="token-name">Desktop min</div><div class="token-value">${SHILOH_UX_TOKENS.breakpoint.desktopMin}</div></div>
      <div class="card"><div class="token-name">Phone minimum touch target</div><div class="token-value">${SHILOH_UX_TOKENS.touch.minTarget}</div></div>
    </div>`),
};
