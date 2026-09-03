export interface SrcsetCandidate {
  readonly url: string;
  readonly descriptor: string;
}

function isWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f';
}

/**
 * Parser de `srcset` siguiendo el algoritmo de la especificación HTML: las URLs no pueden
 * contener espacios, y una coma pegada al final de la URL separa candidatos.
 */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  const length = value.length;
  let index = 0;
  while (index < length) {
    while (index < length && (isWhitespace(value[index]) || value[index] === ',')) index += 1;
    if (index >= length) break;

    const urlStart = index;
    while (index < length && !isWhitespace(value[index])) index += 1;
    let url = value.slice(urlStart, index);
    let descriptor = '';

    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      while (index < length && isWhitespace(value[index])) index += 1;
      const descriptorStart = index;
      let depth = 0;
      while (index < length) {
        const character = value[index];
        if (character === '(') depth += 1;
        else if (character === ')' && depth > 0) depth -= 1;
        else if (character === ',' && depth === 0) break;
        index += 1;
      }
      descriptor = value.slice(descriptorStart, index).trim();
    }
    if (url !== '') candidates.push({ url, descriptor });
  }
  return candidates;
}

export function rewriteSrcset(value: string, rewriteUrl: (url: string) => string): string {
  return parseSrcset(value)
    .map((candidate) => {
      const url = rewriteUrl(candidate.url);
      return candidate.descriptor === '' ? url : `${url} ${candidate.descriptor}`;
    })
    .join(', ');
}
