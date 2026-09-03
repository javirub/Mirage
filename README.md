# Mirage

Proxy web desplegable en Vercel. Recibe una URL, la pide al servidor origen y devuelve la página
con **todo el DOM reescrito** para que enlaces, imágenes, scripts, hojas de estilo, formularios,
redirecciones y cookies pasen por el propio proxy.

```
https://<tu-proxy>.vercel.app/https://ejemplo.com/ruta?query
                              └──────── URL real ────────┘
```

## Cómo funciona

**Servidor** (`src/proxy`, `src/rewrite`)

- Esquema de URL: la URL real va tal cual detrás de la primera barra. Todas las URLs reescritas son
  rutas absolutas del proxy (`/https://host/...`), y la petición se acepta también con una sola
  barra tras el esquema por si un intermediario colapsa `//`.
- HTML: se parsea con `parse5` y se reescriben `href`, `src`, `action`, `formaction`, `poster`,
  `srcset`/`imagesrcset`, `<object data>`, `xlink:href`, atributos `style`, bloques `<style>`,
  `<meta http-equiv="refresh">`, contenido de `<template>` y `<noscript>`. Se eliminan `<meta>` de
  CSP, `integrity` en `<link>` y `ping`. Al principio de `<head>` se inyectan `<meta charset>`,
  un `<base href>` con la base efectiva proxificada y el runtime cliente.
- CSS (ficheros, `<style>` y `style=""`): `url(...)` y `@import`.
- Cabeceras: se reescriben `Location`, `Content-Location`, `Refresh` y `Link`; se eliminan
  CSP, HSTS, `X-Frame-Options`, COOP/COEP/CORP, `Permissions-Policy`, `Clear-Site-Data`, etc.
  Hacia el origen se traducen `Referer` y `Origin` a las URLs reales y se descartan las cabeceras
  de infraestructura (`x-forwarded-*`, `x-vercel-*`).
- Cookies: cada `Set-Cookie` pierde `Domain` y recibe `Path=/https://host`, así el navegador solo
  la envía a peticiones de ese mismo origen. Los prefijos `__Host-`/`__Secure-` se renombran hacia
  el navegador y se restauran al reenviar.
- Codificación: el HTML se decodifica con el charset declarado (cabecera o `<meta>`) y se sirve
  siempre en UTF-8.
- Las redirecciones no se siguen en el servidor: se devuelven al navegador con `Location` ya
  proxificado. Todo lo que no es HTML/CSS se transmite en streaming sin tocarlo.
- Las respuestas HTML a `fetch`/XHR (`Sec-Fetch-Dest: empty`) se tratan como fragmentos: se
  reescriben sin envolver ni inyectar runtime.

**Cliente** (`src/rewrite/client-runtime.ts`, inyectado inline en cada documento)

Intercepta lo que la reescritura estática no puede ver: `fetch`, `XMLHttpRequest`, `sendBeacon`,
`Worker`/`SharedWorker`/`EventSource`, `history.pushState/replaceState`, `window.open`,
`postMessage` (targetOrigin), `setAttribute`, setters de `src`/`href`/`action`/`srcset`...,
`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`, `document.cookie` y un
`MutationObserver` como red de seguridad. Desactiva el registro de service workers.

**Rutas sin objetivo**: si llega `/api/x` con un `Referer` proxificado (típico de código que usa
`location.origin`), se responde `307` a la misma ruta dentro del origen real.

## Seguridad

- Anti-SSRF: se bloquean IPs privadas, loopback, link-local (metadatos cloud), CGNAT, multicast
  y nombres como `localhost`, `*.local`, `*.internal`. La comprobación se hace en la resolución
  DNS del conector de `undici`, de modo que la conexión solo puede abrirse contra la IP validada.
- El proxy no puede apuntarse a sí mismo.
- `MIRAGE_ALLOWED_HOSTS` permite restringir a una lista blanca de hosts.
- `robots.txt` bloquea la indexación.

Un proxy abierto en internet puede usarse para abusos: si lo despliegas público, restringe los
hosts o añade autenticación delante.

## Configuración (variables de entorno)

| Variable                        | Descripción                                                          | Por defecto |
| ------------------------------- | -------------------------------------------------------------------- | ----------- |
| `MIRAGE_ALLOWED_HOSTS`          | Hosts permitidos separados por comas (`ejemplo.com`, `*.ejemplo.com`) | todos       |
| `MIRAGE_ALLOW_PRIVATE_TARGETS`  | `1` para permitir redes privadas (solo desarrollo/tests)             | `0`         |
| `MIRAGE_UPSTREAM_TIMEOUT_MS`    | Timeout esperando cabeceras del origen                               | `20000`     |
| `MIRAGE_MAX_REWRITE_BYTES`      | Tamaño máximo de HTML/CSS que se reescribe en memoria                | `8388608`   |

## Desarrollo

Herramientas fijadas con [mise](https://mise.jdx.dev) (`mise.toml`: node 24, bun).

```
bun install
bun run dev          # servidor local con Node en http://localhost:3000
bun run typecheck
bun run test
```

También funciona `vc dev` (Vercel CLI), que ejecuta `src/index.ts` igual que en producción.

## Despliegue

Vercel detecta el proyecto como backend Hono a partir de `src/index.ts` (`export default app`),
sin `vercel.json` ni paso de build:

```
vc deploy
```

## Limitaciones conocidas

- WebSockets: las funciones de Vercel no los soportan; el runtime no los intercepta.
- Asignaciones a `location` (`location.href = '/x'`) no se pueden interceptar; el `307` por
  `Referer` cubre la mayoría de casos, pero no URLs absolutas a otros dominios.
- Cookies con `Domain` compartido entre subdominios quedan limitadas al origen exacto.
- Service workers desactivados; `importScripts` con rutas absolutas dentro de workers no se reescribe.
- Sitios con protección anti-bot (Cloudflare, DataDome...) pueden bloquear la IP del proxy.
