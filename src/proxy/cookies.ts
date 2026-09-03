import { originPathPrefix } from './target.js';

/**
 * Los prefijos `__Host-` y `__Secure-` imponen requisitos (Path=/, Secure, sin Domain) que
 * no podemos cumplir al delimitar cookies por origen, así que se renombran hacia el navegador
 * y se restauran al reenviar la cabecera `Cookie` al servidor origen.
 */
const PREFIX_MAP: ReadonlyArray<readonly [upstream: string, browser: string]> = [
  ['__Host-', '__mirage_host-'],
  ['__Secure-', '__mirage_secure-'],
];

export function toBrowserCookieName(name: string): string {
  for (const [upstream, browser] of PREFIX_MAP) {
    if (name.startsWith(upstream)) return browser + name.slice(upstream.length);
  }
  return name;
}

export function toUpstreamCookieName(name: string): string {
  for (const [upstream, browser] of PREFIX_MAP) {
    if (name.startsWith(browser)) return upstream + name.slice(browser.length);
  }
  return name;
}

/**
 * Reescribe un `Set-Cookie` del servidor origen para el navegador:
 * - se elimina `Domain` y `Path` se fija al prefijo del origen (`/https://host`), de forma que
 *   el navegador solo la envía a peticiones proxificadas de ese mismo origen;
 * - en desarrollo sin TLS se retira `Secure` y `SameSite=None` pasa a `Lax`.
 */
export function rewriteSetCookie(header: string, target: URL, secure: boolean): string {
  const parts = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const [pair = '', ...attributes] = parts;
  const separator = pair.indexOf('=');
  const rawName = separator === -1 ? pair : pair.slice(0, separator);
  const value = separator === -1 ? '' : pair.slice(separator + 1);
  const name = toBrowserCookieName(rawName.trim());

  const kept: string[] = [];
  let sameSite: string | undefined;
  for (const attribute of attributes) {
    const equals = attribute.indexOf('=');
    const key = (equals === -1 ? attribute : attribute.slice(0, equals)).trim().toLowerCase();
    const attributeValue = equals === -1 ? '' : attribute.slice(equals + 1).trim();
    switch (key) {
      case 'domain':
      case 'path':
        break;
      case 'secure':
        if (secure) kept.push('Secure');
        break;
      case 'samesite':
        sameSite = attributeValue;
        break;
      default:
        kept.push(attribute);
    }
  }
  if (sameSite !== undefined) {
    kept.push(sameSite.toLowerCase() === 'none' && !secure ? 'SameSite=Lax' : `SameSite=${sameSite}`);
  }
  return [`${name}=${value}`, `Path=${originPathPrefix(target)}`, ...kept].join('; ');
}

/** Restaura los nombres de cookie originales en la cabecera `Cookie` que envía el navegador. */
export function rewriteCookieRequestHeader(header: string): string {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator === -1) return pair;
      return `${toUpstreamCookieName(pair.slice(0, separator))}=${pair.slice(separator + 1)}`;
    })
    .join('; ');
}
