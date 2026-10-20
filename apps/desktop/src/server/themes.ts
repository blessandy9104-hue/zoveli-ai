/**
 * Interface themes: one default look plus user-chosen alternatives.
 *
 * - Built-in themes are pure CSS (offline, private, zero requests).
 * - The `unicorn` theme lazily loads the Unicorn Studio WebGL runtime from
 *   its CDN *only* when that theme is selected — never by default, so the
 *   default experience makes zero external requests.
 * - Lenis smooth scroll is served vendored from `/vendor/lenis.min.js`
 *   (same origin, pinned 1.3.26) and guarded: no Lenis global → native scroll.
 */

export interface ThemeDef {
  id: string;
  name: string;
  description: string;
  /** True when this theme needs the Unicorn Studio runtime (online). */
  unicorn: boolean;
  /** Native control + scrollbar scheme for the theme. */
  scheme: 'light' | 'dark';
  vars: Record<string, string>;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'daylight',
    name: 'Daylight',
    description: 'Classic light look (default)',
    unicorn: false,
    scheme: 'light',
    vars: {
      '--bg': '#ffffff',
      '--fg': '#111111',
      '--muted': '#444444',
      '--accent': '#1769dd',
      '--panel': '#f6f8fa',
      '--border': '#767676',
      '--badge-bg': '#e6f4ea',
      '--badge-fg': '#137333',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark mode',
    unicorn: false,
    scheme: 'dark',
    vars: {
      '--bg': '#0d1117',
      '--fg': '#e6edf3',
      '--muted': '#9aa4b2',
      '--accent': '#58a6ff',
      '--panel': '#161b22',
      '--border': '#6e7681',
      '--badge-bg': '#12261a',
      '--badge-fg': '#3fb950',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Deep green calm',
    unicorn: false,
    scheme: 'dark',
    vars: {
      '--bg': '#0f1f16',
      '--fg': '#e8f0e4',
      '--muted': '#a3b89a',
      '--accent': '#7bc96f',
      '--panel': '#16281c',
      '--border': '#6f8f76',
      '--badge-bg': '#12261a',
      '--badge-fg': '#7bc96f',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm ember dusk',
    unicorn: false,
    scheme: 'dark',
    vars: {
      '--bg': '#221310',
      '--fg': '#f5e6d8',
      '--muted': '#c4a48e',
      '--accent': '#ff9e5e',
      '--panel': '#2e1b14',
      '--border': '#9b6a51',
      '--badge-bg': '#2e1b14',
      '--badge-fg': '#ffb37e',
    },
  },
  {
    id: 'unicorn',
    name: 'Unicorn',
    description: 'Animated WebGL backdrop (needs network)',
    unicorn: true,
    scheme: 'light',
    vars: {
      '--bg': '#d6fffb',
      '--fg': '#0b1a6e',
      '--muted': '#3c4a8c',
      '--accent': '#00149f',
      '--panel': 'rgba(255,255,255,0.82)',
      '--border': '#5969c9',
      '--badge-bg': '#e6f4ea',
      '--badge-fg': '#137333',
    },
  },
];

export const DEFAULT_THEME = 'daylight';
export const THEME_STORAGE_KEY = 'zoveli-theme';

/** Pinned Unicorn Studio runtime (loaded lazily, unicorn theme only). */
export const UNICORN_SDK_URL =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.3.0/dist/unicornStudio.umd.js';

/**
 * Default scene: Fluted Gradient, a public example project published for
 * embedding (light hero/background). Override with your own published
 * project ID via `ZOVELI_UNICORN_PROJECT`.
 */
export const DEFAULT_UNICORN_PROJECT = 'oD2QBKj4GohsZCiJ4IWx';

export function unicornProjectId(): string {
  const custom = (process.env.ZOVELI_UNICORN_PROJECT || '').trim();
  return custom || DEFAULT_UNICORN_PROJECT;
}

export function themeById(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** Full stylesheet: variables per theme + Lenis + switcher + backdrop. */
export function themeCSS(): string {
  const blocks = THEMES.map(
    (t) =>
      `html[data-theme="${t.id}"]{${Object.entries(t.vars)
        .map(([k, v]) => `${k}:${v}`)
        .join(';')};color-scheme:${t.scheme}}`
  ).join('\n');
  return `${blocks}
/* Keyboard focus is always visible, regardless of theme. */
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* Visually hidden text for screen readers (labels, status, skip links). */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip-link{position:fixed;left:-9999px;top:8px;z-index:20;background:var(--panel);color:var(--fg);padding:.5rem .75rem;border:1px solid var(--border);border-radius:6px}
.skip-link:focus{left:8px}
/* Lenis recommended CSS (runtime served vendored, same origin) */
html.lenis,html.lenis body{height:auto}
.lenis.lenis-smooth{scroll-behavior:auto!important}
.lenis.lenis-smooth [data-lenis-prevent]{overscroll-behavior:contain}
.lenis.lenis-stopped{overflow:hidden}
.lenis.lenis-smooth iframe{pointer-events:none}
/* Unicorn backdrop: fixed canvas behind content, CSS fallback gradient */
#us-bg{position:fixed;inset:0;z-index:0;display:none;pointer-events:none}
html[data-theme="unicorn"] #us-bg{display:block}
html[data-theme="unicorn"] body{background:linear-gradient(135deg,#d6fffb,#c9d8ff 55%,#ffe3d6)}
html[data-theme="unicorn"] #us-bg canvas{width:100%;height:100%}
.themebar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 1rem}
.themebar button{font-size:.8rem;border:1px solid var(--border);border-radius:16px;background:var(--panel);color:var(--fg);cursor:pointer;padding:4px 12px}
.themebar button[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--accent);font-weight:600}
@media (prefers-reduced-motion: reduce){
  html{scroll-behavior:auto}
  .lenis.lenis-smooth{scroll-behavior:auto!important}
}`;
}

/** Theme switcher markup (localStorage-persisted, works offline). */
export function themeSwitcherHTML(): string {
  const buttons = THEMES.map(
    (t) =>
      `<button type="button" data-testid="theme-option-${t.id}" data-theme-id="${t.id}" title="${t.description}" aria-pressed="${t.id === DEFAULT_THEME ? 'true' : 'false'}">${t.name}</button>`
  ).join('');
  return `<div class="themebar" data-testid="theme-switcher" role="group" aria-label="Interface theme">${buttons}<span id="theme-status" class="sr-only" role="status"></span></div>`;
}

/** Runs before paint: applies the stored theme to avoid a flash. */
export function themeHeadScript(): string {
  return `<script>(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}')||'${DEFAULT_THEME}';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','${DEFAULT_THEME}');}})();</script>`;
}

/**
 * Body-end boot: switcher wiring, Lenis (guarded), lazy Unicorn runtime.
 * `unicornProject` is server-injected (env override or public default).
 */
export function themeBootScript(unicornProject: string): string {
  const safeProject = unicornProject.replace(/\\/g, '\\\\').replace(/"/g, '&quot;');
  return `<script>(function(){
function currentTheme(){return document.documentElement.getAttribute('data-theme')||'${DEFAULT_THEME}';}
function paintSwitcher(){var c=currentTheme();var active=null;document.querySelectorAll('[data-theme-id]').forEach(function(b){var on=b.getAttribute('data-theme-id')===c;b.setAttribute('aria-pressed',on?'true':'false');if(on)active=b;});var status=document.getElementById('theme-status');if(status){status.textContent='Theme: '+(active?active.textContent:c);}}
function prefersReducedMotion(){try{return window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}}
function loadUnicorn(){
  if(prefersReducedMotion()){document.documentElement.classList.add('us-fallback');return;}
  if(document.getElementById('us-sdk')||window.UnicornStudio){initUnicorn();return;}
  var s=document.createElement('script');s.id='us-sdk';s.async=true;
  s.src='${UNICORN_SDK_URL}';
  s.onload=initUnicorn;
  s.onerror=function(){document.documentElement.classList.add('us-fallback');};
  document.head.appendChild(s);
}
function initUnicorn(){
  try{
    var host=document.getElementById('us-bg');
    if(!host||!window.UnicornStudio)return;
    host.innerHTML='';
    var d=document.createElement('div');
    d.setAttribute('data-us-project',"${safeProject}");
    d.setAttribute('data-us-scale','1');d.setAttribute('data-us-dpi','1.5');d.setAttribute('data-us-lazyload','true');
    d.setAttribute('data-us-alttext','Animated interface backdrop');d.setAttribute('data-us-arialabel','Decorative animated background');
    d.style.cssText='width:100%;height:100%';
    host.appendChild(d);
    window.UnicornStudio.init().catch(function(){document.documentElement.classList.add('us-fallback');});
  }catch(e){document.documentElement.classList.add('us-fallback');}
}
function applyTheme(id){
  document.documentElement.setAttribute('data-theme',id);
  try{localStorage.setItem('${THEME_STORAGE_KEY}',id);}catch(e){}
  paintSwitcher();
  if(id==='unicorn'){loadUnicorn();}
}
function initLenis(){
  if(prefersReducedMotion()||!window.Lenis)return;
  try{new window.Lenis({autoRaf:true});}catch(e){}
}
document.querySelectorAll('[data-theme-id]').forEach(function(b){
  b.addEventListener('click',function(){applyTheme(b.getAttribute('data-theme-id'));});
});
paintSwitcher();
if(currentTheme()==='unicorn'){loadUnicorn();}
if(document.readyState==='loading'){window.addEventListener('DOMContentLoaded',initLenis,{once:true});}else{initLenis();}
})();</script>`;
}
