const CONTENT_TYPE_CHARSET = /;\s*charset\s*=\s*"?([^";\s]+)"?/i;
const META_CHARSET = /<meta[^>]*charset\s*=\s*["']?\s*([a-z0-9._:-]+)/i;

export function charsetFromContentType(contentType: string | null): string | undefined {
  if (contentType === null) return undefined;
  return CONTENT_TYPE_CHARSET.exec(contentType)?.[1]?.toLowerCase();
}

function createDecoder(label: string): TextDecoder {
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('utf-8');
  }
}

/**
 * Decodifica el cuerpo con el charset declarado en `Content-Type` o, para HTML, con el de
 * `<meta charset>` en los primeros bytes. Si no hay nada (o el charset es desconocido) usa UTF-8.
 * El proxy siempre responde en UTF-8, por lo que la conversión aquí es imprescindible para no
 * corromper páginas en latin1, windows-1252, etc.
 */
export function decodeText(bytes: Uint8Array, contentType: string | null, sniffHtmlMeta: boolean): string {
  let label = charsetFromContentType(contentType);
  if (label === undefined && sniffHtmlMeta) {
    const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
    label = META_CHARSET.exec(head)?.[1]?.toLowerCase();
  }
  return createDecoder(label ?? 'utf-8').decode(bytes);
}
