import { sha256Base64 } from './sha256.ts';

/**
 * Widget apps: a provider's interactive widget that is a small HTML page with its own scripts (ChatGPT's "app
 * blocks"). The HTML export runs it in a sandboxed `<iframe srcdoc>`: an opaque origin (no access to the export page,
 * cookies or storage), and the page's Content Security Policy, which the frame inherits, allows only the app's own
 * inline scripts by hash and no network at all. Deterministic: the same app gives the same frame and hashes.
 */

/** An app ready to embed: the frame document and every inline script in it (for the page's CSP hashes). */
export interface AppFrame {
  srcdoc: string;
  scripts: string[];
}

/** Reports the app's height to the export page so the frame fits it. Runs inside the frame. */
const CHILD_RESIZE = `(()=>{const s=()=>parent.postMessage({echoesAppHeight:Math.ceil(document.documentElement.getBoundingClientRect().height)},'*');new ResizeObserver(s).observe(document.documentElement);addEventListener('load',s);s()})()`;

/**
 * Sizes each app frame to the height it reports. Runs in the export page, only when it has apps. A frame the browser
 * has not laid out yet (off screen) reports about 0; that is ignored, so the frame keeps its default height.
 */
export const PARENT_RESIZE = `addEventListener('message',e=>{const h=e.data&&e.data.echoesAppHeight;if(typeof h!=='number'||h<40)return;for(const f of document.querySelectorAll('iframe.w-app'))if(f.contentWindow===e.source)f.style.height=Math.min(h,4000)+'px'})`;

/** CSP source for a script: `'sha256-…'`. */
export function scriptHash(script: string): string {
  return `'sha256-${sha256Base64(script)}'`;
}

