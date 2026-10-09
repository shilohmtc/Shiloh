import primitives from '../src/presentation/shilohUiPrimitives.js';

const {
  renderButton,
  renderIconButton,
  renderChip,
  renderBadge,
  shilohUiPrimitiveStyles,
} = primitives;

const frame = (body, width = 'auto') => `
  <style>
    ${shilohUiPrimitiveStyles()}
    body{margin:0;background:#f7faf8;color:#203129;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    .story-shell{box-sizing:border-box;width:${width};max-width:100%;padding:24px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;background:white;border:1px solid #dce5df;border-radius:16px;}
  </style>
  <div class="story-shell">${body}</div>`;

export default {
  title: 'Components/UI Primitives',
  parameters: {
    layout: 'centered',
  },
};

export const Buttons = {
  render: () => frame([
    renderButton({ label: 'Primary action', icon: 'confirm', variant: 'primary' }),
    renderButton({ label: 'Secondary', variant: 'secondary' }),
    renderButton({ label: 'Quiet action', variant: 'ghost' }),
    renderButton({ label: 'Remove', variant: 'danger' }),
    renderButton({ label: 'Disabled', disabled: true }),
  ].join('')),
};

export const DesktopCompactButtons = {
  render: () => frame([
    renderButton({ label: 'Today', icon: 'calendar', variant: 'secondary', density: 'compact' }),
    renderButton({ label: 'Add', icon: 'add', variant: 'primary', density: 'compact' }),
    renderIconButton({ label: 'Previous', icon: 'previous', density: 'compact' }),
    renderIconButton({ label: 'Next', icon: 'next', density: 'compact' }),
  ].join(''), '520px'),
};

export const PhoneTouchTargets = {
  render: () => frame([
    renderButton({ label: 'Book appointment', icon: 'calendar', variant: 'primary', density: 'touch' }),
    renderIconButton({ label: 'More actions', icon: 'more', density: 'touch' }),
  ].join(''), '390px'),
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
};

export const PractitionerChips = {
  render: () => frame([
    renderChip({ label: 'All staff', icon: 'people', selected: false, density: 'compact' }),
    renderChip({ label: 'Abigail', icon: 'person', selected: true, density: 'compact' }),
    renderChip({ label: 'Synthetic Client AN', icon: 'person', selected: false, density: 'compact' }),
    renderChip({ label: 'Unavailable', icon: 'person', disabled: true, density: 'compact' }),
  ].join(''), '700px'),
};

export const StatusBadges = {
  render: () => frame([
    renderBadge({ label: 'Neutral' }),
    renderBadge({ label: 'Confirmed', tone: 'success', icon: 'confirm' }),
    renderBadge({ label: 'Needs attention', tone: 'warning', icon: 'alert' }),
    renderBadge({ label: 'Cancelled', tone: 'danger', icon: 'alert' }),
    renderBadge({ label: 'Information', tone: 'info' }),
  ].join(''), '700px'),
};
