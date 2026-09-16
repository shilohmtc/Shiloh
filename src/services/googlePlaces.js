'use strict';

const axios = require('axios');
const logger = require('../lib/logger');

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const DEFAULT_QUERY = 'guesthouses and hotels near 37 Jacobs Street, Heidelberg, Gauteng, South Africa';
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

function getApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim();
}

function isGooglePlacesConfigured() {
  return Boolean(getApiKey());
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
  FIELD_MASK,
  isGooglePlacesConfigured,
  isLivePlacesQuery,
  normaliseQuery,
  searchGooglePlaces,
  buildGooglePlacesReply,
};
