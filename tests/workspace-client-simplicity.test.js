'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createWorkspaceNavigationService}=require('../src/services/workspaceNavigation');
const {renderClientListPage,renderClientDetailPage}=require('../src/presentation/workspaceClientsUx');
const {injectClientListManagement,injectClientDetailManagement}=require('../src/presentation/workspaceClientsManageUx');

test('clinic check-in menu reuses activation authority and feature flag, failing closed',async()=>{
 const denied={resolveAccess:async()=>null};
 const options=Object.fromEntries(['website','client','staff','services','forms','reports','clinicHours','voucher','rewards'].map(key=>[key+'AccessService',denied]));
 options.problemReportsAccessService={resolveWorkspaceAccess:async()=>null};
 let calls=0;let authority={clientScope:{kind:'clinic'}};
 options.checkinAccessService={canActivate:async id=>{assert.equal(id,41);calls++;return authority;}};
 options.env={SHILOH_CLINIC_IPAD_CHECKIN_ENABLED:'false'};
 const service=createWorkspaceNavigationService(options);
 assert.equal((await service.resolve({session:{adminId:41}})).clinicCheckin.allowed,false);assert.equal(calls,0);
 options.env.SHILOH_CLINIC_IPAD_CHECKIN_ENABLED='true';
 assert.deepEqual((await service.resolve({session:{adminId:41}})).clinicCheckin,{allowed:true,href:'/calendar/check-in/devices'});
 authority={clientScope:{kind:'tenant_staff'}};
 assert.equal((await service.resolve({session:{adminId:41}})).clinicCheckin.allowed,false);
 options.checkinAccessService.canActivate=async()=>{throw Error('unavailable');};
 assert.equal((await service.resolve({session:{adminId:41}})).clinicCheckin.allowed,false);
});

test('Directory displays conservative account indicators and removes check-in from Add client',()=>{
 const model={clients:[{id:1,name:'Synthetic',status:'active',appStatus:{usage:'Used before',phoneAlerts:'Enabled'}},{id:2,name:'Other',status:'active'}],manageAllowed:true};
 const html=injectClientListManagement(renderClientListPage(model),model,{checkinEnabled:true});
 assert.match(html,/My Shiloh: <strong>Used before/);assert.match(html,/Notifications: <strong>Enabled/);
 assert.match(html,/My Shiloh: <strong>Not yet confirmed/);assert.match(html,/Notifications: <strong>Unknown/);
 assert.doesNotMatch(html,/Manage clinic iPad/);assert.match(html,/method="get" action="\/calendar\/clients"/);
});

test('inline editors have one field per value with original revision, and remain absent for read-only staff',()=>{
 const model={client:{id:1,name:'Synthetic',status:'active',revision:'original',gender:'non_binary'},appointments:[],manageAllowed:true,authority:{deleteAllowed:true}};
 const html=injectClientDetailManagement(renderClientDetailPage(model),model);
 for(const key of ['name','mobile','dob','gender'])assert.equal((html.match(new RegExp('id="edit-client-'+key+'"','g'))||[]).length,1);
 assert.match(html,/data-client-revision="original"/);assert.match(html,/value="non_binary" selected hidden/);
 assert.match(html,/More options/);assert.match(html,/Save changes/);assert.doesNotMatch(html,/data-client-edit-details/);
 model.manageAllowed=false;
 assert.doesNotMatch(injectClientDetailManagement(renderClientDetailPage(model),model),/data-client-editor|Delete client/);
});
