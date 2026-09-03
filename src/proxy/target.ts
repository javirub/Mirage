/**
 * Esquema de URLs del proxy: `https://<proxy>/https://example.com/ruta?query`.
 *
 * La URL real va tal cual detrás de la primera barra, así que todas las URLs reescritas son
 * rutas absolutas del propio proxy (`/https://...`) y las cookies pueden delimitarse por
 * origen con el atributo `Path`.
 *
 * Se acepta también una sola barra tras el esquema (`/https:/example.com/...`) por si algún
 * intermediario colapsa las barras dobles.
 */
const TARGET_PATH = /^\/(https?):\/{1,2}(?=[^/])(.*)$/is;

/** Extrae la URL objetivo de `pathname + search` de una petición al proxy. */
export function parseTargetPath(pathAndQuery: string): URL | null {
  const match = TARGET_PATH.exec(pathAndQuery);
  if (match === null) return null;
  const scheme = match[1] ?? '';
  const rest = match[2] ?? '';
  let url: URL;
  try {
    url = new URL(`${scheme.toLowerCase()}://${rest}`);
  } catch {
    return null;
  }
  if (url.hostname === '' || url.username !== '' || url.password !== '') return null;
  url.hash = '';
  return url;
}

/** Extrae la URL objetivo de una URL absoluta del proxy (por ejemplo la cabecera `Referer`). */
export function targetFromProxyUrl(proxyUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    return null;
  }
  return parseTargetPath(url.pathname + url.search);
}

/** Ruta absoluta en el proxy que representa a la URL real. */
export function toProxyPath(target: URL | string): string {
  const href = typeof target === 'string' ? target : target.href;
  return `/${href}`;
}

/** Prefijo de ruta bajo el que viven todas las URLs de un origen (se usa como `Path` de cookies). */
export function originPathPrefix(target: URL): string {
  return `/${target.protocol}//${target.host}`;
}

/** Normaliza lo que escribe un usuario en el formulario de la portada (`ejemplo.com` → `https://ejemplo.com/`). */
export function normalizeUserUrl(raw: string): URL | null {
  const value = raw.trim();
  if (value === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '' || url.username !== '' || url.password !== '') return null;
  return url;
}
