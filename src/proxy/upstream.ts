import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';

import { ProxyError } from './errors.js';
import { guardedLookup } from './security.js';

export interface UpstreamRequest {
  readonly target: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: ArrayBuffer | null;
  readonly timeoutMs: number;
  readonly agent: Agent;
}

/**
 * Agente HTTP compartido. Salvo en desarrollo, resuelve DNS con `guardedLookup`, así la
 * conexión solo puede abrirse contra direcciones públicas ya validadas.
 */
export function createUpstreamAgent(allowPrivateTargets: boolean): Agent {
  return new Agent({
    connect: {
      timeout: 10_000,
      ...(allowPrivateTargets ? {} : { lookup: guardedLookup }),
    },
  });
}

/**
 * Pide el recurso al servidor origen sin seguir redirecciones (el navegador las sigue a través
 * del proxy, lo que mantiene la URL correcta y las cookies de cada salto).
 * El timeout cubre solo la fase de cabeceras; el cuerpo se transmite en streaming después.
 */
export async function fetchUpstream(request: UpstreamRequest): Promise<UndiciResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new ProxyError(504, 'El servidor origen no respondió a tiempo', request.target.host));
  }, request.timeoutMs);
  try {
    return await undiciFetch(request.target, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
      dispatcher: request.agent,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
