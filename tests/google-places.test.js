const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const axios = require('axios');
const { createPublicWebsiteRouter } = require('../src/routes/publicWebsite');
const { renderHome, renderVisit } = require('../src/services/publicWebsite');

for (const configured of [false, true]) test(`retired Places routes never contact an unavailable provider (credentials ${configured ? 'present' : 'absent'})`, async t => {
  const original = process.env.GOOGLE_PLACES_API_KEY;
  if (configured) process.env.GOOGLE_PLACES_API_KEY = 'synthetic-unused-key';
  else delete process.env.GOOGLE_PLACES_API_KEY;
  t.after(() => { if (original === undefined) delete process.env.GOOGLE_PLACES_API_KEY; else process.env.GOOGLE_PLACES_API_KEY = original; });
  let requests = 0;
  for (const method of ['get', 'post', 'request']) t.mock.method(axios, method, () => { requests++; throw new Error('Provider unavailable'); });
  const app = express();
  app.use(createPublicWebsiteRouter({ contentService: {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const route of ['/reviews/google', '/visit/places?query=hotels']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), route.includes('reviews') ? { status: 'retired', place: null, reviews: [] } : { status: 'retired', places: [] });
  }
  assert.equal(requests, 0);
});

test('runtime and scheduled scripts contain no Places transport or credential consumer', () => {
  const root = path.join(__dirname, '..');
  const paths = ['src', 'scripts'].flatMap(dir => fs.readdirSync(path.join(root, dir), { recursive: true }).filter(p => p.endsWith('.js')).map(p => path.join(root, dir, p)));
  paths.push(path.join(root, 'app.js'));
  for (const file of paths) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /places\.googleapis\.com|maps\.googleapis\.com\/maps\/api\/place|GOOGLE_PLACES_API_KEY|require\(['"][^'"]*googlePlaces['"]\)/, path.relative(root, file));
});

test('public pages contain no live review or listing requests, placeholders or retained Google content', () => {
  for (const html of [renderHome([], { reviewPreview: { reviews: [{ text: 'Old provider review' }] } }), renderVisit()]) {
    assert.doesNotMatch(html, /Old provider review|data-live-places|data-reviews-rail|\/reviews\/google|\/visit\/places|Loading recent|Live local search/);
    assert.match(html, /\/book/);
  }
});
