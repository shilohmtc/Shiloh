const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { renderVisit } = require('../src/services/publicWebsite');
const {
  buildGooglePlacesReply,
  getShilohGoogleReviews,
  getDailyLimit,
  isLivePlacesQuery,
  mapGoogleReview,
  normaliseQuery,
  resetGooglePlacesStateForTests,
  reserveDailyQuota,
} = require('../src/services/googlePlaces');

test('live places routing is limited to local listing questions', () => {
  assert.equal(isLivePlacesQuery('Can you find guesthouses near Heidelberg?'), true);
  assert.equal(isLivePlacesQuery('What is the price of a facial?'), false);
  assert.equal(isLivePlacesQuery('Tell me about Shiloh services'), false);
});

test('places search is anchored to Shiloh without exposing credentials', () => {
  assert.match(normaliseQuery('guesthouses'), /37 Jacobs Street, Heidelberg, Gauteng/);
  assert.doesNotMatch(renderVisit(), /GOOGLE_PLACES_API_KEY/);
  assert.match(renderVisit(), /data-live-places-query/);
  assert.match(renderVisit(), /\/visit\/places/);
});

test('live place reply clearly labels current results and booking boundary', () => {
  const reply = buildGooglePlacesReply({
    status: 'live',
    places: [{
      name: 'Example Guesthouse',
      address: 'Heidelberg, Gauteng',
      mapsUrl: 'https://maps.google.com/example',
      rating: 4.5,
      ratingCount: 12,
      openNow: true,
      phone: null,
      website: null,
    }],
  }, 'guesthouses near Heidelberg');
  assert.match(reply, /current Google Maps results/);
  assert.match(reply, /Example Guesthouse/);
  assert.match(reply, /does not confirm room availability or booking prices/);
});

test('Google review fields are reduced to the public attribution contract', () => {
  assert.deepEqual(mapGoogleReview({
    authorAttribution: {
      displayName: 'A Client',
      uri: 'https://google.example/reviewer',
      photoUri: 'https://google.example/photo.jpg',
    },
    rating: 5,
    text: { text: 'Excellent care.' },
    googleMapsUri: 'https://maps.google.com/example/review',
    relativePublishTimeDescription: 'a month ago',
    publishTime: '2026-08-01T10:00:00Z',
  }), {
    authorName: 'A Client',
    authorUrl: 'https://google.example/reviewer',
    authorPhotoUrl: 'https://google.example/photo.jpg',
    reviewUrl: 'https://maps.google.com/example/review',
    rating: 5,
    text: 'Excellent care.',
    relativePublishTime: 'a month ago',
    publishTime: '2026-08-01T10:00:00Z',
  });
});

test('Shiloh reviews use server-side Place Details and only coalesce simultaneous requests', async (t) => {
  const previousKey = process.env.GOOGLE_PLACES_API_KEY;
  const previousPlaceId = process.env.SHILOH_GOOGLE_PLACE_ID;
  process.env.GOOGLE_PLACES_API_KEY = 'server-only-test-key';
  process.env.SHILOH_GOOGLE_PLACE_ID = 'shiloh-place-id';
  resetGooglePlacesStateForTests();
  let calls = 0;
  t.mock.method(axios, 'get', async (url, config) => {
    calls += 1;
    assert.match(url, /shiloh-place-id$/);
    assert.equal(config.headers['X-Goog-Api-Key'], 'server-only-test-key');
    assert.match(config.headers['X-Goog-FieldMask'], /reviews/);
    return {
      data: {
        id: 'shiloh-place-id',
        displayName: { text: 'Shiloh Massage Therapy & Aesthetic Clinic' },
        formattedAddress: '37 Jacobs Street, Heidelberg, Gauteng, South Africa',
        googleMapsUri: 'https://maps.google.com/shiloh',
        rating: 4.9,
        userRatingCount: 87,
        reviews: [{
          authorAttribution: { displayName: 'A Client' },
          rating: 5,
          text: { text: 'Wonderful care.' },
        }],
      },
    };
  });

  try {
    const [first, second] = await Promise.all([
      getShilohGoogleReviews(),
      getShilohGoogleReviews(),
    ]);
    await getShilohGoogleReviews();
    assert.equal(first.status, 'live');
    assert.equal(first.place.name, 'Shiloh Massage Therapy & Aesthetic Clinic');
    assert.equal(first.reviews[0].text, 'Wonderful care.');
    assert.deepEqual(second, first);
    assert.equal(calls, 2);
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = previousKey;
    if (previousPlaceId === undefined) delete process.env.SHILOH_GOOGLE_PLACE_ID;
    else process.env.SHILOH_GOOGLE_PLACE_ID = previousPlaceId;
    resetGooglePlacesStateForTests();
  }
});

test('review lookup refuses a similarly named listing outside Heidelberg', async (t) => {
  const previousKey = process.env.GOOGLE_PLACES_API_KEY;
  const previousPlaceId = process.env.SHILOH_GOOGLE_PLACE_ID;
  process.env.GOOGLE_PLACES_API_KEY = 'server-only-test-key';
  process.env.SHILOH_GOOGLE_PLACE_ID = 'wrong-place-id';
  resetGooglePlacesStateForTests();
  t.mock.method(axios, 'get', async () => ({
    data: {
      id: 'wrong-place-id',
      displayName: { text: 'Shiloh Wellness' },
      formattedAddress: 'Cape Town, South Africa',
      rating: 5,
      userRatingCount: 200,
      reviews: [{ rating: 5, text: { text: 'Wrong business.' } }],
    },
  }));

  try {
    const result = await getShilohGoogleReviews();
    assert.equal(result.status, 'not_found');
    assert.deepEqual(result.reviews, []);
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = previousKey;
    if (previousPlaceId === undefined) delete process.env.SHILOH_GOOGLE_PLACE_ID;
    else process.env.SHILOH_GOOGLE_PLACE_ID = previousPlaceId;
    resetGooglePlacesStateForTests();
  }
});

test('application-side daily quota blocks lookups after the configured limit', () => {
  const previous = process.env.GOOGLE_PLACES_DAILY_LIMIT;
  process.env.GOOGLE_PLACES_DAILY_LIMIT = '2';
  resetGooglePlacesStateForTests();
  try {
    assert.equal(getDailyLimit(), 2);
    assert.equal(reserveDailyQuota().allowed, true);
    assert.equal(reserveDailyQuota().allowed, true);
    const exhausted = reserveDailyQuota();
    assert.equal(exhausted.allowed, false);
    assert.equal(exhausted.limit, 2);
    assert.equal(exhausted.used, 2);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_PLACES_DAILY_LIMIT;
    else process.env.GOOGLE_PLACES_DAILY_LIMIT = previous;
    resetGooglePlacesStateForTests();
  }
});
