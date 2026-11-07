const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {normalizeGuest}=require('../src/services/calendarGroupBooking');
const {renderCalendarGroupBookingPage}=require('../src/presentation/calendarGroupBookingUx');
const {migrationInventory}=require('../src/services/migrations');
const {validateMigrationReleasePlan}=require('../scripts/check-migration-release-plan');

test('compatibility review retains the exact migration needed by the post-DDL startup inventory',()=>{
 const filename='201_group_guest_booking_contacts.sql',sql=fs.readFileSync('migrations/'+filename,'utf8');
 assert.equal(sql,fs.readFileSync('tests/fixtures/guest-profile-schema-candidate.sql','utf8'));
 const hash=crypto.createHash('sha256').update(sql).digest('hex');
 assert.equal(hash,'289addeccae97938d150355af3355674ffd93f30de0feaa23305f4686f287637');
 assert.equal(migrationInventory().find(r=>r.filename===filename).checksum,hash);
 assert.throws(()=>validateMigrationReleasePlan({migrationFiles:[filename],pullRequestBody:'Approval pending'}));
 assert.equal(validateMigrationReleasePlan({migrationFiles:[filename],pullRequestBody:`SHILOH_CONTROLLED_RELEASE_MIGRATION=${filename}`}).requestedFilename,filename);
});

test('compatibility booking still requires each own mobile and cannot expose or accept guest-creation controls',()=>{
 for(const guest of [{name:'Synthetic Guest',mobile:''},{name:'Synthetic Guest',mobile:'',noMobile:true,firstVisitChoice:'first_visit'}])
  assert.throws(()=>normalizeGuest(guest),{code:'GROUP_INVALID_MOBILE'});
 const html=renderCalendarGroupBookingPage({options:{services:[],staff:[],authority:{},guestBooking:{available:true}}});
 assert.doesNotMatch(html,/data-no-mobile|data-organiser-id|data-first-visit-choice/);
});
