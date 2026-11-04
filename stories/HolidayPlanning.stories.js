import presentation from '../src/presentation/workspaceClinicHoursUx.js';
const { renderClinicHoursPage } = presentation;
export default { title: 'Workspace/Holiday planning', parameters: { layout: 'fullscreen' } };
export const Upcoming = { render: () => {
  const html = renderClinicHoursPage({ today: '2026-12-15', days: [], exceptions: [{exceptionDate:'2026-12-10',holidayName:'Synthetic saved date',exceptionType:'open',startsLocal:'10:00',endsLocal:'13:00'}], location: { name: 'Shiloh' }, holidays: [
    { exceptionDate: '2026-12-16', holidayName: 'Day of Reconciliation', decisionNeeded: true },
    { exceptionDate: '2026-12-24', holidayName: 'Christmas Eve', decisionNeeded: true },
    { exceptionDate: '2026-12-25', holidayName: 'Christmas Day', clinicExceptionType: 'open', clinicStartsLocal: '09:00', clinicEndsLocal: '12:00', decisionNeeded: false },
    { exceptionDate: '2026-12-31', holidayName: 'Synthetic planning date', decisionNeeded: true },
    { exceptionDate: '2027-01-01', holidayName: 'New Year’s Day', decisionNeeded: true },
    { exceptionDate: '2027-03-21', holidayName: 'Human Rights Day', decisionNeeded: true },
    { exceptionDate: '2027-03-22', holidayName: 'Human Rights Day (Observed)', decisionNeeded: true },
  ] });
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x => x[1]).join('\n');
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
  return `<style>${styles}</style>${body.replaceAll("/calendar/pwa/icon-192.png?v=official-brand-v4", "/assets/brand/shiloh-mark-192.png")}`;
} };


export const ElectionDay = { render: () => {
  const html = renderClinicHoursPage({ today: '2026-11-03', days: [], location: { name: 'Shiloh' }, holidays: [
    { exceptionDate: '2026-11-04', holidayName: 'Local Government Election Day', decisionNeeded: true },
    { exceptionDate: '2026-12-24', holidayName: 'Christmas Eve', decisionNeeded: false },
  ] });
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x => x[1]).join('\n');
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
  return `<style>${styles}</style>${body.replaceAll("/calendar/pwa/icon-192.png?v=official-brand-v4", "/assets/brand/shiloh-mark-192.png")}`;
} };

export const Empty = { render: () => {
  const html = renderClinicHoursPage({today:'2026-12-15',days:[],holidays:[],exceptions:[]});
  return `<style>${[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('')}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1]}`;
} };
export const ReadOnly = { render: () => {
  const html = renderClinicHoursPage({readOnly:true,today:'2026-12-15',days:[],holidays:[{exceptionDate:'2026-12-16',holidayName:'Synthetic public holiday',decisionNeeded:true}],exceptions:[{exceptionDate:'2026-12-10',exceptionType:'closed'}]});
  return `<style>${[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('')}</style>${html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1]}`;
} };
