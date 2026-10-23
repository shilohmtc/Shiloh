const test=require('node:test');
const assert=require('node:assert/strict');
const {toPublicService}=require('../src/services/publicPresentation');
const {renderMyShilohPage}=require('../src/presentation/myShilohPwa');
for(const name of ['Young Guest Back &amp;!Neck Massage','Young Guest Back &!Neck Massage','Young Guest Back &amp;!Neck Massage(age8–15)'])test('correct known Young Guest display typo: '+name,()=>{
 const service={id:901,name,category:'Massage',duration:'30 min',price:'250'};
 const view=toPublicService(service);assert.ok(!view.name.includes('!'));assert.match(view.name,/Young Guest Back & Neck Massage/);assert.equal(view.canonicalName,name);assert.equal(service.name,name);assert.equal(view.id,901);assert.equal(view.duration,'30 min');assert.equal(view.price,'R250');
});
test('Young Guest Pedi changes only public category while retaining booking identity',()=>{
 const original={id:902,name:'Young Guest Pedi (age 8–15)',category:'Massage',duration:'30 min',price:'180'};
 const view=toPublicService(original);assert.equal(view.category,'Pedicures & Foot Care');assert.equal(view.canonicalCategory,'Massage');assert.equal(view.id,902);assert.equal(view.price,'R180');assert.deepEqual(original,{id:902,name:'Young Guest Pedi (age 8–15)',category:'Massage',duration:'30 min',price:'180'});
});
test('desktop phone link keeps only validated public service context and verified Reception authority',()=>{
 const html=renderMyShilohPage({catalogue:[{id:901,name:'Massage',category:'Massage',price:'250',duration:'30 min'}],selectedServiceId:'901',humanWhatsAppNumber:'0830000001'});
 assert.match(html,/href="https:\/\/app\.shilohmtc\.co\.za\/my-shiloh\/\?service=901#book-online" data-desktop-phone-link/);
 assert.match(html,/href="https:\/\/wa\.me\/27830000001\?text=/);
 assert.match(html,/data-install-desktop-handoff hidden/);
 const unsafe=renderMyShilohPage({selectedServiceId:'901&token=private'});
 assert.doesNotMatch(unsafe,/service=901|token=private/);
});
