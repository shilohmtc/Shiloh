'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {clientDeviceLabel,createClientPasskeyEnrollmentService}=require('../src/services/clientPasskeyEnrollment');
const {clientHarness}=require('./helpers/clientCodeHarness');
const {fixture,registrationResponse}=require('./helpers/workspaceWhatsAppWebauthn');
for(const [owner,agent,expected] of [
 [{first_name:'Jean-Pierre',name:'Different Name'},'Mozilla Android 15; SM-S938B','Jean-Pierre’s Android'],
 [{first_name:'Christel'},'Mozilla iPhone','Christel’s iPhone'],
 [{first_name:'James'},'Mozilla iPad','James’ iPad'],
 [{first_name:'  Ari\n ',name:'Ignored'},'Windows NT','Ari’s Windows device'],
 [{first_name:null,name:'Ari Example'},'Macintosh','Ari’s Mac'],
 [{first_name:'',name:'   '},'Android','Android device'],
 [null,null,'Shiloh device'],
 [{first_name:'Ari'},'unrecognized','Ari’s Shiloh device'],
 [{first_name:'X'.repeat(49)},'Android','Android'],
 [{first_name:'<b>Ari</b>'},'Android','<b>Ari</b>’s Android'],
 [{first_name:'Zoë'},'iPhone','Zoë’s iPhone'],
])test(`friendly new-key label: ${expected}`,()=>assert.equal(clientDeviceLabel(owner,agent),expected));
test('new registration stores only a friendly label and leaves existing keys and session intact',async t=>{
 const h=await clientHarness(t),owner=await h.owner({first_name:'Jean-Pierre',surname:'Synthetic'});
 const issued=await h.sessions.issueVerifiedPhoneCodeSession({transaction:h.db,crmV2ClientId:owner.id,normalizedMobile:h.context.mobile,channel:'whatsapp'});
 const session=await h.sessions.validateSessionToken(issued.sessionToken);assert.equal(session.ok,true);
 const original=(await h.db.query(`INSERT INTO client_auth_passkey_credentials(crm_v2_client_id,credential_id,public_key_spki,algorithm,sign_count,transports,backed_up,device_label)
 VALUES($1,$2,$3,-7,8,'["internal"]',true,'My manually named key') RETURNING *`,[owner.id,Buffer.alloc(24,6).toString('base64url'),Buffer.from('synthetic-public-key')])).rows[0];
 const sessions=(await h.db.query('SELECT * FROM client_browser_sessions')).rows;
 const service=createClientPasskeyEnrollmentService({db:h.db,env:{SHILOH_CLIENT_PASSKEY_AUTH_ENABLED:'true'},now:h.now});
 const challenge=await service.begin({session});assert.equal(challenge.ok,true);
 const response=registrationResponse(fixture(),{challenge:challenge.options.challenge,origin:'https://app.shilohmtc.co.za',rpId:'app.shilohmtc.co.za'});
 const result=await service.finish({session,response,userAgent:'Mozilla Android 15; SM-S938B'});assert.equal(result.ok,true);
 const rows=(await h.db.query('SELECT * FROM client_auth_passkey_credentials ORDER BY id')).rows;assert.equal(rows.length,2);assert.deepEqual(rows[0],original);assert.equal(rows[1].device_label,'Jean-Pierre’s Android');
 assert.equal(rows[1].credential_id,response.id);assert.equal(rows[1].sign_count,0);assert.equal(rows[1].revoked_at,null);
 assert.deepEqual((await h.db.query('SELECT * FROM client_browser_sessions')).rows,sessions);
 const listed=await service.list({session});assert.deepEqual(listed.devices.map(d=>d.label),['Jean-Pierre’s Android','My manually named key']);
 assert.equal((await service.rename({session,credentialId:Number(rows[1].id),label:'S25 Ultra'})).ok,true);
 assert.equal((await h.db.query('SELECT device_label FROM client_auth_passkey_credentials WHERE id=$1',[rows[1].id])).rows[0].device_label,'S25 Ultra');
});
