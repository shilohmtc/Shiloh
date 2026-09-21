const SHILOH_UX_TOKENS = Object.freeze({
  breakpoint: Object.freeze({
    phoneMax: '700px',
    desktopMin: '701px',
  }),
  touch: Object.freeze({
    minTarget: '44px',
  }),
  spacing: Object.freeze({
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
  }),
  radius: Object.freeze({
    sm: '8px',
    md: '12px',
    lg: '16px',
    pill: '999px',
  }),
  shadow: Object.freeze({
    soft: '0 6px 18px rgba(28, 49, 40, 0.08)',
    raised: '0 10px 28px rgba(28, 49, 40, 0.12)',
  }),
  color: Object.freeze({
    brandDeepGreen: '#17382d',
    brandWarmGold: '#b99972',
    brandSageDeep: '#747b62',
    brandSageSoft: '#969982',
    brandSurfaceIvory: '#f9f6f0',
    brandIconCanvas: '#fffcf7',
    ink: '#203129',
    inkMuted: '#66766e',
    border: '#dce5df',
    surface: '#ffffff',
    surfaceSubtle: '#f7faf8',
    focus: '#315f4d',
    success: '#326148',
    warning: '#8a6518',
    danger: '#93473f',
    info: '#3f6785',
  }),
  staffAccentPalette: Object.freeze([
    '#315f4d',
    '#3f6785',
    '#80506e',
    '#8a6518',
    '#9a503c',
    '#5f5a87',
  ]),
});

function shilohUxTokenCss() {
  const t = SHILOH_UX_TOKENS;
  return `:root{\n` +
    `--shiloh-phone-max:${t.breakpoint.phoneMax};\n` +
    `--shiloh-desktop-min:${t.breakpoint.desktopMin};\n` +
    `--shiloh-touch-min:${t.touch.minTarget};\n` +
    `--shiloh-space-1:${t.spacing[1]};\n` +
    `--shiloh-space-2:${t.spacing[2]};\n` +
    `--shiloh-space-3:${t.spacing[3]};\n` +
    `--shiloh-space-4:${t.spacing[4]};\n` +
    `--shiloh-space-5:${t.spacing[5]};\n` +
    `--shiloh-space-6:${t.spacing[6]};\n` +
    `--shiloh-radius-sm:${t.radius.sm};\n` +
    `--shiloh-radius-md:${t.radius.md};\n` +
    `--shiloh-radius-lg:${t.radius.lg};\n` +
    `--shiloh-radius-pill:${t.radius.pill};\n` +
    `--shiloh-shadow-soft:${t.shadow.soft};\n` +
    `--shiloh-shadow-raised:${t.shadow.raised};\n` +
    `--shiloh-brand-deep-green:${t.color.brandDeepGreen};\n` +
    `--shiloh-brand-warm-gold:${t.color.brandWarmGold};\n` +
    `--shiloh-brand-sage-deep:${t.color.brandSageDeep};\n` +
    `--shiloh-brand-sage-soft:${t.color.brandSageSoft};\n` +
    `--shiloh-brand-surface-ivory:${t.color.brandSurfaceIvory};\n` +
    `--shiloh-brand-icon-canvas:${t.color.brandIconCanvas};\n` +
    `--shiloh-ink:${t.color.ink};\n` +
    `--shiloh-ink-muted:${t.color.inkMuted};\n` +
    `--shiloh-border:${t.color.border};\n` +
    `--shiloh-surface:${t.color.surface};\n` +
    `--shiloh-surface-subtle:${t.color.surfaceSubtle};\n` +
    `--shiloh-focus:${t.color.focus};\n` +
    `--shiloh-success:${t.color.success};\n` +
    `--shiloh-warning:${t.color.warning};\n` +
    `--shiloh-danger:${t.color.danger};\n` +
    `--shiloh-info:${t.color.info};\n` +
    `}`;
}

module.exports = {
  SHILOH_UX_TOKENS,
  shilohUxTokenCss,
};
