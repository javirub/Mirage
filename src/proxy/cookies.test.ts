import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rewriteCookieRequestHeader, rewriteSetCookie } from './cookies.js';

const target = new URL('https://www.example.com/login');

describe('rewriteSetCookie', () => {
  it('delimita la cookie al origen y elimina Domain', () => {
    assert.equal(
      rewriteSetCookie('sid=abc; Domain=.example.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600', target, true),
      'sid=abc; Path=/https://www.example.com; HttpOnly; Secure; Max-Age=3600; SameSite=Lax',
    );
  });

  it('adapta Secure y SameSite=None cuando el proxy va por http', () => {
    assert.equal(rewriteSetCookie('a=1; Secure; SameSite=None', target, false), 'a=1; Path=/https://www.example.com; SameSite=Lax');
    assert.equal(
      rewriteSetCookie('a=1; Secure; SameSite=None', target, true),
      'a=1; Path=/https://www.example.com; Secure; SameSite=None',
    );
  });

  it('renombra los prefijos __Host- y __Secure-', () => {
    assert.match(rewriteSetCookie('__Host-csrf=t; Path=/; Secure', target, true), /^__mirage_host-csrf=t; /);
    assert.match(rewriteSetCookie('__Secure-id=t; Secure', target, true), /^__mirage_secure-id=t; /);
  });

  it('conserva valores con = y atributos Expires con comas', () => {
    assert.equal(
      rewriteSetCookie('tok=a=b==; Expires=Wed, 21 Oct 2026 07:28:00 GMT', target, true),
      'tok=a=b==; Path=/https://www.example.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
    );
  });
});

describe('rewriteCookieRequestHeader', () => {
  it('restaura los nombres originales', () => {
    assert.equal(
      rewriteCookieRequestHeader('__mirage_host-csrf=t; sid=abc; __mirage_secure-id=1'),
      '__Host-csrf=t; sid=abc; __Secure-id=1',
    );
  });
});
