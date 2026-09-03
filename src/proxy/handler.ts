import type { Agent, Response as UndiciResponse } from 'undici';

import type { MirageConfig } from '../config.js';
import { renderErrorPage } from '../pages/error.js';
import { decodeText } from '../rewrite/charset.js';
import { rewriteCss } from '../rewrite/css.js';
import { rewriteHtmlDocument, rewriteHtmlFragment } from '../rewrite/html.js';
import { BlockedTargetError, ProxyError } from './errors.js';
import { buildUpstreamRequestHeaders } from './request-headers.js';
import { buildDownstreamResponseHeaders } from './response-headers.js';
import { assertAllowedTarget } from './security.js';
import { parseTargetPath, targetFromProxyUrl, toProxyPath } from './target.js';
import { createUpstreamAgent, fetchUpstream } from './upstream.js';

export interface ProxyRuntime {
  readonly config: MirageConfig;
  readonly agent: Agent;
}

export function createProxyRuntime(config: MirageConfig): ProxyRuntime {
  return { config, agent: createUpstreamAgent(config.allowPrivateTargets) };
}

interface ProxyIdentity {
  readonly origin: string;
  readonly host: string;
  readonly secure: boolean;
}

/** Origen público del proxy, teniendo en cuenta las cabeceras `x-forwarded-*` que añade Vercel. */
function describeProxy(request: Request): ProxyIdentity {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto !== undefined && forwardedProto !== '' ? forwardedProto : url.protocol.replace(/:$/, '');
  const host = forwardedHost !== undefined && forwardedHost !== '' ? forwardedHost : (request.headers.get('host') ?? url.host);
  return { origin: `${protocol}://${host}`, host, secure: protocol === 'https' };
}

type ContentKind = 'html' | 'css' | 'other';

function classifyContent(contentType: string): ContentKind {
  const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime === 'text/css') return 'css';
  return 'other';
}

const DOCUMENT_DESTINATIONS: ReadonlySet<string> = new Set(['document', 'iframe', 'frame', 'object', 'embed']);

/** Las respuestas HTML a fetch/XHR son fragmentos: no se envuelven en html/body ni llevan runtime. */
function isDocumentRequest(request: Request): boolean {
  const destination = request.headers.get('sec-fetch-dest');
  return destination === null || DOCUMENT_DESTINATIONS.has(destination);
}

async function htmlResponse(status: number, body: string): Promise<Response> {
  const headers = new Headers();
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(body, { status, headers });
}

async function errorResponse(error: unknown, target: URL): Promise<Response> {
  const described = describeError(error);
  if (described.status >= 500) console.error('[mirage] error proxificando', target.href, error);
  return htmlResponse(described.status, await renderErrorPage({ ...described, target: target.href }));
}

interface DescribedError {
  readonly status: number;
  readonly message: string;
  readonly detail: string | undefined;
}

function describeError(error: unknown): DescribedError {
  if (error instanceof ProxyError) return { status: error.status, message: error.message, detail: error.detail };
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof ProxyError) return { status: cause.status, message: cause.message, detail: cause.detail };
  if (cause instanceof BlockedTargetError) {
    return { status: 403, message: 'No se permite acceder a hosts privados o internos', detail: cause.message };
  }
  const code = cause instanceof Error && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { status: 502, message: 'No se pudo resolver el nombre del servidor origen', detail: code };
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
      return { status: 502, message: 'No se pudo conectar con el servidor origen', detail: code };
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'ETIMEDOUT':
      return { status: 504, message: 'El servidor origen no respondió a tiempo', detail: code };
    default:
      return {
        status: 502,
        message: 'Error al obtener el recurso del servidor origen',
        detail: error instanceof Error ? error.message : undefined,
      };
  }
}

async function buildProxyResponse(
  request: Request,
  upstream: UndiciResponse,
  target: URL,
  proxy: ProxyIdentity,
  config: MirageConfig,
): Promise<Response> {
  const headers = buildDownstreamResponseHeaders(upstream.headers, { target, secure: proxy.secure });
  const status = upstream.status;
  const init: ResponseInit = { status, statusText: upstream.statusText, headers };

  const hasBody = request.method !== 'HEAD' && status !== 204 && status !== 304 && upstream.body !== null;
  if (!hasBody) {
    await upstream.body?.cancel();
    return new Response(null, init);
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const kind = classifyContent(contentType);
  const declaredLength = Number(upstream.headers.get('content-length') ?? '0');
  if (kind === 'other' || declaredLength > config.maxRewriteBytes) {
    return new Response(upstream.body, init);
  }

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength > config.maxRewriteBytes) {
    return new Response(bytes, init);
  }
  const text = decodeText(bytes, contentType, kind === 'html');
  if (kind === 'css') {
    headers.set('content-type', 'text/css; charset=utf-8');
    return new Response(rewriteCss(text, target), init);
  }
  // XHTML se sirve como text/html: la serialización HTML no es XML bien formado.
  headers.set('content-type', 'text/html; charset=utf-8');
  const rewritten = isDocumentRequest(request) ? rewriteHtmlDocument(text, target) : rewriteHtmlFragment(text, target);
  return new Response(rewritten, init);
}

/**
 * Petición sin objetivo en la ruta (`/imagen.png`, `/api/...`): normalmente una URL construida
 * por JavaScript a partir de `location.origin`. Si el `Referer` es una página proxificada, se
 * redirige a la misma ruta dentro de su origen real (307 conserva método y cuerpo).
 */
async function handleUntargeted(request: Request, requestUrl: URL): Promise<Response> {
  const referer = request.headers.get('referer');
  const refererTarget = referer === null ? null : targetFromProxyUrl(referer);
  if (refererTarget !== null) {
    const resolved = new URL(requestUrl.pathname + requestUrl.search, refererTarget);
    return new Response(null, { status: 307, headers: { location: toProxyPath(resolved), 'cache-control': 'no-store' } });
  }
  if (requestUrl.pathname === '/favicon.ico') return new Response(null, { status: 204 });
  return htmlResponse(
    404,
    await renderErrorPage({
      status: 404,
      message: 'Esta ruta no contiene una URL que proxificar',
      detail: `Usa el formato /https://ejemplo.com/ruta (recibido: ${requestUrl.pathname})`,
      target: undefined,
    }),
  );
}

export async function handleProxyRequest(request: Request, runtime: ProxyRuntime): Promise<Response> {
  const { config } = runtime;
  const proxy = describeProxy(request);
  const requestUrl = new URL(request.url);
  const target = parseTargetPath(requestUrl.pathname + requestUrl.search);
  if (target === null) return handleUntargeted(request, requestUrl);

  try {
    assertAllowedTarget(target, proxy.host, config);
    const headers = buildUpstreamRequestHeaders(request.headers, { target, proxyOrigin: proxy.origin });
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
    const upstream = await fetchUpstream({
      target,
      method: request.method,
      headers,
      body,
      timeoutMs: config.upstreamTimeoutMs,
      agent: runtime.agent,
    });
    return await buildProxyResponse(request, upstream, target, proxy, config);
  } catch (error) {
    return errorResponse(error, target);
  }
}
