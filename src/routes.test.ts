import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { createApp } from './routes.js';
import { DEFAULT_CONFIG } from './config.js';

const PROXY = 'http://localhost:3000';

function upstreamHandler(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://upstream');
  switch (url.pathname) {
    case '/':
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.setHeader('set-cookie', ['session=abc; Path=/; HttpOnly', '__Host-csrf=xyz; Path=/; Secure']);
      response.setHeader('content-security-policy', "default-src 'self'");
      response.end(
        '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><a href="/page?x=1">p</a><img src="img/a.png"></body></html>',
      );
      return;
    case '/latin1':
      response.setHeader('content-type', 'text/html; charset=iso-8859-1');
      response.end(Buffer.from('<html><head></head><body><p>año é</p></body></html>', 'latin1'));
      return;
    case '/style.css':
      response.setHeader('content-type', 'text/css');
      response.end('body{background:url(/bg.png)}');
      return;
    case '/redirect':
      response.statusCode = 302;
      response.setHeader('location', '/page?from=redirect');
      response.end();
      return;
    case '/echo': {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            method: request.method,
            body: Buffer.concat(chunks).toString('utf-8'),
            cookie: request.headers.cookie ?? null,
            referer: request.headers.referer ?? null,
            origin: request.headers.origin ?? null,
            host: request.headers.host ?? null,
            xForwardedFor: request.headers['x-forwarded-for'] ?? null,
          }),
        );
      });
      return;
    }
    case '/binary':
      response.setHeader('content-type', 'application/octet-stream');
      response.end(Buffer.from([0, 1, 2, 3, 255]));
      return;
    case '/fragment':
      response.setHeader('content-type', 'text/html');
      response.end('<li><a href="/item/1">uno</a></li>');
      return;
    default:
      response.statusCode = 404;
      response.setHeader('content-type', 'text/plain');
      response.end('not found');
  }
}

describe('proxy end-to-end', () => {
  let server: Server;
  let origin = '';
  let proxiedOrigin = '';
  const app = createApp({ ...DEFAULT_CONFIG, allowPrivateTargets: true });

  before(async () => {
    server = createServer(upstreamHandler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${String(port)}`;
    proxiedOrigin = origin.replace('://', ':/');
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  });

  const proxied = (path: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.fetch(new Request(`${PROXY}/${proxiedOrigin}${path}`, init)));

  it('sirve la portada y robots.txt', async () => {
    const landing = await app.fetch(new Request(`${PROXY}/`));
    assert.equal(landing.status, 200);
    assert.match(await landing.text(), /Mirage/);
    const robots = await app.fetch(new Request(`${PROXY}/robots.txt`));
    assert.match(await robots.text(), /Disallow: \//);
  });

  it('reescribe un documento HTML, sus cookies y elimina la CSP', async () => {
    const response = await proxied('/');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('content-security-policy'), null);
    assert.deepEqual(response.headers.getSetCookie(), [`session=abc; Path=/${proxiedOrigin}; HttpOnly`, `__mirage_host-csrf=xyz; Path=/${proxiedOrigin}`]);
    const html = await response.text();
    assert.ok(html.includes(`<base href="/${proxiedOrigin}/">`));
    assert.match(html, /<script data-mirage="runtime">/);
    assert.ok(html.includes(`href="/${proxiedOrigin}/style.css"`));
    assert.ok(html.includes(`href="/${proxiedOrigin}/page?x=1"`));
    assert.ok(html.includes(`src="/${proxiedOrigin}/img/a.png"`));
  });

  it('convierte a UTF-8 documentos en otras codificaciones', async () => {
    const response = await proxied('/latin1');
    assert.match(await response.text(), /año é/);
  });

  it('reescribe CSS', async () => {
    const response = await proxied('/style.css');
    assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(await response.text(), `body{background:url("/${proxiedOrigin}/bg.png")}`);
  });

  it('devuelve las redirecciones al navegador con Location reescrito', async () => {
    const response = await proxied('/redirect');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/${proxiedOrigin}/page?from=redirect`);
  });

  it('reenvía método, cuerpo, cookies restauradas y referer/origin reales', async () => {
    const response = await proxied('/echo', {
      method: 'POST',
      body: 'hola',
      headers: {
        'content-type': 'text/plain',
        cookie: '__mirage_host-csrf=xyz; session=abc',
        referer: `${PROXY}/${proxiedOrigin}/form`,
        origin: PROXY,
        'x-forwarded-for': '9.9.9.9',
      },
    });
    const echoed = (await response.json()) as Record<string, string | null>;
    assert.equal(echoed.method, 'POST');
    assert.equal(echoed.body, 'hola');
    assert.equal(echoed.cookie, '__Host-csrf=xyz; session=abc');
    assert.equal(echoed.referer, `${origin}/form`);
    assert.equal(echoed.origin, origin);
    assert.equal(echoed.host, new URL(origin).host);
    assert.equal(echoed.xForwardedFor, null);
  });

  it('transmite binarios sin tocarlos y conserva el estado de error del origen', async () => {
    const binary = await proxied('/binary');
    assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [0, 1, 2, 3, 255]);
    const missing = await proxied('/nope');
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), 'not found');
  });

  it('trata las respuestas HTML a fetch como fragmentos', async () => {
    const response = await proxied('/fragment', { headers: { 'sec-fetch-dest': 'empty' } });
    assert.equal(await response.text(), `<li><a href="/${proxiedOrigin}/item/1">uno</a></li>`);
  });

  it('redirige rutas sin objetivo usando el Referer proxificado', async () => {
    const response = await app.fetch(
      new Request(`${PROXY}/api/data?x=1`, { headers: { referer: `${PROXY}/${proxiedOrigin}/app/index.html` } }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `/${proxiedOrigin}/api/data?x=1`);
    const orphan = await app.fetch(new Request(`${PROXY}/api/data`));
    assert.equal(orphan.status, 404);
  });

  it('redirige rutas que empiezan por un host sin esquema a su versión https', async () => {
    const response = await app.fetch(new Request(`${PROXY}/www.example.com/path?q=1`));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/https:/www.example.com/path?q=1');
  });

  it('rechaza apuntar al propio proxy y hosts privados cuando la protección está activa', async () => {
    const loop = await app.fetch(new Request(`${PROXY}/http:/localhost:3000/x`));
    assert.equal(loop.status, 403);
    const guarded = createApp(DEFAULT_CONFIG);
    const blocked = await guarded.fetch(new Request(`${PROXY}/${proxiedOrigin}/`));
    assert.equal(blocked.status, 403);
  });
});
