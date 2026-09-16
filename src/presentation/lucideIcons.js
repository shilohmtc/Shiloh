const {
  LayoutDashboard, CalendarDays, Users, MessageSquare, UserRoundPlus, Sparkles,
  ChartNoAxesColumnIncreasing, Clock3, LogOut, LockKeyhole, Plus, CalendarPlus,
  History, CircleSlash, CalendarMinus, ChevronLeft, ChevronRight, CalendarCheck,
  HeartHandshake, FileText,
} = require('lucide');

const ICONS = Object.freeze({
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  clients: Users,
  users: Users,
  messages: MessageSquare,
  staff: UserRoundPlus,
  services: Sparkles,
  forms: FileText,
  reports: ChartNoAxesColumnIncreasing,
  clinicHours: Clock3,
  logout: LogOut,
  lock: LockKeyhole,
  plus: Plus,
  calendarPlus: CalendarPlus,
  history: History,
  couples: HeartHandshake,
  block: CircleSlash,
  leave: CalendarMinus,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  today: CalendarCheck,
});

const ALLOWED_TAGS = new Set(['path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'ellipse']);
const ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
const CLASS_NAME = /^[A-Za-z0-9 _-]+$/;

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderNode(node) {
  if (!Array.isArray(node) || node.length < 2) throw new Error('Invalid Lucide icon node');
  const [tag, attributes, children] = node;
  if (!ALLOWED_TAGS.has(tag)) throw new Error(`Unsupported Lucide SVG tag: ${tag}`);
  const attrs = Object.entries(attributes || {})
    .filter(([name, value]) => name !== 'key' && value != null)
    .map(([name, value]) => {
      if (!ATTR_NAME.test(name)) throw new Error(`Invalid Lucide SVG attribute: ${name}`);
      return `${name}="${escapeAttribute(value)}"`;
    }).join(' ');
  const inner = Array.isArray(children) ? children.map(renderNode).join('') : '';
  return `<${tag}${attrs ? ` ${attrs}` : ''}>${inner}</${tag}>`;
}

function renderLucideIcon(name, { className = 'shiloh-icon', size = 24, strokeWidth = 2 } = {}) {
  const iconNode = ICONS[name];
  if (!iconNode) throw new Error(`Unknown Shiloh Lucide icon: ${name}`);
  const numericSize = Number(size);
  const numericStroke = Number(strokeWidth);
  if (!Number.isFinite(numericSize) || numericSize < 8 || numericSize > 96) throw new Error('Invalid Lucide icon size');
  if (!Number.isFinite(numericStroke) || numericStroke <= 0 || numericStroke > 4) throw new Error('Invalid Lucide stroke width');
  if (!CLASS_NAME.test(className)) throw new Error('Invalid Lucide icon class');
  return `<svg class="${escapeAttribute(className)}" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="${numericSize}" height="${numericSize}" fill="none" stroke="currentColor" stroke-width="${numericStroke}" stroke-linecap="round" stroke-linejoin="round">${iconNode.map(renderNode).join('')}</svg>`;
}

module.exports = { ICONS, renderLucideIcon };