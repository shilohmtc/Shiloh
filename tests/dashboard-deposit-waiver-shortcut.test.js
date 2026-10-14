'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createWorkspaceDepositAttentionService}=require('../src/services/workspaceDepositAttention');
const {evaluateCalendarAuthority}=require('../src/services/calendarAuthorization');
const {depositQueueContent}=require('../src/presentation/workspaceDashboardUx');
const {renderDepositWaiverForm}=require('../src/presentation/bookingDepositWaiverUx');
const {waiverFixture}=require('../stories/fixtures/bookingDepositWaiverPresentation');
const now=new Date('2026-10-06T12:00:00Z');
const permissions={'appointment:view':true,'appointment:adjust_end':true,'calendar:booking:reschedule':true,'calendar:booking:cancel':true,'calendar:booking:reassign':true,'payment:view':true,'payment:collect':true};
function principal(id=2,changes={}) {const p={id,admin_active:true,staff_id:null,role:id===2?'owner':id===4?'admin':'receptionist',business_role:id===2?'owner':id===4?'business_admin':'booking_operator',calendar_scope:'all_business',service_scope:'all_services',permissions,...changes};return {...p,calendarAuthority:evaluateCalendarAuthority(p,{additionalCapabilities:['payment:view','payment:collect']})};}
async function fixture(run) {const pg=new PGlite();try {await pg.exec(require('./helpers/workspaceDepositFixture'));await pg.exec('CREATE TABLE staff_admin_accounts(id bigint,active boolean,staff_id bigint,role text,business_role text,calendar_scope text,service_scope text); INSERT INTO staff_admin_accounts VALUES(7,true,null,\'receptionist\',\'booking_operator\',\'all_business\',\'all_services\')');const queries=[];const service=createWorkspaceDepositAttentionService({db:{query(sql,args){assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|FOR SHARE)\b/);queries.push(sql);return pg.query(sql,args);}},deposits:{loadPolicy:async()=>({enabled:true,effectiveFrom:new Date('2026-09-01')})}});await run({pg,queries,service});}finally {await pg.close();}}
test('shortcut uses current canonical Christel, JP and singleton Reception authority; no privilege by name/role alone',()=>fixture(async({pg,service})=>{
 for(const id of [2,4,7]){const items=await service.list({principal:principal(id),now});assert.equal(items.length,1);assert.equal(items[0].canWaiveDeposit,true);assert.equal(items[0].members.length,2);assert.equal(items[0].outstanding,'350.00');}
 for(const p of [principal(8),principal(2,{role:'admin'}),principal(4,{business_role:'owner'}),principal(2,{permissions:{...permissions,'payment:collect':false}}),principal(2,{permissions:{...permissions,'calendar:booking:cancel':false}})]){const items=await service.list({principal:p,now});assert.equal(items[0].canWaiveDeposit,false);assert.equal(items[0].outstanding,'350.00');}
 await pg.exec("INSERT INTO staff_admin_accounts VALUES(8,true,null,'receptionist','booking_operator','all_business','all_services')");assert.equal((await service.list({principal:principal(7),now}))[0].canWaiveDeposit,false);
}));
test('whole-account shortcut excludes expired/review/unapproved shared deposits while retaining ordinary follow-up queue',()=>fixture(async({pg,service})=>{
 const list=()=>service.list({principal:principal(),now});
 await pg.exec("INSERT INTO payment_requests VALUES(1,1,'deposit',1,'expired',null,'2026-10-05')");assert.equal((await list())[0].canWaiveDeposit,false);assert.equal((await list())[0].outstanding,'350.00');
 await pg.exec("DELETE FROM payment_requests; INSERT INTO payment_requests VALUES(1,1,'deposit',1,'pending',null,'2026-10-05')");assert.equal((await list())[0].canWaiveDeposit,false);
 await pg.exec("DELETE FROM payment_requests; INSERT INTO payment_requests VALUES(1,1,'deposit',1,'pending',null,'2026-10-09')");assert.equal((await list())[0].canWaiveDeposit,true);
 await pg.exec("INSERT INTO crm_audit_events VALUES('booking_payment_account',1,'payment.received_after_no_charge')");assert.equal((await list())[0].canWaiveDeposit,false);
 await pg.exec("DELETE FROM crm_audit_events; UPDATE appointment_groups SET source='shiloh_my_shiloh_couples'");assert.equal((await list())[0].canWaiveDeposit,false);assert.equal((await list()).length,1);
 await pg.exec("INSERT INTO appointment_booking_approvals VALUES(1,'approved'),(2,'approved')");assert.equal((await list())[0].canWaiveDeposit,true);
 await pg.exec("UPDATE booking_deposit_requirement_members SET required_amount=-1 WHERE appointment_id=2");assert.equal((await list())[0].canWaiveDeposit,false);
}));
test('settled/waived/terminal deposits have no shortcut; current all-member scope remains required',()=>fixture(async({pg,service})=>{
 const list=()=>service.list({principal:principal(),now});
 await pg.exec("UPDATE booking_deposit_requirements SET state='waived'");assert.deepEqual(await list(),[]);
 await pg.exec("UPDATE booking_deposit_requirements SET state='awaiting'; INSERT INTO payment_ledger_entries VALUES(1,null,'payment',350)");assert.deepEqual(await list(),[]);
 await pg.exec("DELETE FROM payment_ledger_entries; UPDATE appointments SET status='cancelled'");assert.deepEqual(await list(),[]);
 await pg.exec("UPDATE appointments SET status='scheduled'");const restricted=principal(2);restricted.calendarAuthority.serviceScope='own_services';restricted.calendarAuthority.allowedServiceIds=[21];assert.deepEqual(await service.list({principal:restricted,now}),[]);
}));
test('only eligible explicit model flag adds secondary link beside unchanged review path and existing reason form anchor',()=>{
 const item={accountId:1,appointmentId:201,state:'partial',outstanding:'150.00',hasLink:true,members:[],canWaiveDeposit:true};
 const html=depositQueueContent({items:[item]});assert.match(html,/>Review payment<\/a><a data-workspace-action="secondary" class="button" href="\/calendar\/payments\/appointments\/201#deposit-waiver">Waive deposit<\/a>/);assert.match(html,/href="\/calendar\/payments\/appointments\/201">Review payment/);assert.match(html,/>View booking/);assert.doesNotMatch(depositQueueContent({items:[{...item,canWaiveDeposit:false}]}),/>Waive deposit/);
 assert.match(renderDepositWaiverForm(waiverFixture()),/<form id="deposit-waiver"/);assert.doesNotMatch(renderDepositWaiverForm(waiverFixture({allowed:false})),/id="deposit-waiver"/);
});
