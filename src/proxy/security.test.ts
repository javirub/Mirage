import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_CONFIG } from '../config.js';
import { ProxyError } from './errors.js';
import { assertAllowedTarget, hostMatchesPattern, isBlockedHostname, isPrivateAddress } from './security.js';

describe('isPrivateAddress', () => {
  it('bloquea loopback, privadas, link-local y mapeadas IPv4-en-IPv6', () => {
    const blocked = [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
    ];
    for (const ip of blocked) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it('permite direcciones públicas', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  it('trata cadenas que no son IP como privadas', () => {
    assert.equal(isPrivateAddress('not-an-ip'), true);
  });
});

describe('isBlockedHostname', () => {
  it('bloquea nombres internos e IPs literales privadas', () => {
    const blocked = ['localhost', 'foo.localhost', 'printer.local', 'metadata.google.internal', '[::1]', '127.0.0.1', '10.0.0.1.', 'x.home.arpa'];
    for (const host of blocked) {
      assert.equal(isBlockedHostname(host), true, host);
    }
    assert.equal(isBlockedHostname('example.com'), false);
    assert.equal(isBlockedHostname('93.184.216.34'), false);
  });
});

describe('hostMatchesPattern', () => {
  it('soporta comodín de subdominios incluyendo el apex', () => {
    assert.equal(hostMatchesPattern('example.com', 'example.com'), true);
    assert.equal(hostMatchesPattern('a.example.com', 'example.com'), false);
    assert.equal(hostMatchesPattern('a.b.example.com', '*.example.com'), true);
    assert.equal(hostMatchesPattern('example.com', '*.example.com'), true);
    assert.equal(hostMatchesPattern('notexample.com', '*.example.com'), false);
  });
});

describe('assertAllowedTarget', () => {
  it('rechaza bucles, hosts privados y hosts fuera de la lista blanca', () => {
    assert.throws(
      () => assertAllowedTarget(new URL('https://proxy.test/x'), 'proxy.test', DEFAULT_CONFIG),
      (error: unknown) => error instanceof ProxyError && error.status === 403,
    );
    assert.throws(() => assertAllowedTarget(new URL('http://169.254.169.254/latest'), 'proxy.test', DEFAULT_CONFIG), ProxyError);
    assert.throws(
      () => assertAllowedTarget(new URL('https://other.com/'), 'proxy.test', { ...DEFAULT_CONFIG, allowedHosts: ['example.com'] }),
      ProxyError,
    );
    assert.doesNotThrow(() =>
      assertAllowedTarget(new URL('https://www.example.com/'), 'proxy.test', { ...DEFAULT_CONFIG, allowedHosts: ['*.example.com'] }),
    );
    assert.doesNotThrow(() =>
      assertAllowedTarget(new URL('http://127.0.0.1:8080/'), 'proxy.test', { ...DEFAULT_CONFIG, allowPrivateTargets: true }),
    );
  });
});
