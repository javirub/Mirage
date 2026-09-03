import { defaultTreeAdapter, parse, parseFragment, serialize, type DefaultTreeAdapterTypes as Tree } from 'parse5';

import { toProxyPath } from '../proxy/target.js';
import { buildRuntimeScript } from './client-runtime.js';
import { rewriteCss } from './css.js';
import { rewriteSrcset } from './srcset.js';
import { proxifyUrl, rewriteRefresh } from './url.js';

type Element = Tree.Element;
type Template = Tree.Template;
type ParentNode = Tree.ParentNode;
type ChildNode = Tree.ChildNode;

/** Atributos que contienen una única URL, independientemente del elemento. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'longdesc',
  'manifest',
  'codebase',
  'xlink:href',
]);
const SRCSET_ATTRIBUTES: ReadonlySet<string> = new Set(['srcset', 'imagesrcset']);
/** `ping` envía pings de seguimiento a URLs arbitrarias; se elimina en lugar de reescribirse. */
const REMOVED_ATTRIBUTES: ReadonlySet<string> = new Set(['ping']);

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

function isTextNode(node: ChildNode): node is Tree.TextNode {
  return node.nodeName === '#text';
}

function isTemplate(element: Element): element is Template {
  return element.tagName === 'template' && 'content' in element;
}

function getAttribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function removeAttributes(element: Element, predicate: (name: string) => boolean): void {
  if (element.attrs.some((attribute) => predicate(attribute.name))) {
    element.attrs = element.attrs.filter((attribute) => !predicate(attribute.name));
  }
}

function walk(parent: ParentNode, visit: (element: Element) => void): void {
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue;
    visit(child);
    walk(child, visit);
    if (isTemplate(child)) walk(child.content, visit);
  }
}

function findChildElement(parent: ParentNode, tagName: string): Element | undefined {
  for (const child of parent.childNodes) {
    if (isElement(child) && child.tagName === tagName) return child;
  }
  return undefined;
}

/** La base efectiva del documento es el primer `<base href>` (resuelto contra la URL del documento). */
function resolveEffectiveBase(root: ParentNode, documentUrl: URL): URL {
  let href: string | undefined;
  walk(root, (element) => {
    if (href === undefined && element.tagName === 'base') href = getAttribute(element, 'href');
  });
  if (href === undefined) return documentUrl;
  try {
    return new URL(href.trim(), documentUrl);
  } catch {
    return documentUrl;
  }
}

function rewriteMeta(element: Element, base: URL, removals: Element[]): void {
  const httpEquiv = getAttribute(element, 'http-equiv')?.trim().toLowerCase();
  // El proxy siempre responde en UTF-8 e inyecta su propio <meta charset>.
  if (getAttribute(element, 'charset') !== undefined || httpEquiv === 'content-type') {
    removals.push(element);
    return;
  }
  // Una CSP pensada para el origen real bloquearía los recursos servidos desde el proxy.
  if (httpEquiv === 'content-security-policy') {
    removals.push(element);
    return;
  }
  if (httpEquiv === 'refresh') {
    for (const attribute of element.attrs) {
      if (attribute.name === 'content') attribute.value = rewriteRefresh(attribute.value, base);
    }
  }
}

function rewriteElement(element: Element, base: URL, removals: Element[]): void {
  const tag = element.tagName;
  if (tag === 'meta') {
    rewriteMeta(element, base, removals);
    return;
  }
  if (tag === 'base') {
    // Se inyecta un <base> propio al principio de <head>; el original solo conserva `target`.
    removeAttributes(element, (name) => name === 'href');
    return;
  }
  if (tag === 'style') {
    for (const child of element.childNodes) {
      if (isTextNode(child)) child.value = rewriteCss(child.value, base);
    }
  }
  if (tag === 'link') {
    // Las hojas de estilo se reescriben, así que su hash de integridad ya no coincidiría.
    removeAttributes(element, (name) => name === 'integrity');
  }
  for (const attribute of element.attrs) {
    const name = attribute.name;
    if (URL_ATTRIBUTES.has(name) || (name === 'data' && tag === 'object')) {
      attribute.value = proxifyUrl(attribute.value, base);
    } else if (SRCSET_ATTRIBUTES.has(name)) {
      attribute.value = rewriteSrcset(attribute.value, (url) => proxifyUrl(url, base));
    } else if (name === 'style') {
      attribute.value = rewriteCss(attribute.value, base);
    }
  }
  removeAttributes(element, (name) => REMOVED_ATTRIBUTES.has(name));
}

function rewriteTree(root: ParentNode, base: URL): void {
  const removals: Element[] = [];
  walk(root, (element) => rewriteElement(element, base, removals));
  for (const element of removals) defaultTreeAdapter.detachNode(element);
}

/**
 * Inserta al principio de `<head>`, en este orden: `<meta charset>`, `<base href>` apuntando a la
 * versión proxificada de la base efectiva (así las URLs relativas construidas por JavaScript
 * también acaban en el proxy) y el runtime cliente.
 */
function injectHead(document: Tree.Document, documentUrl: URL, base: URL): void {
  const html = findChildElement(document, 'html');
  const head = html === undefined ? undefined : findChildElement(html, 'head');
  if (head === undefined) return;
  const namespace = head.namespaceURI;

  const script = defaultTreeAdapter.createElement('script', namespace, [{ name: 'data-mirage', value: 'runtime' }]);
  defaultTreeAdapter.insertText(script, buildRuntimeScript({ target: documentUrl.href }));

  const nodes: Element[] = [
    defaultTreeAdapter.createElement('meta', namespace, [{ name: 'charset', value: 'utf-8' }]),
    defaultTreeAdapter.createElement('base', namespace, [{ name: 'href', value: toProxyPath(base) }]),
    script,
  ];
  const first = head.childNodes[0];
  for (const node of nodes) {
    if (first === undefined) defaultTreeAdapter.appendChild(head, node);
    else defaultTreeAdapter.insertBefore(head, node, first);
  }
}

/** Reescribe un documento HTML completo e inyecta el runtime cliente. */
export function rewriteHtmlDocument(html: string, documentUrl: URL): string {
  const document = parse(html, { scriptingEnabled: false });
  const base = resolveEffectiveBase(document, documentUrl);
  rewriteTree(document, base);
  injectHead(document, documentUrl, base);
  return serialize(document);
}

/** Reescribe un fragmento HTML (respuestas a fetch/XHR) sin envolverlo en html/head/body ni inyectar nada. */
export function rewriteHtmlFragment(html: string, documentUrl: URL): string {
  const fragment = parseFragment(html, { scriptingEnabled: false });
  rewriteTree(fragment, documentUrl);
  return serialize(fragment);
}
