const test=require('node:test');
const assert=require('node:assert/strict');
const {calendarReturnHref}=require('../src/presentation/calendarReturnContext');
const {workspaceBookingStatus}=require('../src/presentation/workspaceBookingStatus');
const {statusPresentation}=require('../src/presentation/workspaceDashboardUx');

test('Calendar return accepts only existing view/filter context and binds the selected appointment',()=>{
 const raw='/calendar/read-only?view=week&date=2026-10-09&staff=51&staff=52&phoneStaff=51,52&activeStaff=52&phoneLayout=roomier&appointment=999&evil=https://other.test';
 const out=new URL(calendarReturnHref(raw,5),'https://local.test');
 assert.equal(out.pathname,'/calendar/read-only');assert.equal(out.searchParams.get('date'),'2026-10-09');assert.deepEqual(out.searchParams.getAll('staff'),['51','52']);assert.equal(out.searchParams.get('phoneStaff'),'51,52');assert.equal(out.searchParams.get('appointment'),'5');assert.equal(out.searchParams.get('evil'),null);
 for(const bad of ['https://other.test','//other.test','/calendar','/calendar/read-only/other?view=week'])assert.equal(calendarReturnHref(bad,5),'/calendar/read-only?appointment=5');
 assert.equal(calendarReturnHref('/calendar/read-only?view=wrong&staff=-2&date=oops&phoneLayout=wrong',5),'/calendar/read-only?appointment=5');
});

test('Dashboard Today and client history share approval labels without confusing final outcomes',()=>{
 for(const state of ['pending','awaiting_client_confirmation']){
  const item={status:'scheduled',bookingRequestState:state};
  const expected=state==='pending'?'Awaiting confirmation':'Awaiting client response';
  assert.equal(workspaceBookingStatus(item),expected);assert.equal(statusPresentation(item.status,item).label,expected);
 }
 assert.equal(workspaceBookingStatus({status:'completed',bookingRequestState:'pending'}),'completed');
 assert.equal(workspaceBookingStatus({status:'no_charge'}),'no charge');
 assert.equal(workspaceBookingStatus({status:'no_show'}),'no show');
 assert.equal(workspaceBookingStatus({status:'confirmed'}),'confirmed');
});
