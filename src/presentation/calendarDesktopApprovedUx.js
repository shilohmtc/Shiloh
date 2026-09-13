const { renderLucideIcon } = require('./lucideIcons');
const BUSINESS_TIMEZONE = 'Africa/Johannesburg';
const DESKTOP_GRID_START_MINUTES = 7 * 60;
const DESKTOP_GRID_END_MINUTES = 18 * 60;
const DESKTOP_GRID_PIXELS_PER_HOUR = 72;

function compactWeekLabel(dateKeys = []) {
  const keys = (dateKeys || []).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')));
  if (!keys.length) return '';
  const first = new Date(`${keys[0]}T12:00:00+02:00`);
  const last = new Date(`${keys.at(-1)}T12:00:00+02:00`);
  const part = (date, options) => new Intl.DateTimeFormat('en-ZA', { timeZone: BUSINESS_TIMEZONE, ...options }).format(date).replace(/^Sept$/i, 'Sep');
  const firstDay = part(first, { day: 'numeric' });
  const lastDay = part(last, { day: 'numeric' });
  const firstMonth = part(first, { month: 'short' });
  const lastMonth = part(last, { month: 'short' });
  const year = part(last, { year: 'numeric' });
  return firstMonth === lastMonth
    ? `${firstDay}–${lastDay} ${lastMonth} ${year}`
    : `${firstDay} ${firstMonth}–${lastDay} ${lastMonth} ${year}`;
}

