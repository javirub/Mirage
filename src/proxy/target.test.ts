import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeUserUrl, originPathPrefix, parseTargetPath, targetFromProxyUrl, toProxyPath } from './target.js';

describe('parseTargetPath', () => {
  it('extrae la URL objetivo con su query', () => {
    const target = parseTargetPath('/https://example.com/a/b?x=1&y=2');
    assert.equal(target?.href, 'https://example.com/a/b?x=1&y=2');
  });

  it('acepta una sola barra tras el esquema (barras colapsadas)', () => {
    assert.equal(parseTargetPath('/https:/example.com/a')?.href, 'https://example.com/a');
  });

  it('normaliza el origen sin ruta', () => {
    assert.equal(parseTargetPath('/http://Example.COM')?.href, 'http://example.com/');
  });

  it('rechaza rutas sin esquema, esquemas no http y credenciales', () => {
    assert.equal(parseTargetPath('/static/app.js'), null);
    assert.equal(parseTargetPath('/'), null);
    assert.equal(parseTargetPath('/ftp://example.com/x'), null);
    assert.equal(parseTargetPath('/https:///example.com'), null);
    assert.equal(parseTargetPath('/https://user:pw@example.com/'), null);
  });
});

describe('toProxyPath / originPathPrefix', () => {
  it('construye la ruta del proxy y el prefijo de cookies', () => {
    const target = new URL('https://example.com:8443/dir/page?q=1#frag');
    assert.equal(toProxyPath(target), '/https://example.com:8443/dir/page?q=1#frag');
    assert.equal(originPathPrefix(target), '/https://example.com:8443');
  });
});

describe('targetFromProxyUrl', () => {
  it('recupera el objetivo de una URL absoluta del proxy', () => {
    assert.equal(targetFromProxyUrl('https://proxy.test/https://example.com/p?a=1')?.href, 'https://example.com/p?a=1');
    assert.equal(targetFromProxyUrl('https://proxy.test/'), null);
    assert.equal(targetFromProxyUrl('no es una url'), null);
  });
});

describe('normalizeUserUrl', () => {
  it('añade https:// cuando falta el esquema', () => {
    assert.equal(normalizeUserUrl(' ejemplo.com/ruta ')?.href, 'https://ejemplo.com/ruta');
    assert.equal(normalizeUserUrl('http://ejemplo.com')?.href, 'http://ejemplo.com/');
    assert.equal(normalizeUserUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUserUrl(''), null);
  });
});
