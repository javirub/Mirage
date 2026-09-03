import { proxifyUrl } from './url.js';

const URL_FUNCTION = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s"']*))\s*\)/gi;
const IMPORT_STRING = /(@import\s+)(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gi;

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

/** Reescribe `url(...)` y `@import "..."` de una hoja de estilos o de un atributo `style`. */
export function rewriteCss(css: string, base: URL): string {
  const withUrls = css.replace(
    URL_FUNCTION,
    (match: string, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
      const original = doubleQuoted ?? singleQuoted ?? bare ?? '';
      const rewritten = proxifyUrl(original, base);
      return rewritten === original ? match : `url("${escapeCssString(rewritten)}")`;
    },
  );
  return withUrls.replace(
    IMPORT_STRING,
    (match: string, prefix: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
      const original = doubleQuoted ?? singleQuoted ?? '';
      const rewritten = proxifyUrl(original, base);
      return rewritten === original ? match : `${prefix}"${escapeCssString(rewritten)}"`;
    },
  );
}
