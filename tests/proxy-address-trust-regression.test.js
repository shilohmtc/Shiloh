'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const proxyaddr = require('proxy-addr');
const request = remoteAddress => ({ socket:{ remoteAddress },headers:{ 'x-forwarded-for':'127.0.0.1' } });

test('an IPv4-mapped IPv6 subnet with a short prefix cannot trust an arbitrary client IP', () => {
  const trust=proxyaddr.compile('::ffff:10.0.0.0/8');
  assert.equal(proxyaddr(request('203.0.113.99'),trust),'203.0.113.99');
});
test('the existing plain IPv4 proxy subnet keeps forwarded addresses scoped to trusted hops', () => {
  const trust=proxyaddr.compile('10.0.0.0/8');
  assert.equal(proxyaddr(request('203.0.113.99'),trust),'203.0.113.99');
  assert.equal(proxyaddr(request('10.5.6.7'),trust),'127.0.0.1');
});
