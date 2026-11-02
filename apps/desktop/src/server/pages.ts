import {
  themeCSS,
  themeSwitcherHTML,
  themeHeadScript,
  themeBootScript,
  unicornProjectId,
} from './themes.js';
import type { OnboardingMarkup } from './onboarding.js';

let loginPageCache: string | null = null;

export function renderHomePage(onboarding: OnboardingMarkup): string {
  return `<!doctype html>
<html lang="en" data-theme="daylight" data-testid="app-root">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Zoveli AI — local-first assistant</title>
${themeHeadScript()}
<style>
  ${themeCSS()}
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; background: var(--bg); color: var(--fg); position: relative; z-index: 1; }
  h1 { font-size: clamp(1.75rem, 5vw, 2.5rem); }
  #log { border: 1px solid var(--border); border-radius: 8px; min-height: 240px; padding: 1rem; margin-bottom: 1rem; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--panel); }
  #log > div { margin: 0 0 .5rem; }
  #log > div:last-child { margin-bottom: 0; }
  #log a { overflow-wrap: anywhere; }
  .badge { display: inline-block; font-size: 0.75rem; background: var(--badge-bg); color: var(--badge-fg); border-radius: 4px; padding: 0 6px; margin-left: 8px; }
  .msg-meta { font-size: 0.75rem; opacity: .8; margin-top: 2px; }
  form { display: flex; flex-wrap: wrap; gap: 8px; }
  #composer input { flex: 1 1 16rem; min-width: 0; }
  input { padding: 8px; background: var(--panel); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; font: inherit; }
  button { padding: 8px 16px; font: inherit; cursor: pointer; }
  button:disabled { cursor: progress; opacity: .7; }
  #starters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 1rem; }
  #starters button { font-size: 0.85rem; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); color: var(--fg); }
  #tools { font-size: 0.85rem; color: var(--muted); }
  #tools ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .onboard-status { font-size: .85rem; color: var(--muted); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: .5rem .75rem; }
  .onboard-status a { color: var(--accent); }
  .setup { border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin: 0 0 1rem; background: var(--panel); }
  .setup h2 { font-size: 1.1rem; margin-top: 0; }
  .setup ul { margin: .5rem 0; padding-left: 1.25rem; }
  .setup li { margin-bottom: .5rem; }
  .setup code { font-size: .9em; overflow-wrap: anywhere; }
  a { color: var(--accent); }
  @media (max-width: 480px) { body { margin: 1rem auto; padding: 0 .75rem; } }
</style>
</head>
<body>
<div id="us-bg" aria-hidden="true"></div>
<a class="skip-link" href="#main">Skip to chat</a>
<header>
<h1>Zoveli AI</h1>
<p>Local-first assistant. Math is verified by mathcore; local tools run on your machine. Optional account: <a href="/login" data-testid="login-link">log in / sign up</a> with any email address, including @proton.me, to receive a one-time code. No account is needed for local tools.</p>
<p>No account needed for local tools. Math answers carry a <span class="badge">VERIFIED</span> badge — anything unverified is withheld, never guessed.</p>
${onboarding.status}
</header>
<main id="main" tabindex="-1">
${onboarding.panel}
<h2 class="sr-only">Conversation</h2>
<div id="starters" data-testid="suggestion-chips" role="group" aria-label="Example questions">
  <button type="button" data-testid="suggestion-chip" data-q="2+2">2+2</button>
  <button type="button" data-testid="suggestion-chip" data-q="(3+4)*5">(3+4)*5</button>
  <button type="button" data-testid="suggestion-chip" data-q="10!">10!</button>
</div>
<div id="log" data-testid="chat-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation" aria-busy="false"></div>
<div><button type="button" data-testid="chat-clear" id="clear-chats" style="font-size:.8rem;margin-bottom:1rem">Clear chats (stored in this browser only)</button></div>
<form id="composer">
  <label class="sr-only" for="chat-input">Message</label>
  <input id="chat-input" data-testid="chat-input" type="text" name="message" maxlength="50000" enterkeyhint="send" aria-describedby="chat-hint" placeholder="Ask anything — try: 2+2 (verified offline)" autocomplete="off" />
  <button type="submit" id="send-button" data-testid="send-button">Send</button>
</form>
<p id="chat-hint" class="sr-only">Replies appear in the conversation log above.</p>
<p id="chat-status" class="sr-only" role="status"></p>
<section aria-labelledby="tools-heading">
<h2 id="tools-heading">Tools</h2>
<div id="tools" data-testid="tools-list" aria-busy="true">loading…</div>
</section>
${themeSwitcherHTML()}
</main>
<script src="/vendor/lenis.min.js" defer></script>
${themeBootScript(unicornProjectId())}
<script>
const log = document.getElementById('log');
const form = document.getElementById('composer');
const input = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const chatStatus = document.getElementById('chat-status');
const toolsEl = document.getElementById('tools');
let sending = false;
function setSending(on) {
  sending = on;
  sendButton.disabled = on;
  sendButton.textContent = on ? 'Sending…' : 'Send';
  log.setAttribute('aria-busy', on ? 'true' : 'false');
}
document.querySelectorAll('[data-testid="suggestion-chip"]').forEach((chip) => {
  chip.addEventListener('click', () => {
    if (sending) return;
    input.value = chip.getAttribute('data-q') || '';
    form.requestSubmit();
  });
});
function addMsg(role, text, verified, meta, persist) {
  const div = document.createElement('div');
  div.setAttribute('data-testid', role === 'user' ? 'user-message' : 'assistant-message');
  div.appendChild(document.createTextNode((role === 'user' ? 'you: ' : 'zoveli: ')));
  appendLinkified(div, text);
  if (verified) {
    const b = document.createElement('span');
    b.setAttribute('data-testid', 'verification-badge');
    b.className = 'badge';
    b.textContent = 'VERIFIED';
    div.appendChild(b);
  }
  if (meta) {
    const m = document.createElement('div');
    m.setAttribute('data-testid', 'reply-meta');
    m.className = 'msg-meta';
    m.textContent = meta;
    div.appendChild(m);
  }
  log.appendChild(div);
  if (persist !== false) saveChat(role, text, verified, meta);
}
// Mirrors render.ts splitUrls (tested there): safe link rendering —
// http(s) URLs become links, everything else stays inert text.
// Regex-free on purpose: no backslash escaping across template layers.
function appendLinkified(el, text) {
  var last = 0, i = 0;
  while (i < text.length) {
    var h = text.indexOf('http', i);
    if (h < 0) break;
    var prefix = '';
    if (text.startsWith('https://', h)) prefix = 'https://';
    else if (text.startsWith('http://', h)) prefix = 'http://';
    if (prefix === '') { i = h + 4; continue; }
    var end = h + prefix.length;
    // Char-code terminators: space, tab, newline, angle brackets, quotes,
    // paren, bracket, brace. Codes avoid escaping issues in this template.
    var TERMINATORS = [32, 9, 10, 60, 62, 34, 39, 41, 93, 125];
    while (end < text.length && TERMINATORS.indexOf(text.charCodeAt(end)) < 0) end++;
    var link = text.slice(h, end);
    while (link.length > prefix.length && '.,;:!?'.indexOf(link[link.length - 1]) >= 0) link = link.slice(0, -1);
    if (link.length <= prefix.length) { i = h + prefix.length; continue; }
    if (h > last) el.appendChild(document.createTextNode(text.slice(last, h)));
    var a = document.createElement('a');
    a.href = link; a.rel = 'noopener'; a.target = '_blank';
    a.textContent = link;
    el.appendChild(a);
    last = h + link.length;
    i = h + link.length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}
// Recent chats live in this browser only (Duck.ai principle, local-first):
// persisted across reloads, capped, erasable, never sent anywhere.
const CHAT_KEY = 'zoveli-chats';
const CHAT_CAP = 100;
function loadChats() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]');
    if (!Array.isArray(raw)) return;
    raw.slice(-CHAT_CAP).forEach((m) => {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string') {
        addMsg(m.role, m.text, !!m.verified, typeof m.meta === 'string' ? m.meta : '', false);
      }
    });
  } catch (e) {}
}
function saveChat(role, text, verified, meta) {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]');
    raw.push({ role, text: String(text).slice(0, 4000), verified: !!verified, meta: meta || '' });
    localStorage.setItem(CHAT_KEY, JSON.stringify(raw.slice(-CHAT_CAP)));
  } catch (e) {}
}
function clearChats() {
  try { localStorage.removeItem(CHAT_KEY); } catch (e) {}
  log.innerHTML = '';
}
loadChats();
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || sending) return;
  input.value = '';
  addMsg('user', text, false, '', false);
  setSending(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    let data = {};
    try { data = await res.json(); } catch (err) {}
    if (!res.ok) {
      saveChat('user', text, false, '');
      addMsg('assistant', (data && (data.error || data.reason)) || ('Request failed (' + res.status + ').'), false, '', false);
      return;
    }
    const meta = data.model ? ('via ' + data.model + (data.local === false ? '' : ' · stays on this machine')) : '';
    const keep = !!data.reply && !data.setup;
    if (keep) saveChat('user', text, false, '');
    addMsg('assistant', data.reply || data.error || '(empty reply)', !!data.verified, meta, keep);
    if (data.setup) chatStatus.textContent = 'Chat model not configured. Local tools still work.';
  } catch (err) {
    saveChat('user', text, false, '');
    addMsg('assistant', 'I could not reach the local server. Check that Zoveli is still running, then try again.', false, '', false);
  } finally {
    setSending(false);
    input.focus();
  }
});
toolsEl.setAttribute('aria-busy', 'true');
fetch('/api/tools').then((r) => {
  if (!r.ok) throw new Error('tools unavailable');
  return r.json();
}).then((tools) => {
  if (!Array.isArray(tools) || tools.length === 0) {
    toolsEl.textContent = 'No tools are available.';
    return;
  }
  const list = document.createElement('ul');
  tools.forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t.name;
    if (t.description) li.title = t.description;
    list.appendChild(li);
  });
  toolsEl.textContent = '';
  toolsEl.appendChild(list);
}).catch(() => {
  toolsEl.textContent = 'Tools are unavailable right now.';
}).finally(() => {
  toolsEl.setAttribute('aria-busy', 'false');
});
document.getElementById('clear-chats').addEventListener('click', () => {
  clearChats();
  chatStatus.textContent = 'Chat history cleared.';
  input.focus();
});
</script>
</body>
</html>`;
}

