'use strict';

const GUIDE_SOURCE = 'Shiloh Heidelberg visitor guide, source-checked 2026-09-16';

const HEIDELBERG_GUIDE_CONTENT = [
  'Shiloh is at 37 Jacobs Street, Heidelberg, Gauteng, South Africa.',
  '',
  'PLACES OF INTEREST',
  '- Suikerbosrand Nature Reserve: a Gauteng nature destination near Heidelberg for scenic drives, hiking and outdoor time. Confirm current access, routes and opening arrangements before travelling.',
  '- Heidelberg Heritage Museum: a restored Victorian railway-station precinct focused on Heidelberg history, railway heritage, steam locomotives and heritage experiences. Tours and opening arrangements should be checked in advance.',
  '- Heidelberg town heritage: the town has preserved historic buildings and local stories; the Heidelberg Heritage Museum and Sedibeng tourism resources are useful starting points for a heritage route.',
  '',
  'PLACES TO STAY',
  '- Heidelberg Lodge: guesthouse accommodation at 27 Jacobs Street, Heidelberg. Official website: https://heidelberglodge.co.za/',
  '- Suikerbosrand Guesthouse: local accommodation in Heidelberg. Official contact page: https://www.suikerbosrandguesthouse.co.za/contact-us/',
  '- Picanha Guesthouse: a self-catering guesthouse in Heidelberg. Official website: https://picanhaguesthouse.co.za/',
  '- Hello Heidelberg accommodation hub: a local directory covering guesthouses, hotels, B&Bs, farm stays and other travel services. Website: https://www.helloheidelberg.co.za/accommodation-travel',
  '',
  'RECOMMENDATION BOUNDARY',
  'These are visitor information starting points, not Shiloh-owned businesses or live booking inventory. Do not claim a room, price, rating, availability, travel time, opening hour, event or reservation unless the relevant provider confirms it. Encourage visitors to contact the venue directly.',
  '',
  'SOURCES',
  '- Gauteng Tourism: https://visit.gauteng.net/visit/the-heidelberg-heritage-museum-vg',
  '- South African Government tourism overview: https://www.gov.za/about-sa/tourism',
  '- Sedibeng tourism routes: https://www.sedibeng.gov.za/tourism_vaal.html',
].join('\n');

const LOCAL_GUIDE_PATTERN = /\b(?:heidelberg|suikerbosrand|heritage museum|places? of interest|things to do|attractions?|guesthouses?|guest houses?|accommodation|where to stay|nearby|visitor|travel|tourism|weekend away)\b/i;
const SHILOH_LOCATION_PATTERN = /\b(?:where|address|located|location|directions?|find)\b.*\b(?:shiloh|clinic|you)\b|\b(?:shiloh|clinic)\b.*\b(?:where|address|located|location|directions?|find)\b/i;

function isHeidelbergGuideQuery(message = '') {
  const text = String(message || '');
  return LOCAL_GUIDE_PATTERN.test(text) || SHILOH_LOCATION_PATTERN.test(text);
}

function getHeidelbergGuideKnowledge(message = '') {
  if (!isHeidelbergGuideQuery(message)) return null;
  return { title: 'Heidelberg Gauteng visitor guide', source: GUIDE_SOURCE, similarity: 1, content: HEIDELBERG_GUIDE_CONTENT };
}

function buildHeidelbergGuideReply(message = '') {
  const text = String(message || '');
  if (!isHeidelbergGuideQuery(text)) return null;
  if (/\b(?:where|address|located|location|directions?|find)\b/i.test(text) && /\b(?:shiloh|clinic|you)\b/i.test(text)) {
    return 'Shiloh is at 37 Jacobs Street, Heidelberg, Gauteng. For an appointment, I can help you choose a service and check the booking journey.';
  }
  if (/\b(?:guesthouses?|guest houses?|accommodation|where to stay|stay|sleep|hotels?|b&b|bed and breakfasts?)\b/i.test(text)) {
    return [
      'For a stay in or around Heidelberg, these are useful starting points:',
      '• Heidelberg Lodge — 27 Jacobs Street: https://heidelberglodge.co.za/',
      '• Suikerbosrand Guesthouse: https://www.suikerbosrandguesthouse.co.za/contact-us/',
      '• Picanha Guesthouse — self-catering: https://picanhaguesthouse.co.za/',
      '• Hello Heidelberg accommodation directory: https://www.helloheidelberg.co.za/accommodation-travel',
      '',
      'Please contact the venue directly to confirm current rates, availability, facilities and check-in details. Would you also like nearby places to visit?',
    ].join('\n');
  }
  if (/\b(?:places? of interest|things to do|attractions?|visit|tourism|weekend away|nearby)\b/i.test(text)) {
    return [
      'Heidelberg is a good base for a relaxed local visit. Popular starting points include:',
      '• Suikerbosrand Nature Reserve — hiking, scenic drives and outdoor time.',
      '• Heidelberg Heritage Museum — railway heritage, local history and heritage experiences.',
      '• Heidelberg town heritage — historic buildings and local stories.',
      '',
      'Check current access, opening times and tour arrangements before travelling. I can also suggest nearby accommodation or help you book a Shiloh treatment during your visit.',
    ].join('\n');
  }
  return null;
}

module.exports = { GUIDE_SOURCE, HEIDELBERG_GUIDE_CONTENT, isHeidelbergGuideQuery, getHeidelbergGuideKnowledge, buildHeidelbergGuideReply };
