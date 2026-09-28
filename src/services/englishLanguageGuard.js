const OpenAI = require('openai');
const logger = require('../lib/logger');

let client = null;
const FAST_MODEL = process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || 'gpt-6-luna';
const ENGLISH_ONLY_REPLY = "Shiloh's WhatsApp service is available in English only. Please send your message in English and I'll be happy to help.";

const CLINIC_NAVIGATION_HINTS = Object.freeze([
  'lymphatic', 'drainage', 'mediheel', 'pedicure', 'beauty', 'aesthetics',
  'massage', 'facial', 'facials', 'nail', 'nails', 'waxing', 'brow', 'brows',
  'lash', 'lashes', 'body', 'foot', 'feet', 'skin', 'treatment', 'treatments',
  'service', 'services', 'booking', 'bookings', 'appointment', 'appointments',
]);

function classifierClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

function isEnglishCompatibleClinicNavigation(text='') {
  const value = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value || value.length > 80) return false;
  const words = value.match(/[a-z]+(?:['’-][a-z]+)*/g) || [];
  if (words.length < 1 || words.length > 6) return false;
  if (!/\b(treatments?|services?|bookings?|appointments?)\b/.test(value)) return false;
  const hintCount = words.filter((word) => CLINIC_NAVIGATION_HINTS.includes(word)).length;
  return hintCount >= 2;
}

function isEnglishCompatibleControlToken(text='') {
  const value = String(text || '').trim();
  return /^admin_controlled_demo_reset_(confirm|cancel):juvan_botha$/i.test(value)
    || /^admin_controlled_demo_reset_choose:(clean_bookings|identity_only)$/i.test(value)
    || /^admin_controlled_demo_reset_preview_clean:\d+:[a-f0-9]{20}:\d+$/i.test(value)
    || /^admin_controlled_demo_reset_confirm_clean:\d+:[a-f0-9]{20}$/i.test(value)
    || /^admin_test_client_reset_(confirm|cancel):juvan$/i.test(value);
}

function needsLanguageCheck(text='') {
  const value=String(text||'').trim();
  if(!value) return false;
  if(isEnglishCompatibleClinicNavigation(value)) return false;
  if(isEnglishCompatibleControlToken(value)) return false;
  const words=value.match(/[A-Za-zÀ-ÿ]+(?:['’-][A-Za-zÀ-ÿ]+)*/g)||[];
  // Names, confirmation tokens, menu numbers, dates and times must continue to work.
  return words.length >= 3 || /[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF\u2100-\u214F\u2190-\u21FF\u2600-\u27BF\uFE0F]/u.test(value);
}

async function guardEnglishOnly(text) {
  if(!needsLanguageCheck(text)) return { allowed:true };
  try {
    const response=await classifierClient().responses.create({
      model:FAST_MODEL,
      input:String(text).slice(0,700),
      instructions:[
        'Classify whether the incoming WhatsApp message is written in English.',
        'Return exactly ENGLISH or OTHER.',
        'Treat South African names, practitioner names, treatment/service names, dates, times, numbers, product names and short command syntax as English-compatible when the surrounding message is English.',
        'Do not reject a message merely because it contains a proper noun or an isolated non-English word.',
        'If the substantive sentence is Afrikaans or any other non-English language, return OTHER.'
      ].join(' '),
      reasoning:{effort:'low'},
      max_output_tokens:16,
      store:false,
    });
    const verdict=String(response.output_text||'').trim().toUpperCase();
    if(verdict==='OTHER') return {allowed:false,reply:ENGLISH_ONLY_REPLY};
    return {allowed:true};
  } catch(error) {
    // Fail open: language detection must never make WhatsApp unavailable.
    logger.warn({err:error},'English language guard unavailable; allowing message');
    return {allowed:true};
  }
}

module.exports={guardEnglishOnly,ENGLISH_ONLY_REPLY,needsLanguageCheck,isEnglishCompatibleClinicNavigation,isEnglishCompatibleControlToken};
