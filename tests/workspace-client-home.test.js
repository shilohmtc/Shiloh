'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { clientHomeScript, clientSectionNavigation, selectedClientSection } = require('../src/presentation/workspaceClientHomeUx');
const { renderClientServices } = require('../src/presentation/workspaceClientServicesUx');

test('client navigation binds each destination to the selected canonical client', () => {
  const html = clientSectionNavigation({client: {id: 42}, services: 'vouchers'});
  assert.equal((html.match(/href="\/calendar\/clients\/42\?services=/g) || []).length, 6);
  assert.match(html, /services=vouchers#client-vouchers" aria-current="page"/);
  assert.equal(selectedClientSection({services: 'unknown'}), 'overview');
});

test('only the selected client service is rendered and restricted ledgers remain restricted', () => {
  const model = {services: 'vouchers', vouchers: {restricted: true}, rewards: {restricted: true}};
  const html = renderClientServices(model, {policySection: 'PRIVATE_POLICY', activitySection: 'PRIVATE_ACTIVITY'});
  assert.match(html, /access does not include this client’s vouchers/);
  assert.doesNotMatch(html, /PRIVATE_POLICY|PRIVATE_ACTIVITY|<summary/);
  const overview = renderClientServices({...model, services: 'overview'}, {});
  assert.match(overview, /data-client-profile-services hidden/);
});

test('legacy document and appointment links retain query context and select the appropriate section', () => {
  for (const [hash, section] of [['#policy-documents','forms'], ['#consultation-documents','forms'], ['#appointment-history','appointments']]) {
    let destination;
    vm.runInNewContext(clientHomeScript(), {
      URL, document: {querySelectorAll: () => [], querySelector: () => ({dataset: {clientHomeSection: 'overview'}})},
      location: {hash, pathname: '/calendar/clients/42', href: `https://example.test/calendar/clients/42?historyOffset=20${hash}`, replace: value => { destination = value; }},
    });
    assert.equal(destination, `/calendar/clients/42?historyOffset=20&services=${section}${hash}`);
  }
});

test('legacy navigation neither loops on the selected section nor redirects another route', () => {
  for (const [pathname, selected] of [['/calendar/clients/42','forms'], ['/calendar/clients/42/policy-acceptances/1','overview']]) {
    vm.runInNewContext(clientHomeScript(), {
      URL, document: {querySelectorAll: () => [], querySelector: () => ({dataset: {clientHomeSection: selected}})},
      location: {hash: '#policy-documents', pathname, replace: () => assert.fail('unexpected redirect')},
    });
  }
});
