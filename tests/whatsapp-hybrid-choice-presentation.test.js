const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  WHATSAPP_REPLY_BUTTON_LIMITS,
  canUseReplyButtons,
  hybridizeChoiceInteractive,
} = require('../src/presentation/whatsappChoicePresentation');
const { eligiblePractitionersInteractive } = require('../src/services/clientDiscoveryMenu');

test('one to three list choices become visible reply buttons without changing action ids', () => {
  const source = {
    type: 'list',
    body: '*Choose an option*',
    buttonText: 'Open choices',
    rows: [
      { id: 'choice_one', title: 'First option', description: 'Full first option wording' },
      { id: 'choice_two', title: 'Second option', description: 'Full second option wording' },
      { id: 'menu', title: 'Back', description: 'Return to the previous menu' },
    ],
    sectionTitle: 'Choices',
  };

  const presented = hybridizeChoiceInteractive(source);

  assert.equal(presented.type, 'button');
  assert.deepEqual(
    presented.buttons,
    source.rows.map(({ id, title }) => ({ id, title }))
  );
  assert.match(presented.body, /First option — Full first option wording/);
  assert.match(presented.body, /Second option — Full second option wording/);
  assert.ok(presented.body.length <= WHATSAPP_REPLY_BUTTON_LIMITS.body);
});

test('four or more choices remain a WhatsApp list', () => {
  const source = {
    type: 'list',
    body: 'Choose',
    rows: Array.from({ length: 4 }, (_, index) => ({
      id: `choice_${index}`,
      title: `Choice ${index + 1}`,
    })),
  };
  assert.equal(canUseReplyButtons(source), false);
  assert.strictEqual(hybridizeChoiceInteractive(source), source);
});

test('a 21-24 character list title becomes a compact button while staying full in the body', () => {
  const source = {
    type: 'list',
    body: 'Choose',
    rows: [{ id: 'long_choice', title: 'This needs a list title' }],
  };
  const presented = hybridizeChoiceInteractive(source);
  assert.equal(presented.type, 'button');
  assert.equal(presented.buttons[0].title, 'This needs a list t…');
  assert.match(presented.body, /This needs a list title/);
});

test('choices whose compact button titles would collide remain a list', () => {
  const source = {
    type: 'list',
    body: 'Choose',
    rows: [
      { id: 'one', title: 'A repeated treatment option one' },
      { id: 'two', title: 'A repeated treatment option two' },
    ],
  };
  assert.strictEqual(hybridizeChoiceInteractive(source), source);
});

test('forceList preserves an explicitly list-only interaction', () => {
  const source = {
    type: 'list',
    forceList: true,
    body: 'Choose',
    rows: [{ id: 'choice', title: 'Choice' }],
  };
  assert.strictEqual(hybridizeChoiceInteractive(source), source);
});

test('representative client practitioner choices become one-tap buttons', () => {
  const list = eligiblePractitionersInteractive(
    { name: 'Sports Massage Full Body' },
    [{ id: 11, display_name: 'Christel' }]
  );
  const presented = hybridizeChoiceInteractive(list);
  assert.equal(presented.type, 'button');
  assert.deepEqual(
    presented.buttons.map(({ id }) => id),
    ['client_practitioner_any', 'client_practitioner_11']
  );
  assert.match(presented.body, /Use any eligible practitioner/);
});

test('hybrid conversion remains while retired Admin booking scoping is absent', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/controllers/webhookController.js'),
    'utf8'
  );
  const hybridIndex = source.indexOf('hybridizeChoiceInteractive(result.interactive)');
  assert.ok(hybridIndex >= 0);
  assert.doesNotMatch(source, /scopeAdminBookingInteractive/);
});
