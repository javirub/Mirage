/**
 * Configuración del proxy, leída de variables de entorno.
 *
 * - `MIRAGE_ALLOWED_HOSTS`: lista separada por comas de hosts permitidos (`example.com`,
 *   `*.example.com`). Vacía = cualquier host público.
 * - `MIRAGE_ALLOW_PRIVATE_TARGETS`: `1`/`true` para permitir objetivos en redes privadas o
 *   loopback. Solo para desarrollo y tests: desactiva la protección anti-SSRF.
 * - `MIRAGE_UPSTREAM_TIMEOUT_MS`: tiempo máximo esperando las cabeceras del servidor origen.
 * - `MIRAGE_MAX_REWRITE_BYTES`: tamaño máximo de HTML/CSS que se reescribe en memoria; por
 *   encima se transmite tal cual.
 */
export interface MirageConfig {
  readonly allowPrivateTargets: boolean;
  readonly allowedHosts: readonly string[];
  readonly upstreamTimeoutMs: number;
  readonly maxRewriteBytes: number;
}

export const DEFAULT_CONFIG: MirageConfig = {
  allowPrivateTargets: false,
  allowedHosts: [],
  upstreamTimeoutMs: 20_000,
  maxRewriteBytes: 8 * 1024 * 1024,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MirageConfig {
  return {
    allowPrivateTargets: isTruthy(env.MIRAGE_ALLOW_PRIVATE_TARGETS),
    allowedHosts: parseList(env.MIRAGE_ALLOWED_HOSTS),
    upstreamTimeoutMs: parsePositiveInteger(env.MIRAGE_UPSTREAM_TIMEOUT_MS, DEFAULT_CONFIG.upstreamTimeoutMs),
    maxRewriteBytes: parsePositiveInteger(env.MIRAGE_MAX_REWRITE_BYTES, DEFAULT_CONFIG.maxRewriteBytes),
  };
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseList(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
