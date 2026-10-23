const test = require('node:test');
const assert = require('node:assert/strict');
const { renderContact } = require('../src/services/publicWebsite');
const { renderBookingPage } = require('../src/services/publicBookingPageEditorial');
const { toPublicService } = require('../src/services/publicPresentation');

test('Youth Guests Pedi & Gel uses foot care presentation without rewriting its canonical record', () => {
  const original={id:1101,name:'Youth Guests Pedi & Gel',category:'More Services',duration:'45 min',price:'R210'};
  const before=structuredClone(original),view=toPublicService(original);
  assert.equal(view.category,'Pedicures & Foot Care');
  assert.equal(view.canonicalCategory,'More Services');
  assert.equal(view.canonicalName,original.name);
  assert.equal(view.id,1101);assert.equal(view.duration,'45 min');assert.equal(view.price,'R210');
  assert.deepEqual(original,before);
});

test('booking shares one public canonical URL while retaining selected-service handoff', () => {
  const catalogue = [{id:101,name:'Synthetic massage',category:'Massage',duration:'60 min',price:'R720'}];
  for (const selected of ['',101]) {
    const html = renderBookingPage('27830000000', catalogue, selected);
    assert.equal((html.match(/rel="canonical"/g)||[]).length,1);
    assert.match(html, /rel="canonical" href="https:\/\/shilohmtc\.co\.za\/book"/);
    assert.match(html, /property="og:url" content="https:\/\/shilohmtc\.co\.za\/book"/);
    assert.match(html, /property="og:image" content="https:\/\/shilohmtc\.co\.za\/assets\/brand\/shiloh-logo-full\.jpg"/);
    const description=html.match(/name="description" content="([^"]*)"/)[1];
    assert.equal(html.match(/property="og:description" content="([^"]*)"/)[1],description);
    if(selected)assert.match(html,/\/my-shiloh\/book\?service=101/);
  }
});

test('Contact directions use only the existing published address without requesting visitor location', () => {
  const html=renderContact();
  const link=html.match(/<a[^>]*href="(https:\/\/www\.google\.com\/maps\/dir\/[^\"]*)"[^>]*>Get directions<\/a>/)[0];
  const url=new URL(link.match(/href="([^"]*)"/)[1].replaceAll('&amp;','&'));
  assert.equal(url.searchParams.get('api'),'1');
  assert.equal(url.searchParams.get('destination'),'37 Jacobs Street, Heidelberg, Gauteng, South Africa');
  assert.equal(url.searchParams.has('origin'),false);
  assert.match(link,/target="_blank" rel="noopener noreferrer"/);
  assert.match(link,/aria-label="Get directions in Google Maps \(opens in a new tab\)"/);
  assert.doesNotMatch(html,/geolocation\.getCurrentPosition|maps\/api\/js/);
});
