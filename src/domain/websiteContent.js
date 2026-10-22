'use strict';

const MORNING_OFFER = Object.freeze({
  code: 'morning_welcome_v1', title: 'Morning Welcome Offer', percent: 20,
  timezone: 'Africa/Johannesburg', startMinute: 480, endMinute: 720, excludedWeekdays: ['Sat'],
});
const MORNING_TERMS = Object.freeze([
  '20% off all eligible massage treatments and pedicures in your first Shiloh visit.',
  'Your appointment must start from 08:00 and before 12:00, excluding Saturdays. It may finish later.',
  'Advance booking required, subject to availability.',
  'One promotional offer per booking. Purchased gift vouchers may be used as payment.',
  'An ongoing offer, while available. Qualifying savings are shown before you confirm your booking.',
]);
class WebsiteContentError extends Error {
  constructor(code, message, httpStatus = 422) { super(message); this.code = code; this.httpStatus = httpStatus; }
}
function fail(message) { throw new WebsiteContentError('WEBSITE_CONTENT_INVALID', message); }
function cleanText(value, max, label, required = true) {
  if (typeof value !== 'string') { if (!required && value == null) return ''; fail(`Enter ${label}.`); }
  const text = value.replace(/\r\n?/g, '\n').trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail(`Check ${label}; use at most ${max} characters.`);
  return text;
}
function optionalDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('Choose a valid publication date and time.');
  return new Date(value).toISOString();
}
function normalizeDocument(input, kind) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['episode', 'offer'].includes(kind)) fail('Choose an episode or offer.');
  const allowed = new Set(['title','summary','body','imageId','imageAlt','episode','startsAt','endsAt']);
  if (Object.keys(input).some(key => !allowed.has(key))) fail('Reload the editor and try again.');
  const imageId = input.imageId || null;
  if (imageId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(imageId)) fail('Choose an uploaded image.');
  const imageAlt = cleanText(input.imageAlt, 200, 'the image description', Boolean(imageId));
  const episode = kind === 'episode' ? Number(input.episode) : null;
  if (kind === 'episode' && (!Number.isSafeInteger(episode) || episode < 1 || episode > 9999)) fail('Enter an episode number from 1 to 9999.');
  const startsAt = optionalDate(input.startsAt), endsAt = optionalDate(input.endsAt);
  if (endsAt && startsAt && endsAt <= startsAt) fail('The end must be after the start.');
  return {
    title: cleanText(input.title, 140, 'a title'), summary: cleanText(input.summary, 280, 'a short introduction'),
    body: cleanText(input.body, 20000, 'the full text'), imageId, imageAlt, episode, startsAt, endsAt,
  };
}
function visibleDocument(post, now = new Date()) {
  const doc = post?.published;
  const time = new Date(now).getTime();
  if (!doc || !Number.isFinite(time) || (doc.startsAt && Date.parse(doc.startsAt) > time) || (doc.endsAt && Date.parse(doc.endsAt) <= time)) return null;
  return { id: post.id, slug: post.slug, kind: post.kind, ruleCode: post.rule_code || null, ...doc };
}
function offerTimeEligible(startsAt) {
  if (!Number.isFinite(new Date(startsAt).getTime())) return false;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone:MORNING_OFFER.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(new Date(startsAt)).map(x=>[x.type,x.value]));
  const minute = Number(p.hour) * 60 + Number(p.minute);
  return !MORNING_OFFER.excludedWeekdays.includes(p.weekday) && minute >= MORNING_OFFER.startMinute && minute < MORNING_OFFER.endMinute;
}
function promotionPrice(price, eligible) {
  if (price == null || !/^\d+(?:\.\d{1,2})?$/.test(String(price))) fail('The treatment price needs checking.');
  const cents = Math.round(Number(price) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) fail('The treatment price needs checking.');
  const saving = eligible ? Math.round(cents * MORNING_OFFER.percent / 100) : 0;
  return { subtotal:(cents / 100).toFixed(2), discount:(saving / 100).toFixed(2), total:((cents - saving) / 100).toFixed(2), offerCode:saving ? MORNING_OFFER.code : null };
}
module.exports = { MORNING_OFFER, MORNING_TERMS, WebsiteContentError, normalizeDocument, visibleDocument, offerTimeEligible, promotionPrice };
