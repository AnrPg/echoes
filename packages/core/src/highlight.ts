import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';
import type { Conversation } from './model/schema.ts';
import type { CodeHighlighter } from './render/html/markdown.ts';

/**
 * Syntax highlighting for the HTML renderer, with Shiki (VS Code's grammars). A separate entry point,
 * `@echoes/core/highlight`, so hosts that never highlight do not load it. Uses Shiki's JavaScript regex engine:
 * no WebAssembly, so it runs in an extension page under MV3's content security policy.
 *
 * @packageDocumentation
 */

type Grammar = () => Promise<{ default: LanguageRegistration[] }>;

/**
 * The grammars loaded by default: the languages chats use most. Each is a separate dynamic import, so a bundler
 * ships only these. To support every language Shiki has, pass `grammars: bundledLanguages` from `shiki/langs`.
 */
export const COMMON_GRAMMARS: Record<string, Grammar> = {
  bash: () => import('shiki/langs/bash.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  latex: () => import('shiki/langs/latex.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

/** Common names for the default grammars, as people write them after a code fence. */
const ALIASES: Record<string, string> = {
  sh: 'shellscript', shell: 'shellscript', zsh: 'shellscript', console: 'shellscript', 'c++': 'cpp', 'c#': 'csharp',
  cs: 'csharp', docker: 'dockerfile', golang: 'go', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  kt: 'kotlin', tex: 'latex', md: 'markdown', py: 'python', python3: 'python', rb: 'ruby', rs: 'rust',
  ts: 'typescript', mts: 'typescript', yml: 'yaml', svg: 'xml',
};

/**
 * The code languages a chat uses, from code blocks and fenced code inside Markdown text. Pass them to
 * {@link createShikiHighlighter} to load only what an export needs.
 */
export function codeLanguages(conversations: Iterable<Conversation>): string[] {
  const langs = new Set<string>();
  for (const c of conversations) {
    for (const node of Object.values(c.nodes)) {
      for (const b of node.blocks) {
        if (b.kind === 'code' && b.lang) langs.add(b.lang.toLowerCase());
        if (b.kind === 'markdown' || b.kind === 'canvas') {
          for (const m of b.text.matchAll(/^ {0,3}(?:`{3,}|~{3,})\s*([\w+#.-]+)/gm)) langs.add(m[1]!.toLowerCase());
        }
      }
    }
  }
  return [...langs].sort();
}

/**
 * A {@link CodeHighlighter} with light and dark colors (the theme CSS picks one). Unknown languages are ignored and
 * their code stays plain.
 *
 * @example
 * ```ts
 * import { codeLanguages, createShikiHighlighter } from '@echoes/core/highlight';
 * const highlight = await createShikiHighlighter({ langs: codeLanguages([conversation]) });
 * // Every language Shiki knows: createShikiHighlighter({ grammars: bundledLanguages }) with `shiki/langs`.
 * renderHtml(conversation, { highlight });
 * ```
 */
export async function createShikiHighlighter(options: { langs?: readonly string[]; grammars?: Record<string, Grammar> } = {}): Promise<CodeHighlighter> {
  const grammars = options.grammars ?? COMMON_GRAMMARS;
  const resolve = (lang: string): string | undefined => {
    const l = lang.toLowerCase();
    const id = grammars === COMMON_GRAMMARS ? (ALIASES[l] ?? l) : l;
    return Object.hasOwn(grammars, id) ? id : undefined;
  };
  const wanted = new Set((options.langs ?? Object.keys(grammars)).map(resolve).filter((l) => l !== undefined));
  const highlighter: HighlighterCore = await createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [...wanted].map((l) => grammars[l]!),
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  const loaded = new Set(highlighter.getLoadedLanguages());
  return (code, lang) => {
    const id = lang ? resolve(lang) : undefined;
    if (!id || !loaded.has(id)) return undefined;
    return highlighter.codeToHtml(code, { lang: id, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
  };
}
