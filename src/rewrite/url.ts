import { toProxyPath } from '../proxy/target.js';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Convierte cualquier referencia de URL encontrada en un documento (absoluta, relativa,
 * protocol-relative...) en la ruta equivalente del proxy, resolviéndola contra `base`.
 *
 * Devuelve el valor original cuando no debe tocarse: cadenas vacías, fragmentos (`#x`) y
 * esquemas distintos de http/https (`data:`, `blob:`, `javascript:`, `mailto:`, `tel:`...).
 */
export function proxifyUrl(raw: string, base: URL): string {
  const value = raw.trim();
  if (value === '' || value.startsWith('#')) return raw;
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') return raw;
  let absolute: URL;
  try {
    absolute = new URL(value, base);
  } catch {
    return raw;
  }
  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return raw;
  return toProxyPath(absolute);
}

const REFRESH = /^(\s*[\d.]+\s*[;,]?\s*)(?:url\s*=\s*)?(["']?)(.*?)\2\s*$/is;

/** Reescribe el valor de `<meta http-equiv="refresh">` o de la cabecera `Refresh`. */
export function rewriteRefresh(value: string, base: URL): string {
  const match = REFRESH.exec(value);
  if (match === null) return value;
  const delay = match[1] ?? '';
  const url = match[3] ?? '';
  if (url === '') return value;
  return `${delay.replace(/[\s;,]+$/, '')}; url=${proxifyUrl(url, base)}`;
}

/** Reescribe las URLs `<...>` de una cabecera `Link` (preload, preconnect...). */
export function rewriteLinkHeader(value: string, base: URL): string {
  return value.replace(/<([^>]*)>/g, (_match: string, url: string) => `<${proxifyUrl(url, base)}>`);
}
