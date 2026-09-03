import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildUpstreamRequestHeaders } from './request-headers.js';
import { buildDownstreamResponseHeaders } from './response-headers.js';

const target = new URL('https://example.com/app/page');
const proxyOrigin = 'https://proxy.test';

describe('buildUpstreamRequestHeaders', () => {
  it('traduce referer/origin, restaura cookies y descarta cabeceras de infraestructura', () => {
    const incoming = new Headers({
      host: 'proxy.test',
      'x-forwarded-for': '1.2.3.4',
      'x-vercel-id': 'abc',
      'accept-encoding': 'gzip, br, zstd',
      referer: 'https://proxy.test/https:/example.com/app/',
      origin: 'https://proxy.test',
      cookie: '__mirage_host-csrf=1; sid=2',
      'user-agent': 'UA',
      accept: 'text/html',
    });
    const headers = buildUpstreamRequestHeaders(incoming, { target, proxyOrigin });
    assert.equal(headers.get('host'), null);
    assert.equal(headers.get('x-forwarded-for'), null);
    assert.equal(headers.get('x-vercel-id'), null);
    assert.equal(headers.get('accept-encoding'), null);
    assert.equal(headers.get('referer'), 'https://example.com/app/');
    assert.equal(headers.get('origin'), 'https://example.com');
    assert.equal(headers.get('cookie'), '__Host-csrf=1; sid=2');
    assert.equal(headers.get('user-agent'), 'UA');
    assert.equal(headers.get('accept'), 'text/html');
  });

  it('elimina un referer que no sea una página proxificada', () => {
    const headers = buildUpstreamRequestHeaders(new Headers({ referer: 'https://proxy.test/' }), { target, proxyOrigin });
    assert.equal(headers.get('referer'), null);
  });
});

describe('buildDownstreamResponseHeaders', () => {
  it('reescribe location/link/refresh, cookies, y elimina políticas ligadas al origen', () => {
    const upstream = new Headers({
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': '123',
      'content-security-policy': "default-src 'self'",
      'strict-transport-security': 'max-age=1',
      'x-frame-options': 'DENY',
      location: '/login?next=%2Fapp',
      link: '</a.css>; rel=preload; as=style',
      refresh: '2; url=https://other.org/',
      etag: '"abc"',
      'cache-control': 'public, max-age=60',
    });
    upstream.append('set-cookie', 'a=1; Path=/; Domain=example.com');
    upstream.append('set-cookie', 'b=2; Secure; HttpOnly');
    const headers = buildDownstreamResponseHeaders(upstream, { target, secure: true });
    assert.equal(headers.get('content-encoding'), null);
    assert.equal(headers.get('content-length'), null);
    assert.equal(headers.get('content-security-policy'), null);
    assert.equal(headers.get('strict-transport-security'), null);
    assert.equal(headers.get('x-frame-options'), null);
    assert.equal(headers.get('location'), '/https:/example.com/login?next=%2Fapp');
    assert.equal(headers.get('link'), '</https:/example.com/a.css>; rel=preload; as=style');
    assert.equal(headers.get('refresh'), '2; url=/https:/other.org/');
    assert.equal(headers.get('etag'), '"abc"');
    assert.equal(headers.get('cache-control'), 'public, max-age=60');
    assert.deepEqual(headers.getSetCookie(), ['a=1; Path=/https:/example.com', 'b=2; Path=/https:/example.com; Secure; HttpOnly']);
  });
});