export function renderLoginPage(): string {
  return (loginPageCache ??= `<!doctype html>
<html lang="en" data-theme="daylight" data-testid="app-root">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Zoveli AI — log in</title>
${themeHeadScript()}
<style>
  ${themeCSS()}
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; background: var(--bg); color: var(--fg); position: relative; z-index: 1; }
  h1 { font-size: clamp(1.6rem, 5vw, 2.2rem); }
  label { display: block; margin-top: .75rem; font-size: .9rem; }
  input, button { padding: 8px; margin: 4px 0; width: 100%; box-sizing: border-box; font: inherit; }
  input { background: var(--panel); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; }
  button { cursor: pointer; }
  button:disabled { cursor: progress; opacity: .7; }
  #status { min-height: 1.5em; color: var(--muted); }
  #status:empty { min-height: 0; }
  .back { margin-top: 1.5rem; font-size: .9rem; }
  a { color: var(--accent); }
</style>
</head>
<body>
<div id="us-bg" aria-hidden="true"></div>
<a class="skip-link" href="#main">Skip to sign in</a>
<header>
<h1>Log in / sign up</h1>
<p>Enter any email address — including <code>@proton.me</code> — and we will send a 6-digit code. No password, no OAuth middleman.</p>
</header>
<main id="main" tabindex="-1">
<div id="status" data-testid="login-status" role="status"></div>
<form id="email-form">
  <label for="login-email">Email address</label>
  <input id="login-email" data-testid="login-email" type="email" name="email" placeholder="you@proton.me" autocomplete="email" autocapitalize="none" spellcheck="false" required />
  <button type="submit" id="send-code" data-testid="login-send">Send code</button>
</form>
<form id="code-form" style="display:none">
  <label for="login-code">6-digit login code</label>
  <input id="login-code" data-testid="login-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required />
  <button type="submit" id="verify-code" data-testid="login-verify">Verify</button>
</form>
<p class="back"><a href="/">Back to chat</a></p>
</main>
<script>
const status = document.getElementById('status');
const emailForm = document.getElementById('email-form');
const codeForm = document.getElementById('code-form');
const emailInput = document.getElementById('login-email');
const codeInput = document.getElementById('login-code');
const sendButton = document.getElementById('send-code');
const verifyButton = document.getElementById('verify-code');
let email = '';
function requestFailed(res, data) {
  return (data && (data.error || data.reason)) || ('request failed (' + res.status + ')');
}
emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sendButton.disabled) return;
  email = emailInput.value.trim();
  sendButton.disabled = true;
  sendButton.textContent = 'Sending…';
  status.textContent = 'Sending a code…';
  try {
    const res = await fetch('/api/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    let data = {};
    try { data = await res.json(); } catch (err) {}
    if (!res.ok || !data.ok) {
      status.textContent = 'Could not send a code: ' + requestFailed(res, data) + '.';
      return;
    }
    if (typeof data.devCode === 'string') codeInput.value = data.devCode;
    status.textContent = 'Code sent — check your inbox.';
    codeForm.style.display = 'block';
    codeInput.focus();
  } catch (err) {
    status.textContent = 'Could not reach the local server. Check that Zoveli is still running, then try again.';
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = 'Send code';
  }
});
codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (verifyButton.disabled) return;
  const code = codeInput.value.trim();
  verifyButton.disabled = true;
  verifyButton.textContent = 'Verifying…';
  status.textContent = 'Verifying the code…';
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    let data = {};
    try { data = await res.json(); } catch (err) {}
    if (res.ok && data.ok) {
      status.textContent = 'Signed in as ' + data.email;
      codeInput.value = '';
    } else {
      status.textContent = 'Could not sign in: ' + requestFailed(res, data) + '.';
    }
  } catch (err) {
    status.textContent = 'Could not reach the local server. Check that Zoveli is still running, then try again.';
  } finally {
    verifyButton.disabled = false;
    verifyButton.textContent = 'Verify';
  }
});
</script>
${themeSwitcherHTML()}
<script src="/vendor/lenis.min.js" defer></script>
${themeBootScript(unicornProjectId())}
</body>
</html>`);
}