/** The frame document for an app's HTML, with base styles, the utility classes it uses, and the resize helper. */
export function appFrame(html: string): AppFrame {
  const scripts = inlineScripts(html);
  scripts.push(CHILD_RESIZE);
  const srcdoc = [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<style>\n${APP_BASE_CSS}\n${utilityCss(html)}</style>`,
    `</head><body>\n${html}\n<script>${CHILD_RESIZE}</script>\n</body></html>`,
  ].join('\n');
  return { srcdoc, scripts };
}

/** The text of every inline `<script>` (no `src`), as the browser hashes it. */
function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1]!)) continue;
    out.push(m[2]!);
  }
  return out;
}

/** ChatGPT's widget colors (`--viz-*`, seen in a real app block), light and dark, and plain form controls. */
const APP_BASE_CSS = `
:root{--viz-text:#1f2328;--viz-muted:#6b7280;--viz-border:#d9dce1;--viz-card:#fff;--viz-panel:#f6f7f9;--viz-accent:#0b66d6;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--viz-text:#e8e8ea;--viz-muted:#9ca3af;--viz-border:#3a3d44;--viz-card:#24262b;--viz-panel:#1f2125;--viz-accent:#2f6fde}}
@media print{:root{--viz-text:#1f2328;--viz-muted:#6b7280;--viz-border:#d9dce1;--viz-card:#fff;--viz-panel:#f6f7f9;--viz-accent:#0b66d6}}
*,::before,::after{box-sizing:border-box;border:0 solid var(--viz-border)}
html{background:transparent}
body{margin:0;padding:2px;color:var(--viz-text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer;background:transparent}
pre{margin:0;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`.trim();

// A small subset of the Tailwind utility classes widget apps use, generated only for the classes an app has.

const SPACE = (v: string): string | undefined => {
  if (v === 'px') return '1px';
  const n = Number(v);
  return Number.isFinite(n) ? `${n * 0.25}rem` : undefined;
};
const TEXT: Record<string, string> = {
  xs: 'font-size:.75rem;line-height:1rem',
  sm: 'font-size:.875rem;line-height:1.25rem',
  base: 'font-size:1rem;line-height:1.5rem',
  lg: 'font-size:1.125rem;line-height:1.75rem',
  xl: 'font-size:1.25rem;line-height:1.75rem',
  '2xl': 'font-size:1.5rem;line-height:2rem',
  '3xl': 'font-size:1.875rem;line-height:2.25rem',
};
const RADIUS: Record<string, string> = { '': '.25rem', sm: '.125rem', md: '.375rem', lg: '.5rem', xl: '.75rem', '2xl': '1rem', full: '9999px', none: '0' };
const FIXED: Record<string, string> = {
  block: 'display:block',
  'inline-block': 'display:inline-block',
  inline: 'display:inline',
  flex: 'display:flex',
  'inline-flex': 'display:inline-flex',
  grid: 'display:grid',
  hidden: 'display:none',
  'flex-wrap': 'flex-wrap:wrap',
  'flex-col': 'flex-direction:column',
  'flex-row': 'flex-direction:row',
  'flex-1': 'flex:1 1 0%',
  'shrink-0': 'flex-shrink:0',
  'items-start': 'align-items:flex-start',
  'items-center': 'align-items:center',
  'items-end': 'align-items:flex-end',
  'items-baseline': 'align-items:baseline',
  'justify-start': 'justify-content:flex-start',
  'justify-center': 'justify-content:center',
  'justify-end': 'justify-content:flex-end',
  'justify-between': 'justify-content:space-between',
  'w-full': 'width:100%',
  'h-full': 'height:100%',
  'text-left': 'text-align:left',
  'text-center': 'text-align:center',
  'text-right': 'text-align:right',
  'text-white': 'color:#fff',
  'font-normal': 'font-weight:400',
  'font-medium': 'font-weight:500',
  'font-semibold': 'font-weight:600',
  'font-bold': 'font-weight:700',
  'whitespace-pre-wrap': 'white-space:pre-wrap',
  'whitespace-nowrap': 'white-space:nowrap',
  uppercase: 'text-transform:uppercase',
  'tabular-nums': 'font-variant-numeric:tabular-nums',
  truncate: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
  'overflow-auto': 'overflow:auto',
  'overflow-hidden': 'overflow:hidden',
  'cursor-pointer': 'cursor:pointer',
};
const BREAKPOINTS: Record<string, string> = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px' };

/** One utility's declarations (or, for `space-*`, a rule on children), without variants. */
function utility(name: string): { decl: string; children?: boolean } | undefined {
  if (FIXED[name]) return { decl: FIXED[name] };
  let m = /^(bg|text|border)-\[(.+)\]$/.exec(name);
  if (m) {
    const v = m[2]!.replace(/_/g, ' ');
    if (!/^(var\(--[\w-]+\)|#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/.test(v)) return undefined;
    return { decl: `${m[1] === 'bg' ? 'background-color' : m[1] === 'text' ? 'color' : 'border-color'}:${v}` };
  }
  m = /^text-(xs|sm|base|lg|xl|2xl|3xl)$/.exec(name);
  if (m) return { decl: TEXT[m[1]!]! };
  m = /^rounded(?:-(sm|md|lg|xl|2xl|full|none))?$/.exec(name);
  if (m) return { decl: `border-radius:${RADIUS[m[1] ?? '']}` };
  m = /^border(?:-(\d))?$/.exec(name);
  if (m) return { decl: `border-width:${m[1] ?? 1}px;border-style:solid` };
  m = /^grid-cols-(\d{1,2})$/.exec(name);
  if (m) return { decl: `grid-template-columns:repeat(${m[1]},minmax(0,1fr))` };
  m = /^col-span-(\d{1,2})$/.exec(name);
  if (m) return { decl: `grid-column:span ${m[1]} / span ${m[1]}` };
  m = /^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|min-h|h|w)-([\d.]+|px)$/.exec(name);
  if (m) {
    const v = SPACE(m[2]!);
    if (!v) return undefined;
    const props: Record<string, string[]> = {
      p: ['padding'], px: ['padding-left', 'padding-right'], py: ['padding-top', 'padding-bottom'], pt: ['padding-top'], pb: ['padding-bottom'],
      pl: ['padding-left'], pr: ['padding-right'], m: ['margin'], mx: ['margin-left', 'margin-right'], my: ['margin-top', 'margin-bottom'],
      mt: ['margin-top'], mb: ['margin-bottom'], ml: ['margin-left'], mr: ['margin-right'], gap: ['gap'], 'gap-x': ['column-gap'],
      'gap-y': ['row-gap'], 'min-h': ['min-height'], h: ['height'], w: ['width'],
    };
    return { decl: props[m[1]!]!.map((p) => `${p}:${v}`).join(';') };
  }
  m = /^space-(x|y)-([\d.]+)$/.exec(name);
  if (m) {
    const v = SPACE(m[2]!);
    return v ? { decl: `${m[1] === 'y' ? 'margin-top' : 'margin-left'}:${v}`, children: true } : undefined;
  }
  return undefined;
}

/** CSS for the utility classes in `html` that this subset knows; `sm:`-style prefixes become media queries. */
function utilityCss(html: string): string {
  const classes = new Set<string>();
  for (const m of html.matchAll(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) for (const c of (m[1] ?? m[2]!).split(/\s+/)) if (c) classes.add(c);
  const plain: string[] = [];
  const media = new Map<string, string[]>();
  for (const c of [...classes].sort()) {
    const parts = c.split(':');
    const name = parts.pop()!;
    if (parts.length > 1 || (parts.length === 1 && !BREAKPOINTS[parts[0]!])) continue; // hover:, focus:, dark: … are left out
    const u = utility(name);
    if (!u) continue;
    const sel = `.${cssEscape(c)}${u.children ? '>:not(:first-child)' : ''}`;
    const rule = `${sel}{${u.decl}}`;
    if (parts.length) {
      const bp = parts[0]!;
      media.set(bp, [...(media.get(bp) ?? []), rule]);
    } else plain.push(rule);
  }
  const out = [...plain];
  for (const bp of Object.keys(BREAKPOINTS)) {
    const rules = media.get(bp);
    if (rules) out.push(`@media (min-width:${BREAKPOINTS[bp]}){${rules.join('')}}`);
  }
  return out.map((r) => `${r}\n`).join('');
}

function cssEscape(s: string): string {
  return s.replace(/[^\w-]/g, (ch) => `\\${ch}`);
}
