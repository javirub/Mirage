import { serve } from '@hono/node-server';

import app from './index.js';

// Servidor local con Node (el mismo runtime que Vercel). Alternativa: `vc dev`.
const port = Number.parseInt(process.env.PORT ?? '3000', 10);

serve({ fetch: app.fetch, port, overrideGlobalObjects: false }, (info) => {
  console.log(`Mirage escuchando en http://localhost:${String(info.port)}`);
});
