const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY ||= 'test-openai-key';

const { extractService, extractTherapist } = require('../src/services/bookingIntent');
const { deterministicConversationReply } = require('../src/services/ai');

test('generic appointment requests ask for a treatment instead of verifying appointment as a service', () => {
  assert.equal(extractService('Can I book an appointment?'), null);
  assert.equal(extractService('I would like to schedule an appointment'), null);
});

test('My Shiloh welcome-voucher handoff extracts only the chosen treatment', () => {
  assert.equal(
    extractService("Hi Shiloh 👋 I'd like to book Full Body Swedish. I also want to use my R100 My Shiloh welcome voucher. Please help me choose an available time."),
    'Full Body Swedish',
  );
  assert.equal(
    extractService("I'd like to book Full Body Swedish and use my R100 My Shiloh welcome voucher."),
    'Full Body Swedish',
  );
});

test('welcome-voucher Any available keeps its restricted practitioner scope', () => {
  assert.equal(
    extractTherapist('booking with any welcome-voucher practitioner'),
    'Any available welcome-voucher practitioner',
  );
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
