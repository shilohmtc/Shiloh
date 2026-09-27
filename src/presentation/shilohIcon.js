const {
  Calendar,
  House,
  User,
  Wallet,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  Clock,
  Check,
  CircleAlert,
  MessageSquare,
  Plus,
  Ellipsis,
} = require('lucide');

const SHILOH_ICONS = Object.freeze({
  calendar: Calendar,
  home: House,
  person: User,
  wallet: Wallet,
  people: Users,
  search: Search,
  previous: ChevronLeft,
  next: ChevronRight,
  time: Clock,
  confirm: Check,
  alert: CircleAlert,
  message: MessageSquare,
  add: Plus,
  more: Ellipsis,
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function normalizeSize(value, fallback = 18) {
  const size = Number(value);
  return Number.isFinite(size) && size >= 12 && size <= 48 ? size : fallback;
}

function renderNode([tag, attrs = {}]) {
  const cleanTag = String(tag).toLowerCase();
  if (!['path', 'circle', 'line', 'polyline', 'polygon', 'rect', 'ellipse'].includes(cleanTag)) {
    throw new Error(`Unsupported Lucide SVG node: ${cleanTag}`);
  }
  const renderedAttrs = Object.entries(attrs)
    .filter(([key]) => key !== 'key')
    .map(([key, value]) => `${escapeHtml(key)}="${escapeHtml(value)}"`)
    .join(' ');
  return `<${cleanTag}${renderedAttrs ? ` ${renderedAttrs}` : ''}></${cleanTag}>`;
}

function renderShilohIcon(name, {
  size = 18,
  className = '',
  label = '',
  strokeWidth = 2,
} = {}) {
  const icon = SHILOH_ICONS[name];
  if (!icon) throw new Error(`Unknown Shiloh icon: ${name}`);
  const px = normalizeSize(size);
  const stroke = Number.isFinite(Number(strokeWidth)) ? Math.min(3, Math.max(1, Number(strokeWidth))) : 2;
  const classes = ['shiloh-icon', className].filter(Boolean).join(' ');
  const accessibility = label
    ? `role="img" aria-label="${escapeHtml(label)}"`
    : 'aria-hidden="true" focusable="false"';
  const body = icon.map(renderNode).join('');
  return `<svg class="${escapeHtml(classes)}" data-shiloh-icon="${escapeHtml(name)}" xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ${accessibility}>${body}</svg>`;
}

module.exports = {
  SHILOH_ICONS,
  renderShilohIcon,
};
