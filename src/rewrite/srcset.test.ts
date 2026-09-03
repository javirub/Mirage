import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSrcset, rewriteSrcset } from './srcset.js';

describe('parseSrcset', () => {
  it('separa candidatos con y sin descriptor', () => {
    assert.deepEqual(parseSrcset('a.jpg 1x, b.jpg 2x,c.jpg 300w ,  d.jpg'), [
      { url: 'a.jpg', descriptor: '1x' },
      { url: 'b.jpg', descriptor: '2x' },
      { url: 'c.jpg', descriptor: '300w' },
      { url: 'd.jpg', descriptor: '' },
    ]);
  });

  it('sigue la especificación con las comas: pegada al final separa, sin espacio forma parte de la URL', () => {
    assert.deepEqual(parseSrcset('a.jpg,\nb.jpg 2x'), [
      { url: 'a.jpg', descriptor: '' },
      { url: 'b.jpg', descriptor: '2x' },
    ]);
    assert.deepEqual(parseSrcset('a.jpg,b.jpg 2x'), [{ url: 'a.jpg,b.jpg', descriptor: '2x' }]);
  });
});

describe('rewriteSrcset', () => {
  it('reescribe cada URL y conserva los descriptores', () => {
    assert.equal(
      rewriteSrcset('/a.jpg 1x, /b.jpg 2x', (url) => `/https:/example.com${url}`),
      '/https:/example.com/a.jpg 1x, /https:/example.com/b.jpg 2x',
    );
  });
});
