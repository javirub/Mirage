import { proxifyUrl, rewriteLinkHeader, rewriteRefresh } from '../rewrite/url.js';
import { rewriteSetCookie } from './cookies.js';

/**
 * Cabeceras que no deben llegar al navegador:
 * - de transporte (undici ya descomprimió el cuerpo y la longitud cambia al reescribir);
 * - políticas de seguridad ligadas al origen real, que romperían la página servida desde el proxy;
 * - `set-cookie` se trata aparte porque `Headers.forEach` lo devuelve combinado.
 */
const DROPPED_HEADERS: ReadonlySet<string> = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'trailer',
  'upgrade',
  'set-cookie',
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'x-frame-options',
  'public-key-pins',
  'expect-ct',
  'report-to',
  'reporting-endpoints',
  'nel',
  'alt-svc',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'feature-policy',
  'document-policy',
  'origin-agent-cluster',
  'clear-site-data',
  'service-worker-allowed',
  'x-xss-protection',
]);

export interface ResponseContext {
  readonly target: URL;
  /** `true` cuando el navegador habla con el proxy por HTTPS (siempre en Vercel; no en `localhost`). */
  readonly secure: boolean;
}

export function buildDownstreamResponseHeaders(upstream: Headers, context: ResponseContext): Headers {
  const headers = new Headers();
  upstream.forEach((value, name) => {
    if (DROPPED_HEADERS.has(name)) return;
    switch (name) {
      case 'location':
      case 'content-location':
        headers.set(name, proxifyUrl(value, context.target));
        return;
      case 'refresh':
        headers.set(name, rewriteRefresh(value, context.target));
        return;
      case 'link':
        headers.set(name, rewriteLinkHeader(value, context.target));
        return;
      default:
        headers.set(name, value);
    }
  });
  for (const cookie of upstream.getSetCookie()) {
    headers.append('set-cookie', rewriteSetCookie(cookie, context.target, context.secure));
  }
  return headers;
}
