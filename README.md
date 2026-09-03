# Mirage

A web proxy deployable on Vercel. It fetches a URL from the origin server and returns the page with
**the whole DOM rewritten**, so links, images, scripts, stylesheets, forms, redirects and cookies all
go through the proxy itself.

```
https://<your-proxy>.vercel.app/https:/example.com/path?query
                                └───────── real URL ─────────┘
```

## Usage: browsing and searching a site through the proxy

There is a single rule: **put the full URL of the site after the proxy's slash**. Everything that
follows (path, `?query`, `#fragment`) is passed to the target site untouched.

```
https://<your-proxy>/https:/www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=platform%20architect
        └── proxy ──┘└──────────────────── real URL, with its own query string ─────────────────┘
```

The canonical form has a **single slash after the scheme** (`/https:/host/...`): Vercel collapses
double slashes in the path with a `308` redirect, so that is what the proxy generates. Typing
`/https://host/...` or even just `/host/...` (https is assumed) also works: both are redirected to
the canonical form.

### From the browser

1. Open the proxy's landing page (`/`), type the URL (`example.com` works, `https://` is added) and
   press **Open**. That is the same as typing `/https://example.com/` in the address bar.
2. Once inside, browse normally: links, menus, pagination and the site's own search box already
   point at the proxy. A search form (`<form method="get" action="/search">`) lands on
   `/https://example.com/search?q=...`; a `POST` form (login, filters) is forwarded with its body,
   its cookies and with `Origin`/`Referer` translated to the real domain.
3. To search directly, build the site's search URL and prefix it with the proxy. Examples:

```
/https:/www.google.com/search?q=hono+vercel
/https:/duckduckgo.com/?q=web+proxy
/https:/www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=AI%20solution%20architect&sortBy=RELEVANCE
/https:/en.wikipedia.org/w/index.php?search=Vercel
```

Spaces go as `%20` or `+`, whatever the site expects; the proxy never rewrites query values. The
`#fragment` never reaches the server, so it behaves exactly as on the original site.

### From the terminal or a script

Same thing with `curl`. Quote the URL (it contains `?`, `&` and `//`) and send a browser
`User-Agent` if the site requires one:

```bash
PROXY=http://localhost:3000   # or https://<your-proxy>.vercel.app

curl -s "$PROXY/https:/www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=platform%20architect&sortBy=RELEVANCE" \
  -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36' \
  -H 'Accept-Language: es-ES,es;q=0.9' \
  -o results.html
```

- Without a `Sec-Fetch-Dest` header the response is treated as a full document: rewritten HTML with
  the injected `<base>` and client runtime. Add `-H 'Sec-Fetch-Dest: empty'` to get only the
  rewritten fragment (useful for HTMX/Turbo-style HTML endpoints).
- URLs in the returned HTML are proxy paths (`/https:/host/...`); strip the leading slash and
  restore the `//` after the scheme to get the real URL back.
- `POST`: `curl -X POST "$PROXY/https:/example.com/api/search" -H 'Content-Type: application/json' -d '{"q":"x"}'`.
- Redirects (`3xx`) come back with an already-proxied `Location`; use `-L` to follow them.

From JavaScript (Node, a worker, a browser extension...) it is a plain `fetch`:

```ts
const proxy = 'https://<your-proxy>.vercel.app';
const target = new URL('https://www.infojobs.net/jobsearch/search-results/list.xhtml');
target.searchParams.set('keyword', 'AI solution architect');
target.searchParams.set('sortBy', 'RELEVANCE');

const response = await fetch(`${proxy}/${target.href.replace('://', ':/')}`, {
  headers: { 'user-agent': 'Mozilla/5.0 ...', 'accept-language': 'es-ES,es;q=0.9' },
});
const html = await response.text();
```

### Worked example: InfoJobs offers

InfoJobs' results page server-renders only the first few cards; the full list travels in
`window.__INITIAL_PROPS__ = JSON.parse("...")`. Steps:

1. Request the search through the proxy (see the `curl` example above).
2. Find `window.__INITIAL_PROPS__`, extract the string literal inside `JSON.parse("...")`, decode it
   (`JSON.parse('"' + literal + '"')`) and parse the result.
3. Read `props.offers`: each offer carries `title`, `companyName`, `city`, `contractType`, `workday`,
   `teleworking`, `salary`, `publishedAt` and `link` (protocol-relative, `//www.infojobs.net/...`).

Tips: vary the keywords (on InfoJobs "arquitecto plataforma" returns building architects, while
"AI solution architect" or "arquitecto soluciones IA" return technical profiles), and keep in mind
that sites with anti-bot protection may answer differently to the proxy's IP than to your browser.

## How it works

**Server** (`src/proxy`, `src/rewrite`)

- URL scheme: the real URL goes after the first slash, with a single slash after its scheme
  (`/https:/host/...`, because Vercel collapses `//` in paths). Every rewritten URL is an absolute
  proxy path in that form; the double-slash form is accepted on input too.
- HTML: parsed with `parse5`; rewrites `href`, `src`, `action`, `formaction`, `poster`,
  `srcset`/`imagesrcset`, `<object data>`, `xlink:href`, `style` attributes, `<style>` blocks,
  `<meta http-equiv="refresh">`, `<template>` and `<noscript>` content. Removes CSP `<meta>` tags,
  `integrity` on `<link>` and `ping`. Injects `<meta charset>`, a `<base href>` pointing at the
  proxied effective base, and the client runtime at the top of `<head>`.
