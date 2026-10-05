import { calculate } from 'specificity';
import type { StyleContext, StyleDeclaration, StyleSource } from './style-context.js';

type RuntimeRule = { style: CSSStyleDeclaration; selector: string; stylesheet: string; layer: string | null; order: number; sourceIndex: number; authoredSelector: string };
const probes = new WeakMap<Document, string>();
const inheritedProperties = new Set(('color cursor direction visibility font font-family font-size font-style font-weight font-stretch font-variant line-height letter-spacing word-spacing text-align text-indent text-transform text-shadow white-space word-break overflow-wrap hyphens tab-size list-style list-style-type list-style-position list-style-image border-collapse border-spacing caption-side empty-cells quotes writing-mode text-orientation fill stroke stroke-width').split(' '));

/** Ask the native cascade, in the original scopes/containers/layers, rather than
 * interpreting query expressions or approximating scope proximity in JavaScript.
 * Only a private, non-inherited property changes. Every CSSOM edit is restored
 * synchronously before returning; no DOM nodes/attributes or visual styles change.
 */
function runtimeOrder(win: Window, target: Element, rules: RuntimeRule[], important: boolean): RuntimeRule[] {
  const css = (win as Window & { CSS: typeof CSS }).CSS;
  let probe = probes.get(win.document);
  if (!probe) {
    probe = '--sitewall-inspection-' + crypto.randomUUID();
    css.registerProperty({ name: probe, syntax: '*', inherits: false, initialValue: 'sitewall-none' });
    probes.set(win.document, probe);
  }
  const saved = new Map<CSSStyleDeclaration, { value: string; priority: string }>();
  const tokens = new Map<string, RuntimeRule>();
  try {
    rules.forEach((rule, index) => {
      if (saved.has(rule.style)) return;
      saved.set(rule.style, { value: rule.style.getPropertyValue(probe!), priority: rule.style.getPropertyPriority(probe!) });
      const token = 'sitewall-rule-' + index;
      tokens.set(token, rule);
      rule.style.setProperty(probe!, token, important ? 'important' : '');
    });
    const ordered: RuntimeRule[] = [];
    while (tokens.size) {
      const token = win.getComputedStyle(target).getPropertyValue(probe).trim();
      const winner = tokens.get(token);
      if (!winner) break;
      ordered.push(winner);
      winner.style.removeProperty(probe);
      tokens.delete(token);
    }
    return ordered;
  } finally {
    for (const [style, original] of saved) {
      if (original.value) style.setProperty(probe, original.value, original.priority);
      else style.removeProperty(probe);
    }
  }
}

