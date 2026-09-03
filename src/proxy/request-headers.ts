import { rewriteCookieRequestHeader } from './cookies.js';
import { targetFromProxyUrl } from './target.js';

/** Cabeceras hop-by-hop, de infraestructura o que undici recalcula por su cuenta. */
const DROPPED_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'expect',
  'proxy-authorization',
  'proxy-connection',
  'content-length',
  'accept-encoding',
  'forwarded',
  'via',
  'x-real-ip',
  'cdn-loop',
]);
const DROPPED_PREFIXES: readonly string[] = ['x-forwarded-', 'x-vercel-', 'cf-'];

export interface RequestContext {
  readonly target: URL;
  readonly proxyOrigin: string;
}

function translateOrigin(value: string, referer: string | null, context: RequestContext): string {
  if (value === 'null') return value;
  const refererTarget = referer === null ? null : targetFromProxyUrl(referer);
  if (refererTarget !== null) return refererTarget.origin;
  return value === context.proxyOrigin ? context.target.origin : value;
}

/**
 * Construye las cabeceras que se envían al servidor origen a partir de las del navegador:
 * - `Referer` y `Origin` se traducen a las URLs reales (formularios, comprobaciones CSRF);
 * - `Cookie` recupera los nombres originales de las cookies con prefijo;
 * - se descartan las cabeceras de la infraestructura (Vercel, x-forwarded-*, hop-by-hop).
 */
export function buildUpstreamRequestHeaders(incoming: Headers, context: RequestContext): Headers {
  const headers = new Headers();
  incoming.forEach((value, name) => {
    if (DROPPED_HEADERS.has(name) || DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) return;
    switch (name) {
      case 'cookie':
        headers.set('cookie', rewriteCookieRequestHeader(value));
        return;
      case 'referer': {
        const real = targetFromProxyUrl(value);
        if (real !== null) headers.set('referer', real.href);
        return;
      }
      case 'origin':
        headers.set('origin', translateOrigin(value, incoming.get('referer'), context));
        return;
      default:
        headers.set(name, value);
    }
  });
  return headers;
}
