/**
 * Script que se inyecta al principio de cada documento HTML proxificado.
 *
 * La reescritura del servidor cubre todo lo que está en el HTML/CSS; este runtime cubre lo que
 * el JavaScript de la página construye en tiempo de ejecución: `fetch`, `XMLHttpRequest`,
 * `history.pushState`, asignaciones a `img.src`, `innerHTML`, `Worker`, cookies, etc.
 *
 * Se escribe como JavaScript plano (ES2017) dentro de una cadena porque debe ejecutarse en el
 * navegador antes que cualquier otro script y no pasa por el compilador del servidor.
 */
export interface RuntimeConfig {
  /** URL real del documento (sin proxificar). */
  readonly target: string;
}

const CLIENT_RUNTIME = String.raw`(function () {
  'use strict';
  if (window.__mirage) { return; }

  var config = __MIRAGE_CONFIG__;
  var proxyOrigin = window.location.origin;
  var TARGET_PATH = /^\/(https?):\/{1,2}(.+)$/i;
  var SCHEME = /^([a-z][a-z0-9+.-]*):/i;
  var URL_ATTRIBUTES = { src: 1, href: 1, action: 1, formaction: 1, poster: 1, background: 1, cite: 1 };
  var SRCSET_ATTRIBUTES = { srcset: 1, imagesrcset: 1 };
  var OBSERVED_ATTRIBUTES = ['src', 'href', 'action', 'formaction', 'poster', 'srcset', 'imagesrcset'];

  function currentTarget() {
    var match = TARGET_PATH.exec(window.location.pathname + window.location.search);
    return match ? match[1] + '://' + match[2] : config.target;
  }

  function isProxied(value) {
    return /^\/https?:\//i.test(value) || value.indexOf(proxyOrigin + '/http') === 0;
  }

  // Forma canónica del proxy: una sola barra tras el esquema (Vercel colapsa las dobles).
  function toProxyPath(href) {
    return '/' + href.replace(/^(https?):\/\//i, '$1:/');
  }

  function proxify(raw) {
    if (typeof raw !== 'string') { raw = String(raw); }
    var value = raw.trim();
    if (value === '' || value.charAt(0) === '#' || isProxied(value)) { return raw; }
    var scheme = SCHEME.exec(value);
    if (scheme) {
      var lower = scheme[1].toLowerCase();
      if (lower !== 'http' && lower !== 'https') { return raw; }
    }
    try {
      var absolute = new URL(value, currentTarget());
      if (absolute.origin === proxyOrigin) {
        // Código que usa location.origin + '/ruta': la ruta es relativa a la raíz del sitio real.
        absolute = new URL(absolute.pathname + absolute.search + absolute.hash, currentTarget());
      }
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') { return raw; }
      return proxyOrigin + toProxyPath(absolute.href);
    } catch (error) {
      return raw;
    }
  }

  function proxifySrcset(value) {
    return String(value).split(',').map(function (candidate) {
      var parts = candidate.trim().split(/\s+/);
      if (!parts[0]) { return candidate; }
      parts[0] = proxify(parts[0]);
      return parts.join(' ');
    }).join(', ');
  }

  var HTML_URL_ATTRIBUTE = /(\s(?:src|href|action|formaction|poster|srcset|imagesrcset)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
  function proxifyHtml(html) {
    return String(html).replace(HTML_URL_ATTRIBUTE, function (match, prefix, doubleQuoted, singleQuoted) {
      var value = doubleQuoted !== undefined ? doubleQuoted : singleQuoted;
      var quote = doubleQuoted !== undefined ? '"' : "'";
      var name = prefix.trim().split('=')[0].trim().toLowerCase();
      var rewritten = SRCSET_ATTRIBUTES[name] ? proxifySrcset(value) : proxify(value);
      return prefix + quote + rewritten + quote;
    });
  }

  function rewriteAttributeValue(element, name, value) {
    var key = String(name).toLowerCase();
    if (key === 'data') { return element.tagName === 'OBJECT' ? proxify(value) : value; }
    if (URL_ATTRIBUTES[key]) { return proxify(value); }
    if (SRCSET_ATTRIBUTES[key]) { return proxifySrcset(value); }
    return value;
  }

  function patchProperty(proto, property, transform) {
    if (!proto) { return; }
    var descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (!descriptor || typeof descriptor.set !== 'function') { return; }
    Object.defineProperty(proto, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) { descriptor.set.call(this, transform(value)); }
    });
  }

  function patchConstructor(name) {
    var Original = window[name];
    if (typeof Original !== 'function') { return; }
    var Patched = function (url, options) {
      return arguments.length > 1 ? new Original(proxify(String(url)), options) : new Original(proxify(String(url)));
    };
    Patched.prototype = Original.prototype;
    Object.setPrototypeOf(Patched, Original);
    window[name] = Patched;
  }

  // --- Atributos y propiedades del DOM -------------------------------------------------
  var originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    return originalSetAttribute.call(this, name, rewriteAttributeValue(this, name, value));
  };
  var originalSetAttributeNS = Element.prototype.setAttributeNS;
  Element.prototype.setAttributeNS = function (namespace, name, value) {
    var local = String(name).split(':').pop();
    return originalSetAttributeNS.call(this, namespace, name, rewriteAttributeValue(this, local, value));
  };

  var urlProperties = [
    ['HTMLImageElement', 'src'], ['HTMLScriptElement', 'src'], ['HTMLIFrameElement', 'src'],
    ['HTMLFrameElement', 'src'], ['HTMLEmbedElement', 'src'], ['HTMLSourceElement', 'src'],
    ['HTMLTrackElement', 'src'], ['HTMLMediaElement', 'src'], ['HTMLInputElement', 'src'],
    ['HTMLVideoElement', 'poster'], ['HTMLLinkElement', 'href'], ['HTMLAnchorElement', 'href'],
    ['HTMLAreaElement', 'href'], ['HTMLFormElement', 'action'], ['HTMLInputElement', 'formAction'],
    ['HTMLButtonElement', 'formAction'], ['HTMLObjectElement', 'data']
  ];
  urlProperties.forEach(function (entry) {
    var constructor = window[entry[0]];
    if (constructor) { patchProperty(constructor.prototype, entry[1], proxify); }
  });
  [['HTMLImageElement', 'srcset'], ['HTMLSourceElement', 'srcset']].forEach(function (entry) {
    var constructor = window[entry[0]];
    if (constructor) { patchProperty(constructor.prototype, entry[1], proxifySrcset); }
  });

  patchProperty(Element.prototype, 'innerHTML', proxifyHtml);
  patchProperty(Element.prototype, 'outerHTML', proxifyHtml);
  if (window.ShadowRoot) { patchProperty(ShadowRoot.prototype, 'innerHTML', proxifyHtml); }
  var originalInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (position, html) {
    return originalInsertAdjacentHTML.call(this, position, proxifyHtml(html));
  };
  ['write', 'writeln'].forEach(function (method) {
    var original = Document.prototype[method];
    if (typeof original !== 'function') { return; }
    Document.prototype[method] = function () {
      return original.apply(this, Array.prototype.map.call(arguments, proxifyHtml));
    };
  });

  // --- Red -------------------------------------------------------------------------------
  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string' || input instanceof URL) {
          input = proxify(String(input));
        } else if (input instanceof Request) {
          input = new Request(proxify(input.url), input);
        }
      } catch (error) { /* se envía tal cual */ }
      return originalFetch.call(this, input, init);
    };
  }
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = proxify(String(url));
    return originalOpen.apply(this, args);
  };
  if (navigator.sendBeacon) {
    var originalSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      return arguments.length > 1 ? originalSendBeacon.call(this, proxify(String(url)), data) : originalSendBeacon.call(this, proxify(String(url)));
    };
  }
  patchConstructor('Worker');
  patchConstructor('SharedWorker');
  patchConstructor('EventSource');
  if (window.ServiceWorkerContainer) {
    ServiceWorkerContainer.prototype.register = function () {
      return Promise.reject(new Error('Mirage: los service workers están desactivados en páginas proxificadas'));
    };
  }

  // --- Navegación ------------------------------------------------------------------------
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = History.prototype[method];
    History.prototype[method] = function (state, title, url) {
      if (url !== undefined && url !== null) { url = proxify(String(url)); }
      return original.call(this, state, title, url);
    };
  });
  var originalWindowOpen = window.open;
  window.open = function (url) {
    var args = Array.prototype.slice.call(arguments);
    if (url !== undefined && url !== null && url !== '') { args[0] = proxify(String(url)); }
    return originalWindowOpen.apply(window, args);
  };
  var originalPostMessage = Window.prototype.postMessage;
  if (typeof originalPostMessage === 'function') {
    Window.prototype.postMessage = function () {
      var args = Array.prototype.slice.call(arguments);
      var options = args[1];
      if (typeof options === 'string' && /^https?:\/\//i.test(options) && options !== proxyOrigin) {
        args[1] = proxyOrigin;
      } else if (options && typeof options === 'object' && typeof options.targetOrigin === 'string' && /^https?:\/\//i.test(options.targetOrigin)) {
        args[1] = Object.assign({}, options, { targetOrigin: proxyOrigin });
      }
      return originalPostMessage.apply(this, args);
    };
  }

  // --- Cookies -----------------------------------------------------------------------------
  function proxifyCookie(cookie) {
    var target = new URL(currentTarget());
    var prefix = '/' + target.protocol + '/' + target.host;
    var parts = String(cookie).split(';');
    var output = [parts[0]];
    var hasPath = false;
    for (var i = 1; i < parts.length; i++) {
      var part = parts[i].trim();
      var key = part.split('=')[0].trim().toLowerCase();
      if (key === 'domain') { continue; }
      if (key === 'path') {
        hasPath = true;
        var path = part.slice(part.indexOf('=') + 1).trim();
        output.push('path=' + (path === '/' || path === '' ? prefix : prefix + (path.charAt(0) === '/' ? path : '/' + path)));
        continue;
      }
      output.push(part);
    }
    if (!hasPath) { output.push('path=' + prefix); }
    return output.join('; ');
  }
  var cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (cookieDescriptor && typeof cookieDescriptor.set === 'function') {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: cookieDescriptor.enumerable,
      get: cookieDescriptor.get,
      set: function (value) { cookieDescriptor.set.call(this, proxifyCookie(value)); }
    });
  }

  // --- Red de seguridad: observar mutaciones del DOM -------------------------------------
  function fixElement(element) {
    if (!element || element.nodeType !== 1) { return; }
    for (var i = 0; i < OBSERVED_ATTRIBUTES.length; i++) {
      var name = OBSERVED_ATTRIBUTES[i];
      if (!element.hasAttribute(name)) { continue; }
      var value = element.getAttribute(name);
      var rewritten = rewriteAttributeValue(element, name, value);
      if (rewritten !== value) { originalSetAttribute.call(element, name, rewritten); }
    }
  }
  function fixTree(root) {
    fixElement(root);
    if (root.querySelectorAll) {
      var nodes = root.querySelectorAll('[src],[href],[action],[formaction],[poster],[srcset],[imagesrcset]');
      for (var i = 0; i < nodes.length; i++) { fixElement(nodes[i]); }
    }
  }
  if (window.MutationObserver) {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (record.type === 'attributes') {
          fixElement(record.target);
        } else {
          for (var j = 0; j < record.addedNodes.length; j++) { fixTree(record.addedNodes[j]); }
        }
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES
    });
  }

  window.__mirage = { version: 1, proxify: proxify, target: currentTarget };
})();`;

/** Devuelve el runtime con la configuración incrustada, listo para un `<script>` inline. */
export function buildRuntimeScript(config: RuntimeConfig): string {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return CLIENT_RUNTIME.replace('__MIRAGE_CONFIG__', json);
}