/** Actual values remain authoritative even where the browser withholds CSS rules. */
export function inspectRuntimeCascade(win: Window, selector?: string, ids: string[] = [], region?: { x: number; y: number; width: number; height: number }): StyleContext {
  const pageContext = !selector && !region;
  if (pageContext) selector = 'body';
  const result: StyleContext = { selector, stylesheets: [], cascade: [], unresolved: [], opaqueSources: [], rules: [] };
  const targets = selector ? win.document.querySelectorAll(selector) : [];
  if (targets.length > 1) throw new Error(`Selector is ambiguous: ${selector}`);
  const target = targets[0];
  if (selector && !target) throw new Error(`No element matches ${selector}`);
  const rules: RuntimeRule[] = [];
  let order = 0;
  const sourceIndices = new Map<string, number>();
  const nextIndex = (id: string) => { const index = sourceIndices.get(id) ?? 0; sourceIndices.set(id, index + 1); return index; };
  const opaque = (id: string, href: string | null, active: boolean) => {
    if (!result.opaqueSources.some(source => source.id === id)) result.opaqueSources.push({ id, href, active, kind: 'opaque-source' });
  };
  function walk(list: CSSRuleList, stylesheet: string, layer: string | null = null, parent?: string) {
    for (const rule of [...list]) {
      if (rule.type === 1) {
        const style = rule as CSSStyleRule;
        const text = parent ? style.selectorText.replaceAll('&', `:is(${parent})`) : style.selectorText;
        rules.push({ style: style.style, selector: text, stylesheet, layer, order: order++, sourceIndex: nextIndex(stylesheet), authoredSelector: style.selectorText });
        if (style.cssRules?.length) walk(style.cssRules, stylesheet, layer, text);
      } else if (rule.constructor.name === 'CSSNestedDeclarations') {
        rules.push({ style: (rule as CSSRule & { style: CSSStyleDeclaration }).style, selector: parent ?? ':scope', stylesheet, layer, order: order++, sourceIndex: -1, authoredSelector: parent ?? ':scope' });
      } else if (rule.type === 3) {
        const imported = rule as CSSImportRule;
        if (imported.media.mediaText && !win.matchMedia(imported.media.mediaText).matches) continue;
        if (imported.supportsText && !(win as Window & { CSS: typeof CSS }).CSS.supports(imported.supportsText)) continue;
        const importLayer = imported.layerName == null ? layer : [layer, imported.layerName || `anonymous-${order++}`].filter(Boolean).join('.');
        if (imported.styleSheet) { try { walk(imported.styleSheet.cssRules, imported.href, importLayer); } catch { opaque(imported.href, imported.href, !imported.styleSheet.disabled); } }
      } else if ('cssRules' in rule) {
        const nestedLayer = rule.constructor.name === 'CSSLayerBlockRule' ? [layer, (rule as CSSGroupingRule & { name: string }).name || `anonymous-${order++}`].filter(Boolean).join('.') : layer;
        walk((rule as CSSGroupingRule).cssRules, stylesheet, nestedLayer, parent);
      }
    }
  }
  const sheets = [...new Set([...win.document.styleSheets, ...win.document.adoptedStyleSheets])];
  for (const [index, sheet] of sheets.entries()) {
    const owner = sheet.ownerNode as Element | null;
    const source = owner?.getAttribute('data-sitewall-file') ?? owner?.getAttribute('data-vite-dev-id') ?? sheet.href ?? `inline-${index}`;
    let matches = ids.filter(id => source === id || source.split('?')[0].replaceAll('\\', '/').endsWith('/' + id.replaceAll('\\', '/')));
    if (!matches.length) matches = ids.filter(id => id.replaceAll('\\', '/').split('/').pop() === source.split('?')[0].replaceAll('\\', '/').split('/').pop());
    const id = matches.length === 1 ? matches[0] : source;
    const active = !sheet.disabled && (!sheet.media.mediaText || win.matchMedia(sheet.media.mediaText).matches);
    let accessible = true;
    try { const cssRules = sheet.cssRules; if (active) walk(cssRules, id); }
    catch { accessible = false; opaque(id, sheet.href, active); }
    result.stylesheets.push({ id, href: sheet.href, order: index, accessible });
  }
  if (region) {
    result.region = [];
    for (const el of [...win.document.body.querySelectorAll('*')]) {
      const rect = el.getBoundingClientRect(), x = rect.x + win.scrollX, y = rect.y + win.scrollY;
      if (!rect.width || !rect.height || x >= region.x + region.width || x + rect.width <= region.x || y >= region.y + region.height || y + rect.height <= region.y) continue;
      const path: string[] = []; let node: Element | null = el;
      while (node) { const parent: Element | null = node.parentElement; path.unshift(`${node.localName}:nth-child(${parent ? [...parent.children].indexOf(node) + 1 : 1})`); node = parent; }
      const context = inspectRuntimeCascade(win, path.join(' > '), ids);
      for (const rule of context.rules ?? []) if (!result.rules!.some(existing => existing.stylesheet === rule.stylesheet && existing.sourceIndex === rule.sourceIndex)) result.rules!.push(rule);
      result.region.push({ selector: path.join(' > '), cascade: context.cascade });
      if (result.region.length >= 30) { result.unresolved.push('Region style inspection is bounded to 30 intersecting elements.'); break; }
    }
  }
  if (!target) {
    result.rules?.sort((a, b) => {
      const score = (selector: string) => { try { const value = calculate(selector); return value.A * 1000000 + value.B * 1000 + value.C; } catch { return 0; } };
      return score(b.selector) - score(a.selector) || b.sourceIndex - a.sourceIndex;
    });
    return result;
  }
  const computed = win.getComputedStyle(target);
  const values = new Map([...computed].filter(property => property !== probes.get(win.document)).map(property => [property, computed.getPropertyValue(property)]));
  const candidates = new Map<string, StyleDeclaration[]>();
  const ranks = new Map<StyleDeclaration, { depth: number; normal: number; important: number }>();
  let ancestor: Element | null = target, depth = 0;
  while (ancestor) {
    const normal = runtimeOrder(win, ancestor, rules, false);
    const important = runtimeOrder(win, ancestor, normal, true);
    const add = (style: CSSStyleDeclaration, info: Omit<StyleDeclaration, 'property' | 'value' | 'important' | 'inherited'>, normalRank: number, importantRank: number) => {
      const properties = new Set([...style, ...values.keys()].filter(property => property !== probes.get(win.document) && style.getPropertyValue(property)));
      for (const property of properties) {
        const declaration: StyleDeclaration = { ...info, property, value: style.getPropertyValue(property), important: style.getPropertyPriority(property) === 'important', inherited: depth > 0 };
        ranks.set(declaration, { depth, normal: normalRank, important: importantRank });
        const list = candidates.get(property) ?? []; list.push(declaration); candidates.set(property, list);
      }
    };
    for (const [index, item] of normal.entries()) {
      if ((depth === 0 || [...item.style].some(property => property.startsWith('--') || inheritedProperties.has(property))) && item.sourceIndex >= 0 && !result.rules!.some(rule => rule.stylesheet === item.stylesheet && rule.sourceIndex === item.sourceIndex)) result.rules!.push({ stylesheet: item.stylesheet, sourceIndex: item.sourceIndex, selector: item.authoredSelector, cssText: `${item.authoredSelector} { ${item.style.cssText} }`, rank: index, inherited: depth > 0 });
      let specificity: [number, number, number] = [0, 0, 0];
      try { const score = calculate(item.selector); specificity = [score.A, score.B, score.C]; } catch { /* Runtime ranking handles selector lists, nesting and :scope directly. */ }
      add(item.style, { selector: item.selector, specificity, stylesheet: item.stylesheet, order: item.order, layer: item.layer, inline: false }, index, important.indexOf(item));
    }
    if ('style' in ancestor) add((ancestor as HTMLElement).style, { selector: '[inline style]', specificity: [0, 0, 0], stylesheet: 'inline attribute', order: Number.MAX_SAFE_INTEGER, layer: null, inline: true }, -1, -1);
    ancestor = ancestor.parentElement; depth++;
  }
  const compare = (a: StyleDeclaration, b: StyleDeclaration) => {
    const ar = ranks.get(a)!, br = ranks.get(b)!;
    return ar.depth - br.depth || Number(b.important) - Number(a.important) || Number(b.inline) - Number(a.inline) || (a.important ? ar.important - br.important : ar.normal - br.normal);
  };
  const opaqueIds = result.opaqueSources.filter(source => source.active).map(source => source.id);
  const properties = opaqueIds.length ? new Set([...values.keys(), ...candidates.keys()]) : new Set(candidates.keys());
  result.cascade = [...properties].map(property => {
    const declarations = (candidates.get(property) ?? []).sort(compare);
    const known = declarations.find(declaration => !declaration.inherited);
    let source: StyleSource;
    // CSSOM deliberately withholds cross-origin rules. Matching computed values
    // cannot prove which hidden declaration won (including same-value rules).
    // An inline !important declaration does outrank author stylesheet rules.
    if (known && (!opaqueIds.length || (known.inline && known.important))) source = { kind: 'known-declaration', declaration: known };
    else if (opaqueIds.length) source = { kind: 'opaque-cross-origin', stylesheets: opaqueIds, knownCandidate: known, attribution: 'not-readable' };
    else source = { kind: 'browser' };
    return { property, computed: values.get(property) ?? computed.getPropertyValue(property), declarations, source };
  });
  if (pageContext) {
    const matched = new Map<string, typeof rules[number]>();
    const precedence = new Map<string, Set<number>>();
    const key = (rule: RuntimeRule) => `${rule.stylesheet}:${rule.sourceIndex}`;
    for (const element of [win.document.body, ...win.document.body.querySelectorAll('*')]) {
      if (!element.getClientRects().length) continue;
      const ordered = runtimeOrder(win, element, rules, false).filter(rule => rule.sourceIndex >= 0);
      for (const [index, rule] of ordered.entries()) {
        matched.set(key(rule), rule);
        for (const weaker of ordered.slice(index + 1)) {
          for (const [pair, sign] of [[`${key(rule)}|${key(weaker)}`, -1], [`${key(weaker)}|${key(rule)}`, 1]] as const) {
            const signs = precedence.get(pair) ?? new Set<number>(); signs.add(sign); precedence.set(pair, signs);
          }
        }
      }
    }
    result.rules = [...matched.values()].sort((a, b) => {
      const signs = precedence.get(`${key(a)}|${key(b)}`);
      if (signs?.size === 1) return [...signs][0];
      const score = (rule: RuntimeRule) => { try { const value = calculate(rule.selector); return value.A * 1000000 + value.B * 1000 + value.C; } catch { return 0; } };
      return score(b) - score(a) || b.order - a.order;
    }).map((rule, rank) => ({ stylesheet: rule.stylesheet, sourceIndex: rule.sourceIndex, selector: rule.authoredSelector, cssText: `${rule.authoredSelector} { ${rule.style.cssText} }`, rank, inherited: false }));
  }
  return result;
}
