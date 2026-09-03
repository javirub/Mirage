/**
 * Esquema de URLs del proxy: `https://<proxy>/https:/example.com/ruta?query`.
 *
 * La URL real va detrás de la primera barra, así que todas las URLs reescritas son rutas
 * absolutas del propio proxy y las cookies pueden delimitarse por origen con el atributo `Path`.
 *
 * La forma canónica lleva UNA sola barra tras el esquema (`/https:/host/...`): Vercel colapsa
 * las barras dobles del path con un 308, así que generar `//` costaría una redirección por
 * navegación y rompería el `Path` de las cookies. Al parsear se aceptan ambas formas, de modo
 * que un usuario puede escribir `/https://host/...` a mano.
 */
const TARGET_PATH = /^\/(https?):\/{1,2}(?=[^/])(.*)$/is;
const SCHEME_SEPARATOR = /^(https?):\/\//i;

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

/** Ruta absoluta en el proxy que representa a la URL real (forma canónica, una barra tras el esquema). */
export function toProxyPath(target: URL | string): string {
  const href = typeof target === 'string' ? target : target.href;
  return `/${href.replace(SCHEME_SEPARATOR, '$1:/')}`;
}

/** Prefijo de ruta bajo el que viven todas las URLs de un origen (se usa como `Path` de cookies). */
export function originPathPrefix(target: URL): string {
  return `/${target.protocol}/${target.host}`;
}

const ASSET_EXTENSION = /\.(?:js|mjs|css|map|json|xml|txt|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|mp4|webm|pdf)$/i;
const HOSTNAME_LIKE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?$/i;

/**
 * Si una ruta sin esquema empieza por algo que parece un host (`/google.es/x`), devuelve la URL
 * https equivalente. Sirve para que escribir `/ejemplo.com` en la barra de direcciones funcione.
 */
export function targetFromBareHostPath(pathAndQuery: string): URL | null {
  const [firstSegment = ''] = pathAndQuery.replace(/^\//, '').split(/[/?]/, 1);
  if (!HOSTNAME_LIKE.test(firstSegment) || ASSET_EXTENSION.test(firstSegment)) return null;
  try {
    return new URL(`https:/${pathAndQuery}`);
  } catch {
    return null;
  }
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
