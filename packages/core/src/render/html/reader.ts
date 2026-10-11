/**
 * Reader tools for HTML exports: a Copy button on code, tables, math, canvases and tool output, collapsible turns and
 * branch sections, and a light/dark switch. One small inline script, allowed by its hash in the page's Content
 * Security Policy. The document reads fine without it: every turn starts expanded, and printing hides the buttons
 * and expands everything. Deterministic: the same text every time.
 *
 * @packageDocumentation
 */

/**
 * The script. Copies text, not HTML: the code itself, a table as tab-separated rows, math as its LaTeX source (`$…$`
 * inside text) when the MathML keeps it. A collapsed turn still shows its question, so the page reads as a list of questions.
 */
export const READER_SCRIPT = `(()=>{const d=document,r=d.documentElement;
const btn=(cls,label,title)=>{const b=d.createElement('button');b.type='button';b.className=cls;b.textContent=label;if(title)b.title=title;return b};
const plain=el=>{const c=el.cloneNode(true);c.querySelectorAll('.copy-btn,.fold-btn').forEach(x=>x.remove());c.querySelector(':scope>.label')?.remove();for(const k of c.querySelectorAll('.katex')){const tex=k.querySelector('annotation[encoding="application/x-tex"]');if(!tex)continue;const block=k.querySelector('math[display=block]');k.replaceWith(block?'$$'+tex.textContent.trim()+'$$':'$'+tex.textContent.trim()+'$')}c.style.cssText='position:fixed;left:-99999px;top:0;width:'+el.clientWidth+'px';d.body.appendChild(c);const t=c.innerText;c.remove();return t.trim()};
const text=el=>{if(el.classList.contains('katex')){const tex=el.querySelector('annotation[encoding="application/x-tex"]');if(tex)return tex.textContent.trim()}if(el.classList.contains('table-wrap')){const t=el.querySelector('table');return[...t.rows].map(row=>[...row.cells].map(plain).join('\\t')).join('\\n')}const p=el.classList.contains('code')&&el.querySelector('pre');if(p)return p.innerText.replace(/\\n$/,'');return plain(el)};
const copy=async s=>{try{await navigator.clipboard.writeText(s);return true}catch{const a=d.createElement('textarea');a.value=s;a.style.position='fixed';a.style.opacity='0';d.body.appendChild(a);a.select();const ok=d.execCommand('copy');a.remove();return ok}};
for(const el of d.querySelectorAll('.code,.table-wrap,.katex:has(>math[display=block]),.canvas')){const b=btn('copy-btn','Copy','Copy to the clipboard');b.addEventListener('click',async()=>{const ok=await copy(text(el));b.textContent=ok?'Copied':'Could not copy';b.classList.toggle('done',ok);setTimeout(()=>{b.textContent='Copy';b.classList.remove('done')},1600)});el.classList.add('has-copy');el.appendChild(b)}
const fold=(sec,label)=>{const b=btn('fold-btn','','Collapse or expand');const set=c=>{sec.classList.toggle('collapsed',c);b.setAttribute('aria-expanded',String(!c));b.textContent=c?'Show '+label:'Hide '+label};b.addEventListener('click',()=>set(!sec.classList.contains('collapsed')));sec.prepend(b);set(false);return set};
const sets=[];for(const s of d.querySelectorAll('section.turn'))sets.push(fold(s,'answer'));for(const s of d.querySelectorAll('section.branch'))sets.push(fold(s,'branch'));
const bar=d.createElement('div');bar.className='reader-bar';
const all=(c,l)=>{const b=btn('',l);b.addEventListener('click',()=>sets.forEach(f=>f(c)));bar.appendChild(b)};
if(sets.length){all(true,'Collapse all');all(false,'Expand all')}
const dark=()=>r.classList.contains('dark')||(!r.classList.contains('light')&&matchMedia('(prefers-color-scheme: dark)').matches);
const mode=btn('','','Switch between light and dark');const label=()=>{mode.textContent=dark()?'Light mode':'Dark mode'};
mode.addEventListener('click',()=>{const next=dark()?'light':'dark';r.classList.remove('light','dark');r.classList.add(next);label()});label();bar.appendChild(mode);
const h=d.querySelector('main>header');(h||d.querySelector('main')).appendChild(bar)})()`;

/** Styles for the reader tools. Part of every theme. */
export const READER_CSS = `
.has-copy{position:relative}
.katex.has-copy{display:block}
.copy-btn,.fold-btn,.reader-bar button{font:12px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--muted);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:.25rem .65rem;cursor:pointer}
.copy-btn:hover,.fold-btn:hover,.reader-bar button:hover{color:var(--accent);border-color:var(--accent)}
.copy-btn{position:absolute;top:.4rem;inset-inline-end:.4rem;opacity:0;transition:opacity .15s}
.has-copy:hover>.copy-btn,.copy-btn:focus-visible,.copy-btn.done{opacity:1}
.copy-btn.done{color:var(--accent);border-color:var(--accent)}
.code>.code-lang{padding-inline-end:5rem}
.reader-bar{display:flex;flex-wrap:wrap;gap:.4rem;margin:-1rem 0 2rem}
.fold-btn{float:inline-end;margin:0 0 .25rem .5rem}
section.turn.collapsed>.msg:not(.user),section.turn.collapsed>.same-as,section.branch.collapsed>:not(h2,.branch-name,.fold-btn){display:none}
section.turn.collapsed{opacity:.85}
@media print{.copy-btn,.fold-btn,.reader-bar{display:none!important}section.collapsed>*{display:revert!important}}
`;
