/**
 * Themes for the HTML renderer, as plain CSS. Each works in light and dark (following the reader's system unless the
 * document forces one) and has print rules, so the same file makes the PDF through the browser's print engine.
 *
 * @packageDocumentation
 */

import { WIDGET_CSS } from './widget.ts';

/** `chatgpt`: looks like the ChatGPT web app. `article`: a readable long-form page. `notes`: dense, for study notes. `print`: black on white, URLs written out. */
export type HtmlTheme = 'chatgpt' | 'article' | 'notes' | 'print';

export const HTML_THEMES: readonly HtmlTheme[] = ['chatgpt', 'article', 'notes', 'print'];

// System fonts that cover Greek, Cyrillic, Hebrew, Arabic, CJK and emoji on the common platforms.
const SANS = `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Hebrew", "Noto Sans Arabic", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;
const SERIF = `Charter, "Bitstream Charter", Georgia, Cambria, "Noto Serif", "Noto Serif Hebrew", "Noto Naskh Arabic", "Noto Serif CJK SC", "Songti SC", serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Noto Sans Mono", monospace`;

const LIGHT = `--bg:#fff;--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--soft:#f6f7f9;--accent:#0b66d6;--warn-bg:#fff8e6;--warn-line:#e7b416;--bubble:#f1f1f1`;
const DARK = `--bg:#1a1b1e;--fg:#e8e8ea;--muted:#9ca3af;--line:#33363d;--soft:#24262b;--accent:#6aa9ff;--warn-bg:#2d2615;--warn-line:#a37f12;--bubble:#2f3036`;

const BASE = `
:root{${LIGHT};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root:not(.light){${DARK}}}
:root.dark{${DARK}}
:root.light{color-scheme:light}:root.dark{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ${SANS};-webkit-text-size-adjust:100%}
main{max-width:48rem;margin:0 auto;padding:2rem 1rem 4rem}
a{color:var(--accent)}
h1{font-size:1.75rem;line-height:1.25;margin:0 0 .5rem}
.meta{color:var(--muted);font-size:.875rem;margin:0 0 2rem}
.meta span+span::before{content:" · "}
.turn{margin:2rem 0}
.turn>h2,.turn>h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 .5rem;font-weight:600}
.msg>.role{font-size:.95rem;margin:1rem 0 .25rem}
.msg .body>:first-child{margin-top:0}
.branch>h2{border-top:2px solid var(--line);padding-top:1rem;margin-top:3rem}
.version{color:var(--muted);font-style:italic;font-size:.875rem}
img{max-width:100%;height:auto}
.code{margin:1rem 0;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--soft)}
.code-lang{font:12px/1 ${SANS};color:var(--muted);padding:.4rem .75rem;border-bottom:1px solid var(--line)}
pre{margin:0;padding:.75rem;overflow-x:auto;font:13.5px/1.5 ${MONO};background:transparent!important}
code{font-family:${MONO};font-size:.9em}
:not(pre)>code{background:var(--soft);padding:.1em .3em;border-radius:4px}
.shiki,.shiki span{color:var(--shiki-light)}
@media (prefers-color-scheme:dark){:root:not(.light) .shiki,:root:not(.light) .shiki span{color:var(--shiki-dark)}}
:root.dark .shiki,:root.dark .shiki span{color:var(--shiki-dark)}
.table-wrap{overflow-x:auto;margin:1rem 0}
table{border-collapse:collapse}
th,td{border:1px solid var(--line);padding:.35rem .6rem;text-align:start;vertical-align:top}
blockquote{margin:1rem 0;padding:0 1rem;border-inline-start:3px solid var(--line);color:var(--muted)}
.katex-display{overflow-x:auto;overflow-y:hidden;margin:1rem 0}
math[display=block]{margin:.5rem 0}
details.reasoning{margin:1rem 0;border:1px solid var(--line);border-radius:6px;padding:.5rem .75rem;color:var(--muted)}
details.reasoning>summary{cursor:pointer;font-size:.875rem}
.note{margin:1rem 0;padding:.75rem 1rem;border-inline-start:4px solid var(--warn-line);background:var(--warn-bg);border-radius:4px}
.note>strong{display:block;margin-bottom:.25rem}
.note>p:first-child,.note>strong+p{margin-top:0}.note>:last-child{margin-bottom:0}
.label{font-weight:600}
.missing{color:var(--muted);font-style:italic}
.sources{font-size:.875rem}
.sources ol{margin:.25rem 0;padding-inline-start:1.5rem}
@media print{
  :root,:root.dark,:root:not(.light){${LIGHT};color-scheme:light}
  :root .shiki,:root .shiki span{color:var(--shiki-light)!important}
  body{font-size:11pt}
  main{max-width:none;padding:0}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:visible}
  .code.short,.note,figure,img,.katex-display,tr{break-inside:avoid}
  h1,h2,h3,h4,.role{break-after:avoid}
  .table-wrap{overflow:visible}
  table{font-size:.85em;max-width:100%}
  .katex-display{overflow:visible}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  details.reasoning::details-content{content-visibility:visible;height:auto}
  details.reasoning>summary{list-style:none}
}
@page{margin:16mm 14mm}
`;

const THEME: Record<HtmlTheme, string> = {
  chatgpt: `
main{max-width:48rem}
.turn>h2,.turn>h3{display:none}
.msg>.role{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.msg.user{display:flex;flex-direction:column;align-items:flex-end;margin:1.5rem 0}
.msg.user .body{background:var(--bubble);border-radius:1.5rem;padding:.6rem 1.1rem;max-width:80%}
.msg.user .body>:last-child{margin-bottom:0}
.msg.system .body{color:var(--muted);font-size:.9rem}
`,
  article: `
body{font-family:${SERIF};font-size:18px;line-height:1.7}
main{max-width:42rem}
h1{font-size:2.1rem}
.msg>.role{font:600 .8rem/1.2 ${SANS};text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.msg.user .body{font-weight:600}
code,pre{font-size:14px}
`,
  notes: `
body{font-size:14px;line-height:1.45}
main{max-width:56rem;padding:1rem}
h1{font-size:1.35rem}
.turn{margin:1rem 0;padding-top:.5rem;border-top:1px solid var(--line)}
.msg>.role{display:none}
.msg.user .body{font-weight:600;border-inline-start:3px solid var(--accent);padding-inline-start:.6rem}
.msg .body p{margin:.4rem 0}
pre{font-size:12px}
@media print{body{font-size:9.5pt}}
`,
  print: `
:root,:root.dark,:root:not(.light){${LIGHT};--accent:#000;color-scheme:light}
:root .shiki,:root .shiki span{color:var(--shiki-light)!important}
body{font-family:${SERIF}}
.code{background:#fff}
@media print{body{-webkit-print-color-adjust:economy;print-color-adjust:economy}}
@media print{a[href^="http"]::after{content:" (" attr(href) ")";font-size:.8em;color:#555;overflow-wrap:anywhere}}
`,
};

/** The full stylesheet for a theme. */
export function themeCss(theme: HtmlTheme): string {
  return (BASE + WIDGET_CSS + THEME[theme]).trim();
}
