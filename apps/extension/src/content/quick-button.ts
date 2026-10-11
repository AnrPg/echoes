// The floating quick-action button on chatgpt.com chat and Project pages. Shadow DOM (closed), so ChatGPT's styles
// and ours never mix; it reads nothing from the page but its address. Its menu opens the export page on an action.
// The × hides it until the browser restarts; the export page switches it off or on for good.

import { QUICK_BUTTON_KEY, quickActionsFor, type QuickMessage, type QuickState } from '../background/quick';

const CSS = `
:host{all:initial}
.wrap{position:fixed;right:22px;bottom:96px;z-index:2147483646;font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.fab{position:relative;width:48px;height:48px;border-radius:16px;border:0;cursor:pointer;background:linear-gradient(120deg,#a6e6c4,#d4efcf 34%,#ffdcc6 68%,#ffb8bf);box-shadow:0 10px 26px -10px rgba(230,140,120,.7),0 2px 6px rgba(0,0,0,.15);transition:transform .2s cubic-bezier(.3,1.4,.5,1),box-shadow .2s;animation:in .45s cubic-bezier(.3,1.4,.5,1) both}
.fab:hover,.fab[aria-expanded=true]{transform:translateY(-2px) scale(1.05);box-shadow:0 16px 34px -12px rgba(240,150,130,.8),0 2px 6px rgba(0,0,0,.15)}
.fab:focus-visible,.menu button:focus-visible,.x:focus-visible{outline:2px solid #2f9a68;outline-offset:2px}
.fab::before,.fab::after{content:"";position:absolute;border-radius:50%;border:2px solid rgba(29,58,45,.85)}
.fab::before{inset:12px}.fab::after{inset:18px;animation:echo 3.2s ease-out infinite}
@keyframes echo{0%{transform:scale(.6);opacity:1}80%,100%{transform:scale(2.1);opacity:0}}
@keyframes in{from{opacity:0;transform:translateY(12px) scale(.8)}}
.x{position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:0;cursor:pointer;font:600 12px/20px system-ui,sans-serif;padding:0;color:#fff;background:#2a3530;box-shadow:0 2px 6px rgba(0,0,0,.3);opacity:0;transition:opacity .15s}
.anchor{position:relative}
.anchor:hover .x,.x:focus-visible{opacity:1}
.menu{min-width:230px;padding:6px;border-radius:16px;background:rgba(255,255,255,.92);backdrop-filter:blur(16px) saturate(1.4);border:1px solid rgba(30,60,45,.12);box-shadow:0 18px 50px -14px rgba(20,50,35,.4);color:#1c2420;animation:menu .2s ease both;transform-origin:bottom right}
@keyframes menu{from{opacity:0;transform:translateY(6px) scale(.97)}}
.menu .head{padding:8px 10px 6px;font:600 11px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#1f7a52}
.menu button{display:block;width:100%;text-align:left;padding:9px 10px;border:0;border-radius:10px;background:none;color:inherit;font:500 14px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
.menu button:hover{background:rgba(46,160,110,.12);color:#1f7a52}
.menu .hide{font-size:12px;font-weight:400;color:#66706b;border-top:1px solid rgba(30,60,45,.1);border-radius:0 0 10px 10px;margin-top:4px}
.toast{max-width:260px;padding:10px 12px;border-radius:12px;background:#1c2420;color:#eef3ef;box-shadow:0 10px 30px rgba(0,0,0,.3);animation:menu .2s ease both}
@media (prefers-color-scheme:dark){.menu{background:rgba(27,36,32,.92);border-color:rgba(210,240,225,.12);color:#eef3ef}.menu button:hover{background:rgba(147,226,187,.14);color:#93e2bb}.menu .head{color:#93e2bb}.menu .hide{color:#9caba3;border-color:rgba(210,240,225,.1)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

type Send = (m: QuickMessage) => Promise<QuickState | undefined>;

export function installQuickButton(send: Send = (m) => chrome.runtime.sendMessage(m) as Promise<QuickState | undefined>): void {
  let host: HTMLElement | undefined;
  let root: ShadowRoot | undefined;
  let closeMenu = () => {};
  let shown = false;
  let lastUrl = '';

  const remove = () => {
    host?.remove();
    host = undefined;
    root = undefined;
  };

  const render = () => {
    const actions = shown ? quickActionsFor(location.href) : [];
    if (actions.length === 0) return remove();
    if (!host) {
      host = document.createElement('echoes-quick');
      root = host.attachShadow({ mode: 'open' }); // open: lets the smoke test drive the menu; nothing in it is secret
      document.documentElement.appendChild(host);
    }
    root!.replaceChildren();
    const style = document.createElement('style');
    style.textContent = CSS;
    const wrap = el('div', 'wrap');
    const menu = el('div', 'menu');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.append(text(el('div', 'head'), 'Echoes'));
    for (const a of actions) {
      const b = text(el('button'), a.label);
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => {
        close();
        void send({ type: 'echoes:quick-open', scope: a.scope });
      });
      menu.append(b);
    }
    const hide = text(el('button', 'hide'), 'Hide this button until the browser restarts');
    hide.setAttribute('role', 'menuitem');
    hide.addEventListener('click', () => dismiss());
    menu.append(hide);

    const anchor = el('div', 'anchor');
    const fab = el('button', 'fab');
    fab.setAttribute('aria-label', 'Echoes: export');
    fab.setAttribute('aria-haspopup', 'menu');
    fab.setAttribute('aria-expanded', 'false');
    fab.title = 'Echoes: export';
    const x = text(el('button', 'x'), '×');
    x.setAttribute('aria-label', 'Hide the Echoes button until the browser restarts');
    x.title = 'Hide until the browser restarts';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
    const open = () => {
      menu.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
    };
    const close = () => {
      menu.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
    };
    fab.addEventListener('click', () => (menu.hidden ? open() : close()));
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        fab.focus();
      }
    });
    closeMenu = close;
    anchor.append(fab, x);
    wrap.append(menu, anchor);
    root!.append(style, wrap);
  };

  const dismiss = () => {
    void send({ type: 'echoes:quick-dismiss' });
    const wrap = root?.querySelector('.wrap');
    if (!wrap) return remove();
    wrap.replaceChildren(text(el('div', 'toast'), 'Echoes button hidden until the browser restarts. Switch it off for good on the Echoes page.'));
    setTimeout(remove, 4000);
    shown = false;
  };

  const refresh = async () => {
    const state = await send({ type: 'echoes:quick-state' }).catch(() => undefined);
    shown = state?.show === true;
    render();
  };

  // ChatGPT changes pages without reloading, so the address is checked now and then (it costs nothing).
  const watch = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    void refresh();
  };
  setInterval(watch, 1000);
  document.addEventListener('pointerdown', (e) => {
    if (host && !e.composedPath().includes(host)) closeMenu();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && QUICK_BUTTON_KEY in changes) void refresh();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function text<T extends HTMLElement>(e: T, t: string): T {
  e.textContent = t;
  return e;
}