- CSS (files, `<style>` and `style=""`): `url(...)` and `@import`.
- Headers: rewrites `Location`, `Content-Location`, `Refresh` and `Link`; drops CSP, HSTS,
  `X-Frame-Options`, COOP/COEP/CORP, `Permissions-Policy`, `Clear-Site-Data`, etc. Towards the
  origin, `Referer` and `Origin` are translated to the real URLs and infrastructure headers
  (`x-forwarded-*`, `x-vercel-*`) are dropped.
- Cookies: every `Set-Cookie` loses `Domain` and gets `Path=/https:/host`, so the browser only
  sends it with requests for that same origin. `__Host-`/`__Secure-` prefixes are renamed towards
  the browser and restored when forwarding.
- Encoding: HTML is decoded with the declared charset (header or `<meta>`) and always served as
  UTF-8.
- Redirects are not followed server-side: they go back to the browser with an already-proxied
  `Location`. Anything that is not HTML/CSS is streamed through untouched.
- HTML responses to `fetch`/XHR (`Sec-Fetch-Dest: empty`) are treated as fragments: rewritten
  without wrapping or runtime injection.

**Client** (`src/rewrite/client-runtime.ts`, injected inline into every document)

Intercepts what static rewriting cannot see: `fetch`, `XMLHttpRequest`, `sendBeacon`,
`Worker`/`SharedWorker`/`EventSource`, `history.pushState/replaceState`, `window.open`,
`postMessage` (targetOrigin), `setAttribute`, `src`/`href`/`action`/`srcset` setters,
`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`, `document.cookie`, plus a
`MutationObserver` safety net. Service worker registration is disabled.

**Untargeted paths**: if `/api/x` arrives with a proxied `Referer` (typical of code that uses
`location.origin`), the proxy answers `307` to the same path inside the real origin.

## Security

- Anti-SSRF: private, loopback, link-local (cloud metadata), CGNAT and multicast ranges are
  blocked, along with names such as `localhost`, `*.local`, `*.internal`. The check runs inside the
  DNS lookup of the `undici` connector, so the connection can only be opened to the validated IP.
- The proxy cannot target itself.
- `MIRAGE_ALLOWED_HOSTS` restricts targets to an allowlist.
- `robots.txt` disallows indexing.

An open proxy on the internet can be abused: if you deploy it publicly, restrict the hosts or put
authentication in front of it.

## Configuration (environment variables)

| Variable                       | Description                                                        | Default   |
| ------------------------------ | ------------------------------------------------------------------ | --------- |
| `MIRAGE_ALLOWED_HOSTS`         | Comma-separated allowed hosts (`example.com`, `*.example.com`)     | all       |
| `MIRAGE_ALLOW_PRIVATE_TARGETS` | `1` to allow private networks (development/tests only)             | `0`       |
| `MIRAGE_UPSTREAM_TIMEOUT_MS`   | Timeout waiting for the origin's response headers                  | `20000`   |
| `MIRAGE_MAX_REWRITE_BYTES`     | Maximum HTML/CSS size rewritten in memory                          | `8388608` |

## Development

Tools are pinned with [mise](https://mise.jdx.dev) (`mise.toml`: node 24, bun).

```
bun install
bun run dev          # local server on Node at http://localhost:3000
bun run typecheck
bun run test
```

`vc dev` (Vercel CLI) also works and runs `src/index.ts` the same way production does.

## Deployment on Vercel

Vercel detects the project as a **Hono backend** from `src/index.ts` (`export default app`). No
`vercel.json` and no build step are needed. Keep the other candidate entrypoint names free
(`app.ts`, `server.ts`, `main.ts`, `src/app.ts`...): Vercel picks the first one it finds and requires
it to export the app. Project settings:

| Setting              | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| Framework Preset     | **Hono** (auto-detected: `hono` dependency plus an entrypoint that imports it)     |
| Build Command        | **None** (preset default). Vercel compiles and bundles the TypeScript entrypoint    |
| Output Directory     | **N/A** (preset default, there is no static output)                                |
| Install Command      | default. Vercel detects `bun.lock` and runs `bun install`                          |
| Development Command  | **None** (preset default: `vercel dev` runs the entrypoint). Locally: `bun run dev` |
| Root Directory       | repository root                                                                    |
| Node.js Version      | 22.x or 24.x                                                                       |

Deploy with:

```
vc deploy          # preview
vc deploy --prod   # production
```

Set the environment variables above in the project settings if you need them.

## Known limitations

- WebSockets are not proxied yet. Vercel Functions support them (public beta, requires Fluid
  compute), but Mirage does not handle `Upgrade` requests and the client runtime does not
  intercept `WebSocket`; pages fall back to whatever polling the site offers.
- Assignments to `location` (`location.href = '/x'`) cannot be intercepted; the `307` fallback via
  `Referer` covers most cases, but not absolute URLs to other domains.
- Cookies with a `Domain` shared across subdomains are limited to the exact origin.
- Service workers are disabled; `importScripts` with absolute paths inside workers is not rewritten.
- Sites with anti-bot protection (Cloudflare, DataDome...) may block the proxy's IP.
