import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { proxifyUrl, rewriteLinkHeader, rewriteRefresh } from './url.js';

const base = new URL('https://example.com/dir/page.html?q=1');

describe('proxifyUrl', () => {
  it('resuelve URLs relativas, absolutas de ruta y protocol-relative', () => {
    assert.equal(proxifyUrl('img.png', base), '/https://example.com/dir/img.png');
    assert.equal(proxifyUrl('/static/app.js', base), '/https://example.com/static/app.js');
    assert.equal(proxifyUrl('//cdn.example.net/lib.js', base), '/https://cdn.example.net/lib.js');
    assert.equal(proxifyUrl('https://other.org/x?y=1#z', base), '/https://other.org/x?y=1#z');
    assert.equal(proxifyUrl('  ../up.css  ', base), '/https://example.com/up.css');
  });

  it('no toca fragmentos, cadenas vacías ni esquemas no web', () => {
    const untouched = [
      '',
      '#top',
      'javascript:void(0)',
      'mailto:a@b.c',
      'tel:+34600',
      'data:image/png;base64,AAA',
      'blob:https://x/uuid',
      'about:blank',
    ];
    for (const value of untouched) {
      assert.equal(proxifyUrl(value, base), value);
    }
  });

  it('codifica caracteres que URL normaliza', () => {
    assert.equal(proxifyUrl('/a b', base), '/https://example.com/a%20b');
  });
});

describe('rewriteRefresh', () => {
  it('reescribe la URL del meta refresh en sus distintas formas', () => {
    assert.equal(rewriteRefresh('0; url=/login', base), '0; url=/https://example.com/login');
    assert.equal(rewriteRefresh("5;URL='https://other.org/'", base), '5; url=/https://other.org/');
    assert.equal(rewriteRefresh('3', base), '3');
  });
});

describe('rewriteLinkHeader', () => {
  it('reescribe cada URL entre ángulos', () => {
    assert.equal(
      rewriteLinkHeader('</style.css>; rel=preload; as=style, <https://cdn.example.net/f.woff2>; rel=preload; as=font', base),
      '</https://example.com/style.css>; rel=preload; as=style, </https://cdn.example.net/f.woff2>; rel=preload; as=font',
    );
  });
});
