import { lookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import type { MirageConfig } from '../config.js';
import { BlockedTargetError, ProxyError } from './errors.js';

/**
 * Rangos que nunca se deben alcanzar desde un proxy público: loopback, redes privadas,
 * link-local (incluye los metadatos de AWS/GCP en 169.254.169.254), CGNAT, multicast, etc.
 */
const blockList = new BlockList();
blockList.addSubnet('0.0.0.0', 8, 'ipv4');
blockList.addSubnet('10.0.0.0', 8, 'ipv4');
blockList.addSubnet('100.64.0.0', 10, 'ipv4');
blockList.addSubnet('127.0.0.0', 8, 'ipv4');
blockList.addSubnet('169.254.0.0', 16, 'ipv4');
blockList.addSubnet('172.16.0.0', 12, 'ipv4');
blockList.addSubnet('192.0.0.0', 24, 'ipv4');
blockList.addSubnet('192.0.2.0', 24, 'ipv4');
blockList.addSubnet('192.168.0.0', 16, 'ipv4');
blockList.addSubnet('198.18.0.0', 15, 'ipv4');
blockList.addSubnet('198.51.100.0', 24, 'ipv4');
blockList.addSubnet('203.0.113.0', 24, 'ipv4');
blockList.addSubnet('224.0.0.0', 4, 'ipv4');
blockList.addSubnet('240.0.0.0', 4, 'ipv4');
blockList.addSubnet('::', 128, 'ipv6');
blockList.addSubnet('::1', 128, 'ipv6');
blockList.addSubnet('64:ff9b::', 96, 'ipv6');
blockList.addSubnet('fc00::', 7, 'ipv6');
blockList.addSubnet('fe80::', 10, 'ipv6');
blockList.addSubnet('ff00::', 8, 'ipv6');

const BLOCKED_HOSTNAME = /^(?:localhost|.+\.localhost|.+\.local|.+\.internal|.+\.arpa|.+\.home|.+\.lan)$/i;

/** `true` si la IP pertenece a un rango privado/reservado (o no es una IP válida). */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return blockList.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** Comprobación sincrónica sobre el hostname (IPs literales y nombres claramente internos). */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === '') return true;
  if (isIP(host) !== 0) return isPrivateAddress(host);
  return BLOCKED_HOSTNAME.test(host);
}

/**
 * `lookup` para el conector de undici: resuelve el nombre y descarta las direcciones privadas,
 * de modo que la conexión solo puede ir a la IP validada (evita DNS rebinding).
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error !== null) {
      callback(error, '');
      return;
    }
    const allowed = addresses.filter((entry) => !isPrivateAddress(entry.address));
    const [first] = allowed;
    if (first === undefined) {
      callback(new BlockedTargetError(hostname), '');
      return;
    }
    if (options.all === true) {
      callback(null, allowed);
      return;
    }
    callback(null, first.address, first.family);
  });
};

/** Coincidencia de host contra un patrón `example.com` o `*.example.com` (este último incluye el apex). */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === pattern;
}

/** Lanza `ProxyError` si el objetivo no debe proxificarse. */
export function assertAllowedTarget(target: URL, proxyHost: string, config: MirageConfig): void {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new ProxyError(400, 'Solo se admiten URLs http:// y https://');
  }
  const host = target.hostname.toLowerCase();
  if (target.host.toLowerCase() === proxyHost.toLowerCase()) {
    throw new ProxyError(403, 'El proxy no puede apuntarse a sí mismo');
  }
  if (config.allowedHosts.length > 0 && !config.allowedHosts.some((pattern) => hostMatchesPattern(host, pattern))) {
    throw new ProxyError(403, 'Este host no está en la lista de hosts permitidos', host);
  }
  if (!config.allowPrivateTargets && isBlockedHostname(host)) {
    throw new ProxyError(403, 'No se permite acceder a hosts privados o internos', host);
  }
}
