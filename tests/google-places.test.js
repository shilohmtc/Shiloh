const test = require('node:test');
const assert = require('node:assert/strict');
const { renderVisit } = require('../src/services/publicWebsite');
const {
  buildGooglePlacesReply,
  isLivePlacesQuery,
  normaliseQuery,
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
