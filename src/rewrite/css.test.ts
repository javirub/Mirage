import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rewriteCss } from './css.js';

const base = new URL('https://example.com/css/site.css');

describe('rewriteCss', () => {
  it('reescribe url() con y sin comillas', () => {
    const css = `a{background:url(img/a.png)} b{background:url( "/b.png" )} c{background:url('//cdn.example.net/c.png')}`;
    assert.equal(
      rewriteCss(css, base),
      `a{background:url("/https://example.com/css/img/a.png")} b{background:url("/https://example.com/b.png")} c{background:url("/https://cdn.example.net/c.png")}`,
    );
  });

  it('reescribe @import con cadena y con url()', () => {
    assert.equal(
      rewriteCss(`@import "reset.css"; @import url('print.css') print;`, base),
      `@import "/https://example.com/css/reset.css"; @import url("/https://example.com/css/print.css") print;`,
    );
  });

  it('deja intactos data: y fragmentos', () => {
    const css = `a{background:url(data:image/png;base64,AAA=)} b{fill:url(#grad)}`;
    assert.equal(rewriteCss(css, base), css);
  });
});
