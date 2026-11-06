const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCalendarBookingClientDirectory,
  maskContact,
} = require('../src/services/calendarBookingClientDirectory');
const {
  CLIENT_BROWSE_QUERY: ROUTE_BROWSE_QUERY,
} = require('../src/routes/calendarCreateBooking');
const {
  CLIENT_BROWSE_QUERY: UX_BROWSE_QUERY,
  calendarCreateBookingClientChoiceScript,
} = require('../src/presentation/calendarCreateBookingClientChoiceUx');

test('booking client directory lists only a bounded active CRM V2 browse result', async () => {
  const calls = [];
  const repository = {
    async searchClients(input) {
      calls.push(input);
      return [
        {
          id: 17,
          name: 'Abigail Example',
          normalized_mobile: '27821234567',
          status: 'active',
          profile_status: 'registered',
        },
        {
          id: 22,
          name: 'Bella Example',
          normalized_mobile: '27829876543',
          status: 'active',
          profile_status: 'minimal',
        },
      ];
    },
  };
  const directory = createCalendarBookingClientDirectory({ repository });

  const result = await directory.listActiveClients(1000);

  assert.deepEqual(calls, [{
    query: '',
    mobileSearch: '',
    exactMobile: null,
    status: 'active',
    limit: 25,
  }]);
  assert.deepEqual(result, {
    clients: [
      {
        id: '17',
        displayName: 'Abigail Example',
        status: 'active',
        profileStatus: 'registered',
        contactHint: 'ending in 4567',
      },
      {
        id: '22',
        displayName: 'Bella Example',
        status: 'active',
        profileStatus: 'minimal',
        contactHint: 'ending in 6543',
      },
    ],
    requiresExplicitSelection: true,
    ambiguous: true,
    identityModel: 'crm_v2_operator_browse_only',
  });
});

test('browse contract is private, shared by route and UX, and cannot expose a full mobile', () => {
  assert.equal(ROUTE_BROWSE_QUERY, UX_BROWSE_QUERY);
  assert.equal(UX_BROWSE_QUERY, '__shiloh_calendar_active_clients_v1__');
  assert.equal(maskContact('27821234567'), 'ending in 4567');
  assert.equal(maskContact(''), null);
});

test('client picker keeps explicit existing-client selection while new-client mode synchronizes name and mobile directly', () => {
  const script = calendarCreateBookingClientChoiceScript();

  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /Existing clients/);
  assert.match(script, /searchLabel\.hidden=false;searchActions\.hidden=false/);
  assert.match(script, /Add new client/);
  assert.doesNotMatch(script, /data-client-mode-search/);
  assert.match(script, /searchAction\.click\(\)/);
  assert.match(script, /calendar-client-mode/);
  assert.match(script, /normalGuard\.remove\(\)/);
  assert.match(script, /useNewActions\.hidden=true/);
  assert.match(script, /newHint\.hidden=true/);
  assert.match(script, /function syncNewClientDraftFromFields\(\)/);
  assert.match(script, /newName\.addEventListener\('input',syncNewClientDraftFromFields\)/);
  assert.match(script, /newMobile\.addEventListener\('input',syncNewClientDraftFromFields\)/);
  assert.match(script, /useNew\.click\(\)/);
  assert.match(script, /function hideStatus\(\)/);
  assert.match(script, /hideStatus\(\)/);
  assert.doesNotMatch(script, /date of birth|gender|email address/i);
  assert.doesNotMatch(script, /\bfetch\s*\(/);
});
