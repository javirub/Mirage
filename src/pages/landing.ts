import { html } from 'hono/html';

import { renderPage } from './layout.js';

export async function renderLandingPage(): Promise<string> {
  const body = html`
    <h1>Mirage</h1>
    <p>Introduce una URL y se abrirá a través del proxy, con todos sus enlaces y recursos reescritos.</p>
    <form id="go" action="/__mirage/go" method="get">
      <input name="url" type="text" placeholder="https://ejemplo.com" autocomplete="off" autofocus required />
      <button type="submit">Abrir</button>
    </form>
    <p>También puedes escribir la URL directamente tras la barra: <code>/https://ejemplo.com/ruta</code></p>
    <script>
      document.getElementById('go').addEventListener('submit', function (event) {
        var raw = this.elements.url.value.trim();
        if (!raw) return;
        event.preventDefault();
        var withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw;
        window.location.href = '/' + withScheme;
      });
    </script>
  `;
  return String(await renderPage({ title: 'Mirage', body }));
}
