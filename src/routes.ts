import { Hono } from 'hono';

import type { MirageConfig } from './config.js';
import { renderLandingPage } from './pages/landing.js';
import { renderErrorPage } from './pages/error.js';
import { createProxyRuntime, handleProxyRequest, robotsResponse } from './proxy/handler.js';
import { normalizeUserUrl, toProxyPath } from './proxy/target.js';

/** Registra las rutas del proxy en una app Hono. Separado del entrypoint para poder crear apps en tests. */
export function registerRoutes(app: Hono, config: MirageConfig): Hono {
  const runtime = createProxyRuntime(config);

  app.get('/', async (c) => c.html(await renderLandingPage()));

  app.get('/robots.txt', () => robotsResponse());

  // Destino del formulario de la portada cuando no hay JavaScript.
  app.get('/__mirage/go', async (c) => {
    const target = normalizeUserUrl(c.req.query('url') ?? '');
    if (target === null) {
      return c.html(
        await renderErrorPage({ status: 400, message: 'URL no válida', detail: undefined, target: undefined }),
        400,
      );
    }
    return c.redirect(toProxyPath(target), 302);
  });

  app.all('*', (c) => handleProxyRequest(c.req.raw, runtime));

  return app;
}

export function createApp(config: MirageConfig): Hono {
  return registerRoutes(new Hono(), config);
}
