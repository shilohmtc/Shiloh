const test = require('node:test');
const assert = require('node:assert/strict');

const { SHILOH_UX_TOKENS, shilohUxTokenCss } = require('../src/presentation/shilohUxTokens');
const { SHILOH_ICONS, renderShilohIcon } = require('../src/presentation/shilohIcon');

test('#862 UX tokens preserve the standing Phone/Desktop boundary and touch target contract', () => {
  assert.equal(SHILOH_UX_TOKENS.breakpoint.phoneMax, '700px');
  assert.equal(SHILOH_UX_TOKENS.breakpoint.desktopMin, '701px');
  assert.equal(SHILOH_UX_TOKENS.touch.minTarget, '44px');
  assert.ok(SHILOH_UX_TOKENS.staffAccentPalette.length >= 5);
  assert.deepEqual(
    {
      deepGreen: SHILOH_UX_TOKENS.color.brandDeepGreen,
      warmGold: SHILOH_UX_TOKENS.color.brandWarmGold,
      sageDeep: SHILOH_UX_TOKENS.color.brandSageDeep,
      sageSoft: SHILOH_UX_TOKENS.color.brandSageSoft,
      surfaceIvory: SHILOH_UX_TOKENS.color.brandSurfaceIvory,
      iconCanvas: SHILOH_UX_TOKENS.color.brandIconCanvas,
    },
    {
      deepGreen: '#17382d',
      warmGold: '#b99972',
      sageDeep: '#747b62',
      sageSoft: '#969982',
      surfaceIvory: '#f9f6f0',
      iconCanvas: '#fffcf7',
    },
  );

  const css = shilohUxTokenCss();
  assert.match(css, /--shiloh-phone-max:700px/);
  assert.match(css, /--shiloh-desktop-min:701px/);
  assert.match(css, /--shiloh-touch-min:44px/);
  assert.match(css, /--shiloh-focus:/);
  assert.match(css, /--shiloh-brand-deep-green:#17382d/);
  assert.match(css, /--shiloh-brand-icon-canvas:#fffcf7/);
});

test('#862 canonical icon vocabulary is Lucide-backed and server-renderable', () => {
  assert.ok(SHILOH_ICONS.calendar);
  assert.ok(SHILOH_ICONS.person);
  assert.ok(SHILOH_ICONS.people);

  const html = renderShilohIcon('calendar', { size: 20, className: 'nav-icon' });
  assert.match(html, /^<svg /);
  assert.match(html, /data-shiloh-icon="calendar"/);
  assert.match(html, /class="shiloh-icon nav-icon"/);
  assert.match(html, /width="20" height="20"/);
  assert.match(html, /aria-hidden="true" focusable="false"/);
  assert.match(html, /<path /);
});

test('#862 labelled icons expose an accessible name and inputs are escaped', () => {
  const html = renderShilohIcon('search', { label: 'Search <clients>', className: 'x" onclick="bad' });
  assert.match(html, /role="img" aria-label="Search &lt;clients&gt;"/);
  assert.match(html, /class="shiloh-icon x&quot; onclick=&quot;bad"/);
  assert.doesNotMatch(html, /class="[^"]*" onclick=/);
});

test('#862 icon renderer fails closed for non-canonical icon names', () => {
  assert.throws(() => renderShilohIcon('not-a-shiloh-icon'), /Unknown Shiloh icon/);
});
