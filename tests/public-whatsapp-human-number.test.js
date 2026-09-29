const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveWhatsAppNumber, RECEPTION_WHATSAPP_NUMBER } = require('../src/services/publicWhatsApp');

test('public WhatsApp contact always resolves to human Reception', async () => {
  const previous = process.env.SHILOH_PUBLIC_WHATSAPP_NUMBER;
  try {
    process.env.SHILOH_PUBLIC_WHATSAPP_NUMBER = '27123456789';
    assert.equal(RECEPTION_WHATSAPP_NUMBER, '27662399138');
    assert.equal(await resolveWhatsAppNumber(), RECEPTION_WHATSAPP_NUMBER);
  } finally {
    if (previous === undefined) delete process.env.SHILOH_PUBLIC_WHATSAPP_NUMBER;
    else process.env.SHILOH_PUBLIC_WHATSAPP_NUMBER = previous;
  }
});
