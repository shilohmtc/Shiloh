const RECEPTION_WHATSAPP_NUMBER = '27662399138';

function normalizeNumber(value = '') {
  return String(value || '').replace(/[^0-9]/g, '');
}

async function resolveWhatsAppNumber() {
  return RECEPTION_WHATSAPP_NUMBER;
}

module.exports = { normalizeNumber, resolveWhatsAppNumber, RECEPTION_WHATSAPP_NUMBER };
