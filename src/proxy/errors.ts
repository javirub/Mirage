/** Error con código HTTP que el handler convierte en una página de error. */
export class ProxyError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
    this.detail = detail;
  }
}

/** Objetivo rechazado por la protección anti-SSRF (host privado, loopback, metadatos cloud, etc.). */
export class BlockedTargetError extends Error {
  readonly code = 'EBLOCKED';

  constructor(hostname: string) {
    super(`El host "${hostname}" no está permitido`);
    this.name = 'BlockedTargetError';
  }
}
