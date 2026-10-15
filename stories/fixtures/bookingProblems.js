// Fabricated people and incident references only. No production exports.
const {desktopDashboardModel,desktopNavigation}=require('./workspaceDesktopLayout');
const {renderDashboardPage,dashboardClientScript}=require('../../src/presentation/workspaceDashboardUx');
const {bookingProblemsClientScript,bookingProblemsContent}=require('../../src/presentation/bookingProblemsUx');
function bookingProblemsModel(kind='recent') {
  const model=desktopDashboardModel('sparse');
  model.bookingRequests=[];model.planningRequests=[];model.rescheduleRequests=[];
  model.bookingProblems=kind==='unavailable'?{unavailable:true,items:[],pendingCount:0}:{pendingCount:1,filter:'all',offset:0,items:[
    {reference:'69edca79-077a-49d1-8fe4-8ba2d1bdc091',clientName:'Synthetic booking client',firstFailedAt:'2026-10-15T11:42:07Z',lastFailedAt:'2026-10-15T11:44:24Z',failureCount:5,status:'needs_help',revision:'5',canResolve:true,openClientHref:'/calendar/workspace/booking-problems/69edca79-077a-49d1-8fe4-8ba2d1bdc091/client'},
    {reference:'81dd496d-709b-45b3-a2c5-69ca6ebfc1b1',clientName:'Synthetic retry client',firstFailedAt:'2026-10-15T10:01:00Z',lastFailedAt:'2026-10-15T10:01:00Z',failureCount:1,status:'retry_succeeded',recoveredAt:'2026-10-15T10:03:00Z',revision:'2',canResolve:false,openClientHref:'/calendar/workspace/booking-problems/81dd496d-709b-45b3-a2c5-69ca6ebfc1b1/client'},
    {reference:'c8bc9c85-a6bb-4aba-9b97-8fd79a2b60fd',clientName:'Synthetic resolved client',firstFailedAt:'2026-10-14T08:01:00Z',lastFailedAt:'2026-10-14T08:01:00Z',failureCount:1,status:'resolved',resolvedAt:'2026-10-14T09:01:00Z',revision:'2',canResolve:false,openClientHref:'/calendar/workspace/booking-problems/c8bc9c85-a6bb-4aba-9b97-8fd79a2b60fd/client'},
  ]};
  return model;
}
function bookingProblemsHtml(kind='recent') {
  return renderDashboardPage(bookingProblemsModel(kind),{navigation:desktopNavigation})
    .replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g,'')
    .replace('</body>',`<script>${dashboardClientScript()}${bookingProblemsClientScript()}</script></body>`);
}
module.exports={bookingProblemsModel,bookingProblemsHtml,bookingProblemsContent,bookingProblemsClientScript};
