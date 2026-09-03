import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export interface PageOptions {
  readonly title: string;
  readonly body: HtmlEscapedString | Promise<HtmlEscapedString>;
}

const STYLES = `
  :root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: #f6f8fa; --card: #ffffff; --accent: #0969da; --border: #d0d7de; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --muted: #9198a1; --bg: #0d1117; --card: #161b22; --accent: #4493f8; --border: #30363d; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: min(40rem, calc(100vw - 2rem)); background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 2rem; }
  h1 { margin: 0 0 .25rem; font-size: 1.6rem; }
  p { margin: .5rem 0; color: var(--muted); }
  form { display: flex; gap: .5rem; margin-top: 1.25rem; }
  input { flex: 1; padding: .7rem .9rem; font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
  button { padding: .7rem 1.1rem; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; word-break: break-all; }
  .status { font-size: 3rem; font-weight: 700; margin: 0; }
  a { color: var(--accent); }
`;

export function renderPage(options: PageOptions): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${options.title}</title>
    <style>${STYLES}</style>
  </head>
  <body>
    <main>${options.body}</main>
  </body>
</html>
`;
}
