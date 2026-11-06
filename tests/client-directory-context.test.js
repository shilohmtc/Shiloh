const test=require('node:test'),assert=require('node:assert/strict');
const {clientDirectoryReturnHref}=require('../src/presentation/clientDirectoryContext');
test('Directory returns allowlist search, status and offset without accepting other destinations',()=>{
 assert.equal(clientDirectoryReturnHref('/calendar/clients?q=Synthetic+%26+name&status=archived&offset=24&next=https://evil.test'),'/calendar/clients?q=Synthetic+%26+name&status=archived&offset=24');
 for(const value of ['https://evil.test/calendar/clients?q=x','//evil.test/calendar/clients?q=x','/calendar/clients/42?q=x','/calendar/clients?q=x#other','/calendar/services?q=x','/calendar/clients?'+ 'x'.repeat(2000)])assert.equal(clientDirectoryReturnHref(value),null);
 assert.equal(clientDirectoryReturnHref('/calendar/clients?status=invalid&offset=-1'),'/calendar/clients');
});
