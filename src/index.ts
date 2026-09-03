import { Hono } from 'hono';

import { registerRoutes } from './app.js';
import { loadConfig } from './config.js';

// Entrypoint que Vercel detecta como backend Hono: debe importar `hono` y exportar la app.
const app = registerRoutes(new Hono(), loadConfig());

export default app;