function desktopTimeLabels() {
  const labels = [];
  for (let minute = DESKTOP_GRID_START_MINUTES; minute <= DESKTOP_GRID_END_MINUTES; minute += 60) {
    labels.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:00`);
  }
  return labels;
}

function canonicalLaneStaffId(staffIds = [], visibleStaffIds = []) {
  const assigned = (staffIds || []).map(Number).filter(Number.isSafeInteger);
  return (visibleStaffIds || []).map(Number).find(id => assigned.includes(id)) || assigned[0] || null;
}

function iconSvg(name) {
  return renderLucideIcon(name, { className: 'calendar-action-icon', size: 16 });
}

function desktopFirstPaintStyles() {
  return `@keyframes shiloh-calendar-desktop-first-paint-fallback{to{opacity:1;visibility:visible}}@media(min-width:701px){body[data-calendar-view="week"][data-calendar-desktop-pending="true"] .workspace-main>.shell{opacity:0;visibility:hidden;animation:shiloh-calendar-desktop-first-paint-fallback 0s 1500ms forwards}}`;
}

function desktopApprovedStyles() {
  const gridHeight = ((DESKTOP_GRID_END_MINUTES - DESKTOP_GRID_START_MINUTES) / 60) * DESKTOP_GRID_PIXELS_PER_HOUR;
  return `@media(min-width:701px){
body[data-calendar-desktop-approved="true"]{background:#f4f1e8}
body[data-calendar-desktop-approved="true"] .workspace-frame{grid-template-columns:204px minmax(0,1fr)}
body[data-calendar-desktop-approved="true"] .workspace-main .shell{max-width:none;padding:24px 28px 40px}
body[data-calendar-desktop-approved="true"] .topbar{margin-bottom:14px;align-items:center}
body[data-calendar-desktop-approved="true"] .brand h1{font-size:1.55rem;color:#17382d}
body[data-calendar-desktop-approved="true"] .brand p{margin-top:4px}
body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar{display:flex;align-items:center;gap:10px;min-height:48px;margin-bottom:10px;padding:7px 8px;border:1px solid var(--line);border-radius:14px;background:#fffdf9;box-shadow:0 3px 12px rgba(32,50,43,.045)}
body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar .period-nav{display:grid;grid-template-columns:38px minmax(150px,auto) 38px;gap:4px;align-items:center}
body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar .period-context{font-size:.92rem;color:#20322b}
body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar .view-tabs{margin-left:auto;display:flex;gap:4px}
body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar .nav-button,body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar .view-tab{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;border-radius:9px;padding:6px 10px}
body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar .period-arrow{width:38px;padding:0}
body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar .view-tab.active{background:#e6eee9;color:#17382d;border-color:#cfddd4}
body[data-calendar-desktop-approved="true"] .desktop-calendar-toolbar .today{background:#fff;color:#17382d;border-color:#b8c9bf;font-weight:800}
body[data-calendar-desktop-approved="true"] .calendar-action-icon{width:16px;height:16px;flex:0 0 16px}
body[data-calendar-desktop-approved="true"] .desktop-create-menu{position:relative;margin-left:2px}
body[data-calendar-desktop-approved="true"] .desktop-create-menu>summary{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:7px 13px;border:1px solid #17382d;border-radius:9px;background:#17382d;color:#fff;font-size:.8rem;font-weight:850;list-style:none;cursor:pointer;white-space:nowrap}
body[data-calendar-desktop-approved="true"] .desktop-create-menu>summary::-webkit-details-marker,body[data-calendar-desktop-approved="true"] .desktop-create-submenu>summary::-webkit-details-marker{display:none}
body[data-calendar-desktop-approved="true"] .desktop-create-popover{position:absolute;right:0;top:calc(100% + 6px);z-index:30;display:grid;gap:3px;min-width:230px;padding:6px;border:1px solid var(--line);border-radius:11px;background:#fff;box-shadow:0 15px 32px rgba(20,45,35,.18)}
body[data-calendar-desktop-approved="true"] .desktop-create-popover>a,body[data-calendar-desktop-approved="true"] .desktop-create-popover>.lane>button,body[data-calendar-desktop-approved="true"] .desktop-create-submenu>summary{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:#20322b;font:inherit;font-size:.78rem;font-weight:750;text-align:left;cursor:pointer;text-decoration:none;list-style:none}
body[data-calendar-desktop-approved="true"] .desktop-create-popover>a:hover,body[data-calendar-desktop-approved="true"] .desktop-create-popover>.lane>button:hover,body[data-calendar-desktop-approved="true"] .desktop-create-submenu>summary:hover{background:#e7eee9}
body[data-calendar-desktop-approved="true"] .desktop-create-popover>a[data-calendar-booking-kind="couples"]{background:#fbf5f8;color:#633f55}
body[data-calendar-desktop-approved="true"] .desktop-create-popover>a[data-calendar-booking-kind="couples"]:hover{background:#f4e8ee}
body[data-calendar-desktop-approved="true"] .desktop-create-popover>a[data-calendar-booking-kind="couples"]::after{content:'2 guests';margin-left:auto;padding:2px 6px;border-radius:999px;background:#ead9e1;color:#633f55;font-size:.62rem;font-weight:850;white-space:nowrap}
body[data-calendar-desktop-approved="true"] .desktop-create-divider{height:1px;margin:4px 5px;background:var(--line)}
body[data-calendar-desktop-approved="true"] .desktop-create-popover>.lane{border:0;border-radius:0;background:transparent;overflow:visible}
body[data-calendar-desktop-approved="true"] .desktop-create-popover>.lane>h3{display:none}
body[data-calendar-desktop-approved="true"] .desktop-create-practitioners{display:grid;gap:2px;padding:2px 5px 5px 14px}
body[data-calendar-desktop-approved="true"] .desktop-create-practitioners .lane{border:0;background:transparent;border-radius:0;overflow:visible}
body[data-calendar-desktop-approved="true"] .desktop-create-practitioners .lane>h3{display:none}
body[data-calendar-desktop-approved="true"] .desktop-create-practitioners button{display:flex;width:100%;min-height:34px;align-items:center;padding:6px 8px;border:0;border-radius:7px;background:#f7f8f5;color:#294c3c;font:inherit;font-size:.74rem;font-weight:750;cursor:pointer}
body[data-calendar-desktop-approved="true"] .controls{display:block;margin:0 0 10px;padding:0;border:0;background:transparent;box-shadow:none}
body[data-calendar-desktop-approved="true"] .controls>.control-group:not(.practitioner-control){display:none}
body[data-calendar-desktop-approved="true"] .practitioner-control{display:flex;align-items:center;justify-content:flex-end;min-height:38px}
body[data-calendar-desktop-approved="true"] .practitioner-control .control-label{display:none}
body[data-calendar-desktop-approved="true"] .people-picker>summary{border-radius:9px;background:#fffdf9}
body[data-calendar-desktop-approved="true"] .desktop-week-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px;margin:0 0 10px}
body[data-calendar-desktop-approved="true"] .desktop-week-day{display:grid;grid-template-columns:auto auto;align-items:center;justify-content:center;gap:6px;min-height:46px;padding:6px 8px;border:1px solid var(--line);border-radius:10px;background:#fffdf9;color:#66776f;font-size:.75rem;font-weight:750}
body[data-calendar-desktop-approved="true"] .desktop-week-day strong{font-size:.92rem;color:#20322b}
body[data-calendar-desktop-approved="true"] .desktop-week-day small{grid-column:1/-1;margin-top:-4px;font-size:.58rem;text-transform:uppercase;letter-spacing:.06em}
body[data-calendar-desktop-approved="true"] .desktop-week-day.selected,body[data-calendar-desktop-approved="true"] .desktop-week-day.today{border-color:#294c3c}
body[data-calendar-desktop-approved="true"] .desktop-week-day.selected{background:#234f3b;color:#fff;font-weight:850;box-shadow:0 2px 8px rgba(35,79,59,.18),inset 0 0 0 1px rgba(255,255,255,.18)}
body[data-calendar-desktop-approved="true"] .desktop-week-day.selected strong{color:#fff}
body[data-calendar-desktop-approved="true"] .desktop-week-day.today:not(.selected){background:#dfeae3;color:#234f3b;border-color:#5d7f6c;box-shadow:inset 0 0 0 1px rgba(41,76,60,.08)}
body[data-calendar-desktop-approved="true"] .scan-summary{display:none}
body[data-calendar-desktop-approved="true"] .day-time-grid .lanes{grid-template-columns:repeat(var(--lane-count),minmax(300px,1fr))!important;min-width:max-content!important;width:100%!important}
body[data-calendar-desktop-approved="true"] .day-time-grid .lane{min-width:300px!important;width:auto!important}
body[data-calendar-desktop-approved="true"] .week-view{padding:0;border:1px solid var(--line);border-radius:14px;background:#fffdf9;box-shadow:0 5px 18px rgba(32,50,43,.05);overflow:visible}
body[data-calendar-desktop-approved="true"] .week-view>.view-heading,body[data-calendar-desktop-approved="true"] .week-view>.view-practitioner-context,body[data-calendar-desktop-approved="true"] .week-view>.calendar-booking-hint{display:none}
body[data-calendar-desktop-approved="true"] .week-time-grid{display:grid!important;grid-template-columns:54px minmax(0,1fr)!important;overflow:visible!important;max-height:none!important;border:0!important;border-radius:0!important;background:#fffdf9!important}
body[data-calendar-desktop-approved="true"] .week-time-grid>.time-rail{height:${gridHeight}px!important;margin-top:54px!important;border-right:1px solid var(--line)!important;background:#faf9f4!important}
body[data-calendar-desktop-approved="true"] .week-time-grid>.time-rail span{display:block}
body[data-calendar-desktop-approved="true"] .week-time-grid>.time-rail span:nth-last-child(-n+2){display:none!important}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-grid{display:grid;grid-template-columns:repeat(var(--desktop-practitioner-count),minmax(0,1fr));min-width:0;width:100%;gap:0}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane{min-width:0;border:0;border-right:1px solid var(--line);border-radius:0;background:#fff;overflow:visible}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane:last-child{border-right:0}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane>header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:center;height:54px;min-height:54px;padding:7px 6px;border-bottom:1px solid var(--line);background:#fafbf8;text-align:center}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane h3{margin:0;font-size:.82rem;color:#17382d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .time-column{height:${gridHeight}px!important;min-height:${gridHeight}px!important;overflow:hidden;background:repeating-linear-gradient(to bottom,transparent 0,transparent 71px,var(--line) 71px,var(--line) 72px)!important}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .calendar-booking-slots{display:block!important}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .positioned-event{left:4px!important;right:4px!important;width:auto!important;min-height:32px!important;overflow:visible!important}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-card{height:100%;min-width:0;padding:7px 8px;border:1px solid var(--calendar-event-border,#c7dccf);border-left:4px solid var(--calendar-event-accent,#4f7d64);border-radius:8px;background-color:var(--calendar-event-surface,#eef6f0);background-image:var(--calendar-event-pattern,none);box-shadow:0 2px 8px rgba(32,50,43,.08);overflow:hidden}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-card-top{align-items:center}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-time{font-size:.71rem;color:#315b47;font-weight:850;letter-spacing:.01em}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .kind-pill{font-size:.58rem;color:#52655c;font-weight:750}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-card h4{display:-webkit-box;margin:3px 0 2px;font-size:.78rem;line-height:1.15;padding:0;white-space:normal;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-client-mobile,body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .appointment-reference,body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .provenance,body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-practitioners{display:none!important}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-meta{display:block;margin:3px 0 0;padding:0;font-size:.64rem;line-height:1.12;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#53665d}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-service-context{display:inline-flex;max-width:100%;overflow:hidden;vertical-align:middle}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-service-context>span:last-child{display:-webkit-box;overflow:hidden;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-detail-separator,body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-state{display:none!important}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-card-actions{position:static;margin:0}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-card[data-appointment-management-target="true"] .event-operation{display:none!important}
body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-card[data-appointment-management-target="true"]{cursor:pointer}
body[data-calendar-desktop-approved="true"] .footer-note{margin-top:10px}
body[data-calendar-desktop-approved="true"] .week-grid[data-desktop-source-week]{display:none!important}
}
@media(min-width:701px) and (max-width:1120px){body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-service-context .service-family-icon{display:none}body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane .event-card{padding-left:5px;padding-right:5px}body[data-calendar-desktop-approved="true"] .desktop-practitioner-lane h3{font-size:.75rem}}`;
}

function calendarDesktopApprovedClientScript() {
  const css = JSON.stringify(desktopApprovedStyles());
  const icons = JSON.stringify({
    plus: iconSvg('plus'), calendarPlus: iconSvg('calendarPlus'), couples: iconSvg('couples'), history: iconSvg('history'), block: iconSvg('block'),
    leave: iconSvg('leave'), chevronLeft: iconSvg('chevronLeft'), chevronRight: iconSvg('chevronRight'), today: iconSvg('today'),
  });
  return `(()=>{'use strict';
const body=document.body;if(!body||!body.dataset.calendarView)return;
if(!window.matchMedia('(min-width:701px)').matches){body.removeAttribute('data-calendar-desktop-pending');return;}body.dataset.calendarDesktopApproved='true';
const CSS_TEXT=${css};const ICONS=${icons};const one=(selector,root=document)=>root.querySelector(selector);const all=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
const esc=value=>{const span=document.createElement('span');span.textContent=String(value||'');return span.innerHTML;};const params=new URLSearchParams(location.search);const view=body.dataset.calendarView||params.get('view')||'week';
function businessToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));return map.year+'-'+map.month+'-'+map.day;}
function keepStaff(target){for(const value of params.getAll('staff'))target.append('staff',value);const active=params.get('activeStaff');if(active)target.set('activeStaff',active);}
function calendarHref(targetView,date){const next=new URLSearchParams({view:targetView,date});keepStaff(next);return location.pathname+'?'+next.toString();}
function compactLabel(keys){if(!keys.length)return'';const parse=key=>new Date(key+'T12:00:00+02:00');const first=parse(keys[0]),last=parse(keys[keys.length-1]);const day=date=>new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',day:'numeric'}).format(date);const month=date=>new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',month:'short'}).format(date).replace(/^Sept$/i,'Sep');const year=new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',year:'numeric'}).format(last);return month(first)===month(last)?day(first)+'–'+day(last)+' '+month(last)+' '+year:day(first)+' '+month(first)+'–'+day(last)+' '+month(last)+' '+year;}
function installStyles(){const style=document.createElement('style');style.dataset.calendarDesktopApprovedStyles='true';style.textContent=CSS_TEXT;document.head.appendChild(style);}
function extractDays(){return all('.week-date-lane[data-date]').map(lane=>lane.dataset.date).filter(Boolean);}
function selectedDate(days){const requested=params.get('date');if(requested&&days.includes(requested))return requested;return days[0]||requested||businessToday();}
function iconizeLink(link,name,label){link.innerHTML=ICONS[name]+'<span>'+esc(label)+'</span>';}
function buildToolbar(days,selected){const controls=one('.controls');if(!controls)return null;const period=one('.period-nav',controls),tabs=one('.view-tabs',controls),today=one('.today',controls);if(!period||!tabs||!today)return null;const teamDay=one('[data-calendar-view-option="week"]',tabs);if(teamDay){teamDay.textContent='Team day';teamDay.setAttribute('aria-label','Team day calendar');}const context=one('.period-context',period);if(context&&days.length)context.textContent=compactLabel(days);const arrows=all('.period-arrow',period);if(arrows[0])arrows[0].innerHTML=ICONS.chevronLeft;if(arrows[1])arrows[1].innerHTML=ICONS.chevronRight;today.href=calendarHref('week',businessToday());iconizeLink(today,'today','Today');const toolbar=document.createElement('section');toolbar.className='desktop-calendar-toolbar';toolbar.setAttribute('aria-label','Calendar navigation');toolbar.append(period,tabs,today);const menu=document.createElement('details');menu.className='desktop-create-menu';menu.innerHTML='<summary aria-label="Book or add calendar item">'+ICONS.plus+'<span>Book</span></summary><div class="desktop-create-popover" data-desktop-create-popover></div>';toolbar.append(menu);controls.parentNode.insertBefore(toolbar,controls);const popover=one('[data-desktop-create-popover]',menu);all('.operational-actions a').forEach(link=>{const clone=link.cloneNode(true);clone.className='';const isPast=/Record past/i.test(link.textContent);iconizeLink(clone,isPast?'history':'calendarPlus',isPast?'Record past appointment':'New appointment');popover.append(clone);if(!isPast){const couples=document.createElement('a');couples.href='/calendar/book/couples?'+new URLSearchParams({date:selected}).toString();couples.dataset.calendarBookingKind='couples';couples.setAttribute('aria-label','Book a Couples Massage for two guests');iconizeLink(couples,'couples','Couples massage');popover.append(couples);}});all('.operational-actions').forEach(node=>node.remove());return {menu,popover};}
function buildWeekStrip(days,selected,anchor){if(view!=='week'||!days.length||!anchor)return;const today=businessToday();const nav=document.createElement('nav');nav.className='desktop-week-strip';nav.setAttribute('aria-label','Week dates');days.forEach(key=>{const date=new Date(key+'T12:00:00+02:00');const weekday=new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',weekday:'short'}).format(date);const day=new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',day:'numeric'}).format(date);const link=document.createElement('a');link.className='desktop-week-day'+(key===selected?' selected':'')+(key===today?' today':'');link.href=calendarHref('week',key);link.innerHTML='<span>'+esc(weekday)+'</span><strong>'+esc(day)+'</strong>'+(key===today?'<small>Today</small>':'');if(key===selected)link.setAttribute('aria-current','date');nav.append(link);});anchor.parentNode.insertBefore(nav,anchor);}
function visiblePractitioners(){return all('.view-practitioner[data-staff-id]').map(node=>({id:Number(node.dataset.staffId),name:node.textContent.trim()})).filter(person=>Number.isSafeInteger(person.id));}
function canonicalStaff(card,people){const assigned=String(card.dataset.eventStaffIds||'').split(',').map(Number).filter(Number.isSafeInteger);for(const person of people)if(assigned.includes(person.id))return person.id;return assigned[0]||null;}
function rewriteKinds(root){all('.event-card[data-kind="calendar_block"] .kind-pill',root).forEach(node=>node.textContent='Block time');all('.event-card[data-kind="operational_leave"] .kind-pill,.event-card[data-kind="approved_leave"] .kind-pill',root).forEach(node=>node.textContent='Leave');}
function cloneBookingSlots(source,target,person,selected){const original=one('.calendar-booking-slots',source);if(!original)return;const layer=original.cloneNode(true);all('.calendar-booking-slot',layer).forEach(slot=>{if(String(slot.dataset.time||'')>='18:00'){slot.remove();return;}const url=new URL(slot.getAttribute('href')||location.href,location.origin);url.searchParams.set('date',selected);url.searchParams.set('staff',String(person.id));slot.href=url.pathname+'?'+url.searchParams.toString();slot.dataset.date=selected;slot.dataset.staffId=String(person.id);slot.setAttribute('aria-label','Create booking on '+selected+' at '+String(slot.dataset.time||'')+' for '+person.name);});target.append(layer);}
function buildPlanner(selected){if(view!=='week')return;const grid=one('.week-grid');const timeGrid=one('.week-time-grid');if(!grid||!timeGrid)return;const source=one('.week-date-lane[data-date="'+CSS.escape(selected)+'"]',grid)||one('.week-date-lane',grid);if(!source)return;const people=visiblePractitioners();if(!people.length)return;const planner=document.createElement('div');planner.className='desktop-practitioner-grid';planner.style.setProperty('--desktop-practitioner-count',String(people.length));const columns=new Map();people.forEach(person=>{const lane=document.createElement('section');lane.className='desktop-practitioner-lane lane';lane.dataset.staffId=String(person.id);lane.dataset.date=selected;lane.innerHTML='<header><h3>'+esc(person.name)+'</h3></header><div class="time-column"></div>';const column=one('.time-column',lane);cloneBookingSlots(source,column,person,selected);columns.set(person.id,column);planner.append(lane);});all('.positioned-event,.time-column>.event-card',source).filter(node=>node.closest('.week-date-lane')===source).forEach(node=>{const card=node.matches('.event-card')?node:one('.event-card',node);if(!card)return;const target=columns.get(canonicalStaff(card,people));if(target)target.append(node);});rewriteKinds(planner);grid.dataset.desktopSourceWeek='true';timeGrid.append(planner);}
function collectAvailability(doc){const result={block:new Map(),leave:new Map()};all('.lane',doc).forEach(lane=>{const id=Number(lane.dataset.staffId);const name=one('h3',lane)?.textContent.trim()||('Practitioner '+id);if(!Number.isSafeInteger(id))return;const block=one('[data-calendar-operation="add-block"]',lane);const leave=one('[data-calendar-operation="add-leave"]',lane);if(block)result.block.set(id,{id,name,date:block.dataset.date||params.get('date')||businessToday()});if(leave)result.leave.set(id,{id,name,date:leave.dataset.date||params.get('date')||businessToday()});});return result;}
function appendAvailability(popover,label,operation,entries,iconName){const values=Array.from(entries.values());if(!values.length)return;if(values.length===1){const item=values[0],lane=document.createElement('span');lane.className='lane';lane.dataset.staffId=String(item.id);lane.innerHTML='<h3 class="sr-only">'+esc(item.name)+'</h3><button type="button" data-calendar-operation="'+operation+'" data-staff-id="'+item.id+'" data-date="'+esc(item.date)+'">'+ICONS[iconName]+'<span>'+esc(label)+'</span></button>';popover.append(lane);return;}const details=document.createElement('details');details.className='desktop-create-submenu';details.innerHTML='<summary>'+ICONS[iconName]+'<span>'+esc(label)+'</span></summary><div class="desktop-create-practitioners"></div>';const list=one('.desktop-create-practitioners',details);values.forEach(item=>{const lane=document.createElement('span');lane.className='lane';lane.dataset.staffId=String(item.id);lane.innerHTML='<h3>'+esc(item.name)+'</h3><button type="button" data-calendar-operation="'+operation+'" data-staff-id="'+item.id+'" data-date="'+esc(item.date)+'">'+esc(item.name)+'</button>';list.append(lane);});popover.append(details);}
async function populateAvailability(popover,selected){if(!popover||body.dataset.calendarReadonly==='true')return;let source=document;if(!one('[data-calendar-operation="add-block"], [data-calendar-operation="add-leave"]')){try{const url=new URL(location.href);url.searchParams.set('view','day');url.searchParams.set('date',selected);const response=await fetch(url.pathname+'?'+url.searchParams.toString(),{credentials:'same-origin',cache:'no-store',headers:{Accept:'text/html'}});if(!response.ok)return;source=new DOMParser().parseFromString(await response.text(),'text/html');}catch(_error){return;}}const allowed=collectAvailability(source);if(allowed.block.size||allowed.leave.size){const divider=document.createElement('div');divider.className='desktop-create-divider';divider.setAttribute('role','separator');divider.setAttribute('aria-label','Availability controls');popover.append(divider);}appendAvailability(popover,'Block time','add-block',allowed.block,'block');appendAvailability(popover,'Leave','add-leave',allowed.leave,'leave');}
installStyles();const days=extractDays();const selected=selectedDate(days);const toolbar=buildToolbar(days,selected);buildWeekStrip(days,selected,one('.week-view'));buildPlanner(selected);if(toolbar)populateAvailability(toolbar.popover,selected);body.removeAttribute('data-calendar-desktop-pending');
})();`;
}

module.exports = {
  BUSINESS_TIMEZONE,
  DESKTOP_GRID_START_MINUTES,
  DESKTOP_GRID_END_MINUTES,
  DESKTOP_GRID_PIXELS_PER_HOUR,
  compactWeekLabel,
  desktopTimeLabels,
  canonicalLaneStaffId,
  iconSvg,
  desktopFirstPaintStyles,
  desktopApprovedStyles,
  calendarDesktopApprovedClientScript,
};
