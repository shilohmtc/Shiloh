const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY ||= 'test-openai-key';

const { extractService } = require('../src/services/bookingIntent');
const { deterministicConversationReply } = require('../src/services/ai');

test('generic appointment requests ask for a treatment instead of verifying appointment as a service', () => {
  assert.equal(extractService('Can I book an appointment?'), null);
  assert.equal(extractService('I would like to schedule an appointment'), null);
});

test('name updates receive a conversational acknowledgement', () => {
  assert.equal(
    deterministicConversationReply('My name is Jean-Pierre Botha.'),
    'Thanks, Jean-Pierre Botha! I’ll use that name going forward. How can I help you with Shiloh today?'
  );
  assert.equal(deterministicConversationReply('My name is incorrect'), null);
});

test('uncertain treatment requests are guided to the supported service families', () => {
  assert.match(
    deterministicConversationReply('I’m not sure what I need. Can you help me choose?'),
    /massage, skincare or a facial, foot care, or an advanced aesthetic treatment/i
  );
});
