'use strict';

// One scale for the entire timed surface; cards never receive extra duration.
function calendarPhoneRoomierStyles() {
  const scope = 'body[data-phone-column-mode="true"][data-phone-layout="roomier"]';
  const rules = [
    ['.phone-day-scroll', 'display:block;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain'],
    ['.phone-day-scroll-content', 'display:block;width:var(--phone-roomier-content-width);min-width:100%;position:relative'],
    ['.phone-day-notices', 'position:sticky;left:var(--phone-time-rail-width,32px);width:calc(var(--phone-roomier-viewport-width) - var(--phone-time-rail-width,32px));z-index:3;background:var(--panel,#fff)'],
    ['.phone-staff-column-header', 'position:sticky;top:0;z-index:5'],
    ['.phone-staff-column-name', 'font-size:.8rem;min-height:40px;white-space:normal;overflow-wrap:anywhere;text-align:center'],
    ['.workspace-main .calendar-view.week-view', 'overflow:hidden!important'],
    ['.workspace-main .calendar-view.week-view .week-time-grid', 'flex:none!important;height:var(--phone-roomier-grid-height)!important;min-height:var(--phone-roomier-grid-height)!important;max-height:none!important;overflow:visible!important'],
    ['.workspace-main .week-time-grid .time-rail', 'position:sticky!important;left:0;z-index:4;background:var(--panel,#fff)'],
    ['.workspace-main .week-time-grid .time-rail span', 'font-size:.75rem!important'],
    ['.workspace-main .week-view .positioned-event .event-card h4', 'font-size:.85rem!important;line-height:1.2!important'],
    ['.workspace-main .week-view .positioned-event[data-phone-roomy="true"] .event-card h4', '-webkit-line-clamp:3'],
    ['.workspace-main .week-view .positioned-event .event-time', 'font-size:.75rem!important;line-height:1.2!important'],
    ['.workspace-main .week-view .positioned-event .event-time-range', 'display:inline!important'],
    ['.workspace-main .week-view .positioned-event .event-time-start', 'display:none!important'],
    ['.workspace-main .week-view .positioned-event .event-meta', 'font-size:.75rem!important;line-height:1.2!important'],
    ['.workspace-main .week-view .positioned-event .event-service-context>span:last-child', 'white-space:normal;overflow-wrap:anywhere'],
  ];
  return '@media(max-width:700px){.phone-layout-controls{display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:3px 6px;flex:none;background:var(--panel,#fff)}.phone-layout-controls button{min-height:44px;padding:6px 10px;border:1px solid var(--line-strong);border-radius:8px;background:var(--panel,#fff);color:var(--ink);font:inherit;font-size:.75rem;font-weight:800;cursor:pointer}.phone-layout-controls button[aria-pressed="true"]{background:var(--leaf-soft);border-color:var(--leaf-deep);color:var(--leaf-deep)}.phone-layout-controls button:focus-visible,.phone-day-scroll:focus-visible{outline:3px solid var(--leaf-deep);outline-offset:-3px}.phone-layout-hint{flex-basis:100%;margin:0;color:var(--muted);font-size:.7rem}.phone-layout-hint[hidden]{display:none}.phone-day-scroll,.phone-day-scroll-content{display:contents}' + rules.map(([selector,css]) => scope+' '+selector+'{'+css+'}').join('') + '}';
}

module.exports = { calendarPhoneRoomierStyles };
