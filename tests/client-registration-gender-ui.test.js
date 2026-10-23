const test=require('node:test');
const assert=require('node:assert/strict');
const {clientCodePage}=require('../src/presentation/clientCodeUx');
const {normalizeGender}=require('../src/services/crmV2ClientService');
test('WhatsApp registration offers only Female/Male with a required neutral placeholder',()=>{
 const select=clientCodePage().match(/<select id="gender" required>(.*?)<\/select>/)[1];
 const options=[...select.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(m=>[m[1],m[2]]);
 assert.deepEqual(options,[['','Choose'],['female','Female'],['male','Male']]);
 assert.doesNotMatch(select,/selected/);
});
test('existing stored gender values retain their canonical backend compatibility',()=>{
 for(const value of ['non_binary','other','prefer_not_to_say'])assert.equal(normalizeGender(value,{required:true}),value);
});
