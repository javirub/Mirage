import { html } from 'hono/html';

import { renderPage } from './layout.js';

export interface ErrorPageOptions {
  readonly status: number;
  readonly message: string;
  readonly detail: string | undefined;
  readonly target: string | undefined;
}

export async function renderErrorPage(options: ErrorPageOptions): Promise<string> {
  const body = html`
    <p class="status">${String(options.status)}</p>
    <h1>${options.message}</h1>
    ${options.detail === undefined ? '' : html`<p><code>${options.detail}</code></p>`}
    ${options.target === undefined ? '' : html`<p>URL solicitada: <code>${options.target}</code></p>`}
    <p><a href="/">Volver al inicio</a></p>
  `;
  return String(await renderPage({ title: `${String(options.status)} · Mirage`, body }));
}
