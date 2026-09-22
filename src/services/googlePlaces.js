'use strict';

const axios = require('axios');
const logger = require('../lib/logger');

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const DEFAULT_QUERY = 'guesthouses and hotels near 37 Jacobs Street, Heidelberg, Gauteng, South Africa';
const SHILOH_QUERY = 'Shiloh Massage Therapy & Aesthetic Clinic, 37 Jacobs Street, Heidelberg, Gauteng, South Africa';
const DEFAULT_DAILY_LIMIT = 100;
const QUOTA_TIME_ZONE = 'Africa/Johannesburg';
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.googleMapsUri',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.currentOpeningHours',
  'places.websiteUri',
  'places.types',
].join(',');
const SHILOH_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.googleMapsUri',
].join(',');
const SHILOH_REVIEW_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'googleMapsUri',
  'rating',
  'userRatingCount',
  'reviews',
].join(',');

function getApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim();
}

function isGooglePlacesConfigured() {
  return Boolean(getApiKey());
}

function getDailyLimit() {
  const configured = Number(process.env.GOOGLE_PLACES_DAILY_LIMIT || DEFAULT_DAILY_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_DAILY_LIMIT;
}

function getQuotaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: QUOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

let dailyQuotaState = { date: getQuotaDate(), used: 0 };
let shilohPlaceIdCache = null;
let shilohReviewRequest = null;

function reserveDailyQuota() {
  const date = getQuotaDate();
  if (dailyQuotaState.date !== date) dailyQuotaState = { date, used: 0 };

  const limit = getDailyLimit();
  if (dailyQuotaState.used >= limit) {
    return { allowed: false, date, limit, used: dailyQuotaState.used };
  }

  dailyQuotaState.used += 1;
  return { allowed: true, date, limit, used: dailyQuotaState.used };
}

function isLivePlacesQuery(message = '') {
  const text = String(message || '');
  return /\b(?:guesthouses?|guest houses?|hotels?|accommodation|where to stay|places? to stay|restaurants?|cafes?|things to do|attractions?|places? of interest|open now|nearby)\b/i.test(text)
    && /\b(?:heidelberg|near shiloh|near the clinic|around here|nearby|local|gauteng)\b/i.test(text);
}

function normaliseQuery(query = '') {
  const text = String(query || '').trim().replace(/\s+/g, ' ');
  if (!text) return DEFAULT_QUERY;
  return `${text} near 37 Jacobs Street, Heidelberg, Gauteng, South Africa`;
}

function mapPlace(place = {}) {
  return {
    id: place.id || null,
    name: place.displayName?.text || null,
    address: place.formattedAddress || null,
    mapsUrl: place.googleMapsUri || null,
    phone: place.nationalPhoneNumber || null,
    rating: Number.isFinite(place.rating) ? place.rating : null,
    ratingCount: Number.isFinite(place.userRatingCount) ? place.userRatingCount : null,
    openNow: typeof place.currentOpeningHours?.openNow === 'boolean' ? place.currentOpeningHours.openNow : null,
    website: place.websiteUri || null,
    types: Array.isArray(place.types) ? place.types : [],
  };
}

async function searchGooglePlaces(query = '') {
  if (!isGooglePlacesConfigured()) return { status: 'not_configured', places: [] };

  const quota = reserveDailyQuota();
  if (!quota.allowed) {
    logger.warn(quota, 'Google Places daily application quota reached');
    return { status: 'quota_exhausted', places: [], quota };
  }

  try {
    const response = await axios.post(
      PLACES_URL,
      {
        textQuery: normaliseQuery(query),
        languageCode: 'en',
        regionCode: 'ZA',
        maxResultCount: 5,
        includePureServiceAreaBusinesses: false,
      },
      {
        timeout: 4500,
        headers: {
          'X-Goog-Api-Key': getApiKey(),
          'X-Goog-FieldMask': FIELD_MASK,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
    );

    return { status: 'live', places: (response.data?.places || []).map(mapPlace).filter((place) => place.name) };
  } catch (error) {
    logger.warn({ err: error, query: String(query || '').slice(0, 120) }, 'Google Places lookup failed; using curated fallback');
    return { status: 'error', places: [] };
  }
}

function mapGoogleReview(review = {}) {
  const author = review.authorAttribution || {};
  const text = review.text?.text || review.originalText?.text || '';
  return {
    authorName: author.displayName || 'Google reviewer',
    authorUrl: author.uri || null,
    authorPhotoUrl: author.photoUri || null,
    reviewUrl: review.googleMapsUri || null,
    rating: Number.isFinite(review.rating) ? review.rating : null,
    text: String(text).trim(),
    relativePublishTime: review.relativePublishTimeDescription || null,
    publishTime: review.publishTime || null,
  };
}

function isShilohListing(place = {}) {
  const name = String(place.displayName?.text || '').toLowerCase();
  const address = String(place.formattedAddress || '').toLowerCase();
  return name.includes('shiloh') && address.includes('heidelberg');
}

function reviewResult(status, overrides = {}) {
  return {
    status,
    place: null,
    reviews: [],
    ...overrides,
  };
}

async function findShilohPlaceId() {
  const configuredPlaceId = String(process.env.SHILOH_GOOGLE_PLACE_ID || '').trim();
  if (configuredPlaceId) return configuredPlaceId;
  if (shilohPlaceIdCache) return shilohPlaceIdCache;

  const quota = reserveDailyQuota();
  if (!quota.allowed) return null;

  const response = await axios.post(
    PLACES_URL,
    {
      textQuery: SHILOH_QUERY,
      languageCode: 'en',
      regionCode: 'ZA',
      maxResultCount: 3,
      includePureServiceAreaBusinesses: false,
    },
    {
      timeout: 4500,
      headers: {
        'X-Goog-Api-Key': getApiKey(),
        'X-Goog-FieldMask': SHILOH_SEARCH_FIELD_MASK,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
  );

  shilohPlaceIdCache = (response.data?.places || []).find(isShilohListing)?.id || null;
  return shilohPlaceIdCache;
}

async function requestShilohGoogleReviews() {
  if (!isGooglePlacesConfigured()) return reviewResult('not_configured');

  try {
    const placeId = await findShilohPlaceId();
    if (!placeId) return reviewResult('not_found');

    const quota = reserveDailyQuota();
    if (!quota.allowed) return reviewResult('quota_exhausted');

    const response = await axios.get(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      timeout: 4500,
      params: { languageCode: 'en', regionCode: 'ZA' },
      headers: {
        'X-Goog-Api-Key': getApiKey(),
        'X-Goog-FieldMask': SHILOH_REVIEW_FIELD_MASK,
        Accept: 'application/json',
      },
    });
    const place = response.data || {};
    if (!isShilohListing(place)) return reviewResult('not_found');

    return reviewResult('live', {
      place: {
        id: place.id || placeId,
        name: place.displayName?.text || 'Shiloh',
        address: place.formattedAddress || null,
        mapsUrl: place.googleMapsUri || null,
        rating: Number.isFinite(place.rating) ? place.rating : null,
        ratingCount: Number.isFinite(place.userRatingCount) ? place.userRatingCount : null,
      },
      reviews: (place.reviews || [])
        .map(mapGoogleReview)
        .filter((review) => review.text && review.rating !== null),
    });
  } catch (error) {
    logger.warn({ err: error }, 'Shiloh Google review lookup failed');
    return reviewResult('error');
  }
}

async function getShilohGoogleReviews() {
  if (shilohReviewRequest) return shilohReviewRequest;

  shilohReviewRequest = requestShilohGoogleReviews()
    .finally(() => {
      shilohReviewRequest = null;
    });
  return shilohReviewRequest;
}

function resetGooglePlacesStateForTests() {
  dailyQuotaState = { date: getQuotaDate(), used: 0 };
  shilohPlaceIdCache = null;
  shilohReviewRequest = null;
}

function formatPlace(place) {
  const details = [
    place.address,
    place.rating !== null ? `rating ${place.rating}${place.ratingCount ? ` (${place.ratingCount} reviews)` : ''}` : null,
    place.openNow === true ? 'open now' : place.openNow === false ? 'currently closed' : null,
    place.phone,
  ].filter(Boolean).join(' · ');
  const links = [
    place.mapsUrl ? `Maps: ${place.mapsUrl}` : null,
    place.website ? `Website: ${place.website}` : null,
  ].filter(Boolean).join('\n');
  return `• ${place.name}${details ? ` — ${details}` : ''}${links ? `\n  ${links}` : ''}`;
}

function buildGooglePlacesReply(result, query = '') {
  if (!result || result.status !== 'live' || !result.places.length) return null;
  const label = /guest|hotel|stay|accommodation|sleep|bed|b&b/i.test(String(query))
    ? 'accommodation'
    : 'places';
  return [
    `Here are current Google Maps results for ${label} near Shiloh (checked just now):`,
    ...result.places.map(formatPlace),
    '',
    'Please confirm details directly with the venue before travelling. Google listings can change, and this does not confirm room availability or booking prices.',
  ].join('\n');
}

module.exports = {
  DEFAULT_QUERY,
  DEFAULT_DAILY_LIMIT,
  FIELD_MASK,
  SHILOH_QUERY,
  SHILOH_REVIEW_FIELD_MASK,
  getDailyLimit,
  getQuotaDate,
  isGooglePlacesConfigured,
  isLivePlacesQuery,
  normaliseQuery,
  reserveDailyQuota,
  searchGooglePlaces,
  mapGoogleReview,
  getShilohGoogleReviews,
  resetGooglePlacesStateForTests,
  buildGooglePlacesReply,
};
