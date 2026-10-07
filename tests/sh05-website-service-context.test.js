'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createMyShilohRouter } = require('../src/routes/myShiloh');

test('website service selection survives sign-in and resolves against the current public catalogue', async () => {
  const session = { ok:true, sessionId:44, crmV2ClientId:912, client:{ firstName:'Client' } };
  const sessionService = {
    async validateSessionToken(token) { return token === 'valid' ? session : { ok:false }; },
    async rotateCsrfToken() { return { ok:true, csrfToken:'test-csrf' }; },
  };
  const app = express();
  app.use(createMyShilohRouter({
    sessionService,
    profileService:{loadProfile:async()=>({requiresDobBeforeBooking:false})},
    catalogueProvider: async () => [{ id:101, name:'Deep Tissue <Massage>', category:'Massage' }],
    bookingService: {
      async catalogue() { return [{ id:101, name:'Deep Tissue <Massage>', category:'Massage', price:'R500' }]; },
      async policy() { return { rateBasisPoints:5000 }; },
    },
    planningService: { async practitioners() { return []; }, async forClient() { return []; } },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const unsigned = await fetch(`${base}/my-shiloh/request?service=101`, { redirect:'manual' });
    assert.equal(unsigned.status, 303);
    assert.equal(unsigned.headers.get('location'), '/my-shiloh/?service=101#plan-visit');

    const unknown = await fetch(`${base}/my-shiloh/request?service=bad`, { redirect:'manual' });
    assert.equal(unknown.headers.get('location'), '/my-shiloh/#plan-visit');

    const unsignedBooking = await fetch(`${base}/my-shiloh/book?service=101`, { redirect:'manual' });
    assert.equal(unsignedBooking.status, 303);
    assert.equal(unsignedBooking.headers.get('location'), '/my-shiloh/?service=101#book-online');
    const unsafeBooking = await fetch(`${base}/my-shiloh/book?service=bad`, { redirect:'manual' });
    assert.equal(unsafeBooking.headers.get('location'), '/my-shiloh/#book-online');

    const signed = await fetch(`${base}/my-shiloh/request?service=101`, {
      headers: { cookie:'shiloh_client_session=valid' },
    });
    assert.equal(signed.status, 200);
    const html = await signed.text();
    assert.match(html, /name="serviceDetail"[^>]*>Deep Tissue &lt;Massage&gt;<\/textarea>/);
    assert.doesNotMatch(html, /<Massage>/);
    assert.match(html, /Nothing is booked or charged yet/);

    const signedBooking = await fetch(`${base}/my-shiloh/book?service=101`, {
      headers: { cookie:'shiloh_client_session=valid' },
    });
    assert.equal(signedBooking.status, 200);
    const bookingHtml = await signedBooking.text();
    assert.match(bookingHtml, /data-selected-service-id="101"/);
    assert.match(bookingHtml, /data-service-id="101"/);
    assert.match(bookingHtml, /data-service-name="Deep Tissue &lt;Massage&gt;"/);
    const signedUnsafeBooking = await fetch(`${base}/my-shiloh/book?service=bad`, {
      headers: { cookie:'shiloh_client_session=valid' },
    });
    assert.equal(signedUnsafeBooking.status, 200);
    assert.match(await signedUnsafeBooking.text(), /data-selected-service-id=""/);

    const signedUnknown = await fetch(`${base}/my-shiloh/request?service=999`, {
      headers: { cookie:'shiloh_client_session=valid' },
    });
    assert.equal(signedUnknown.status, 200);
    assert.match(await signedUnknown.text(), /name="serviceDetail"[^>]*><\/textarea>/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
