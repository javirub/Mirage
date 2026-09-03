import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rewriteHtmlDocument, rewriteHtmlFragment } from './html.js';

const documentUrl = new URL('https://example.com/dir/page.html');

describe('rewriteHtmlDocument', () => {
  it('reescribe atributos con URL, srcset, estilos y meta refresh', () => {
    const input = `<!doctype html><html><head><title>t</title>
<link rel="stylesheet" href="/css/site.css" integrity="sha384-abc">
<style>body{background:url(/bg.png)}</style>
<meta http-equiv="refresh" content="0; url=/next">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
</head><body>
<a href="../other.html" ping="/track">x</a>
<img src="a.jpg" srcset="a.jpg 1x, /b.jpg 2x" style="background-image:url('c.png')">
<form action="/submit"><button formaction="https://other.org/alt">go</button></form>
<a href="#top">top</a><a href="javascript:void(0)">js</a><a href="mailto:a@b.c">mail</a>
<object data="/movie.swf"></object>
<svg><image href="/icon.svg"></image><use xlink:href="#id"></use></svg>
<template><img src="/in-template.png"></template>
<noscript><img src="/noscript.png"></noscript>
</body></html>`;
    const output = rewriteHtmlDocument(input, documentUrl);

    assert.match(output, /<link rel="stylesheet" href="\/https:\/\/example\.com\/css\/site\.css">/);
    assert.doesNotMatch(output, /integrity=/);
    assert.match(output, /body\{background:url\("\/https:\/\/example\.com\/bg\.png"\)\}/);
    assert.match(output, /content="0; url=\/https:\/\/example\.com\/next"/);
    assert.doesNotMatch(output, /Content-Security-Policy/i);
    assert.match(output, /<a href="\/https:\/\/example\.com\/other\.html">x<\/a>/);
    assert.doesNotMatch(output, /ping=/);
    assert.match(
      output,
      /src="\/https:\/\/example\.com\/dir\/a\.jpg" srcset="\/https:\/\/example\.com\/dir\/a\.jpg 1x, \/https:\/\/example\.com\/b\.jpg 2x"/,
    );
    assert.match(output, /style="background-image:url\(&quot;\/https:\/\/example\.com\/dir\/c\.png&quot;\)"/);
    assert.match(output, /<form action="\/https:\/\/example\.com\/submit">/);
    assert.match(output, /formaction="\/https:\/\/other\.org\/alt"/);
    assert.match(output, /<a href="#top">/);
    assert.match(output, /<a href="javascript:void\(0\)">/);
    assert.match(output, /<a href="mailto:a@b\.c">/);
    assert.match(output, /<object data="\/https:\/\/example\.com\/movie\.swf">/);
    assert.match(output, /<image href="\/https:\/\/example\.com\/icon\.svg">/);
    assert.match(output, /xlink:href="#id"/);
    assert.match(output, /<template><img src="\/https:\/\/example\.com\/in-template\.png"><\/template>/);
    assert.match(output, /<noscript><img src="\/https:\/\/example\.com\/noscript\.png"><\/noscript>/);
  });

  it('inyecta meta charset, base y runtime al principio de head, en ese orden', () => {
    const output = rewriteHtmlDocument(
      '<!doctype html><html><head><meta charset="iso-8859-1"><title>t</title></head><body></body></html>',
      documentUrl,
    );
    const head = /<head>(.*?)<\/head>/s.exec(output)?.[1] ?? '';
    assert.match(head, /^<meta charset="utf-8"><base href="\/https:\/\/example\.com\/dir\/page\.html"><script data-mirage="runtime">/);
    assert.equal(head.match(/<meta charset/g)?.length, 1);
    assert.match(head, /"target":"https:\/\/example\.com\/dir\/page\.html"/);
  });

  it('respeta un <base href> existente para resolver y lo neutraliza', () => {
    const output = rewriteHtmlDocument(
      '<html><head><base href="https://cdn.example.net/assets/" target="_blank"></head><body><img src="x.png"></body></html>',
      documentUrl,
    );
    assert.match(output, /<base href="\/https:\/\/cdn\.example\.net\/assets\/">/);
    assert.match(output, /<base target="_blank">/);
    assert.match(output, /<img src="\/https:\/\/cdn\.example\.net\/assets\/x\.png">/);
  });

  it('elimina meta content-type y no rompe entidades en atributos', () => {
    const output = rewriteHtmlDocument(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body><a href="/p?a=1&amp;b=2">x</a></body></html>',
      documentUrl,
    );
    assert.doesNotMatch(output, /windows-1252/);
    assert.match(output, /href="\/https:\/\/example\.com\/p\?a=1&amp;b=2"/);
  });
});

describe('rewriteHtmlFragment', () => {
  it('reescribe sin envolver ni inyectar runtime', () => {
    const output = rewriteHtmlFragment('<div><a href="/x">x</a><img src="y.png"></div>', documentUrl);
    assert.equal(output, '<div><a href="/https://example.com/x">x</a><img src="/https://example.com/dir/y.png"></div>');
  });
});
