const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const onboarding = require('../src/services/clientIdentityOnboarding');
const bookingUi = require('../src/services/clientBookingInteractive');
const familyDiscovery = require('../src/services/clientServiceFamilyDiscovery');
const { CLIENT_COPY } = require('../src/config/clientCopy');
const bookingUiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'clientBookingInteractive.js'), 'utf8');

test('registered client discovery uses the available-family WhatsApp list', () => {
  const interactive = bookingUi.bookingDiscoveryInteractive();
  assert.equal(interactive.type, 'list');
  assert.match(interactive.body, /What would you like to book/);
  assert.deepEqual(
    interactive.rows.map((row) => row.id),
    ['client_family_massage', 'client_family_lymphatic', 'client_family_pedicure']
  );
  assert.deepEqual(
    interactive.rows.map(({ title, description }) => ({ title, description })),
    [
      { title: 'Massage Treatments', description: 'View massage treatments' },
      { title: 'Lymphatic Drainage', description: 'View lymphatic drainage treatments' },
      { title: 'Elim MediHeel Pedicures', description: 'View pedicure treatments' },
    ]
  );
});

test('registered client discovery copy is client-friendly and comes from the safe copy config surface', () => {
  const interactive = bookingUi.bookingDiscoveryInteractive();
  assert.equal(CLIENT_COPY.bookingDiscoveryPrompt, 'Choose a service below and I’ll show you the available treatments and practitioners. 🌿');
  assert.match(bookingUiSource, /require\(['"]\.\.\/config\/clientCopy['"]\)/);
  assert.match(bookingUiSource, /CLIENT_COPY\.bookingDiscoveryPrompt/);
  assert.match(interactive.body, /Choose a service below and I’ll show you the available treatments and practitioners\. 🌿/);
  assert.doesNotMatch(interactive.body, /CRM|currently eligible/i);
});

test('MediHeel is a guarded Christel-only CRM-derived service family', () => {
  assert.equal(familyDiscovery.FAMILY_RULES.pedicure.title, 'Elim MediHeel Pedicures');
  assert.equal(familyDiscovery.FAMILY_RULES.pedicure.practitioner, 'Christel');
  const sql = familyDiscovery.familyFilterSql('pedicure');
  assert.match(sql, /christel/i);
  assert.match(sql, /medi-heel|mediheel|elim/i);
  assert.doesNotMatch(sql, /marietjie/i);
  assert.match(familyDiscovery.familyFilterSql('beauty'), /NOT LIKE[\s\S]*pedicur|NOT LIKE[\s\S]*mediheel|NOT LIKE[\s\S]*elim/i);
});

test('WhatsApp self-registration uses inbound number and asks for name DOB and gender together', () => {
  assert.doesNotMatch(onboarding.REGISTRATION_START_PROMPT, /mobile number|phone number/i);
  assert.match(onboarding.REGISTRATION_START_PROMPT, /first name/i);
  assert.match(onboarding.REGISTRATION_START_PROMPT, /surname/i);
  assert.match(onboarding.REGISTRATION_START_PROMPT, /date of birth/i);
  assert.match(onboarding.REGISTRATION_START_PROMPT, /gender/i);
});

test('bundled registration accepts full name DOB and gender without mobile number', () => {
  assert.deepEqual(
    onboarding.extractWhatsAppRegistration('Sarah Smith, 14 May 1990, Female'),
    { fullName: 'Sarah Smith', dateOfBirth: '1990-05-14', gender: 'female' }
  );
  assert.deepEqual(
    onboarding.extractWhatsAppRegistration('My name is John Doe, DOB 20/10/1988, male'),
    { fullName: 'John Doe', dateOfBirth: '1988-10-20', gender: 'male' }
  );
});

test('registration field parser supports progressive partial replies', () => {
  assert.deepEqual(onboarding.extractWhatsAppRegistration('Sarah'), { fullName: 'Sarah' });
  assert.deepEqual(onboarding.extractWhatsAppRegistration('Smith, 14 May 1990'), { fullName: 'Smith', dateOfBirth: '1990-05-14' });
  assert.deepEqual(onboarding.extractWhatsAppRegistration('Female'), { gender: 'female' });
});

test('initial welcome no longer asks the generic open-ended question', () => {
  assert.doesNotMatch(onboarding.PREMIUM_GREETING, /What can I help you with today/i);
  assert.match(onboarding.PREMIUM_GREETING, /smart booking assistant/i);
});
