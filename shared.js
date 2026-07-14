// ── GradeIQ 2.0 — shared.js ───────────────────────────────────────────────
// Drop this in the repo root. Every page loads it via <script src="/shared.js">
// It injects: Supabase client, auth helpers, nav, theme, toast, base CSS.

const SURL  = 'https://butgbareffrnvlmvsdea.supabase.co';
const SKEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1dGdiYXJlZmZybnZsbXZzZGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTU4MDUsImV4cCI6MjA5NjkzMTgwNX0.LC7JD9TKYrJFlJ_3U4H62gugPkUWLs9t4a3UfeMa2QY';
const ADMIN = 'jlk12493@gmail.com';

const sb = supabase.createClient(SURL, SKEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

let CU = null; // current user, set by requireAuth()

// ── UTILS ─────────────────────────────────────────────────────────────────
const g = id => document.getElementById(id);

function toast(msg, isError = false) {
  let el = g('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:24px;right:20px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,.5);transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.borderColor = isError ? 'var(--red)' : 'var(--green)';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

function f$(v) {
  if (v == null || isNaN(v)) return '--';
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
}

function fmtPct(n) { return n == null ? '--' : Number(n).toFixed(1) + '%'; }

// ── THEME ──────────────────────────────────────────────────────────────────
function loadTheme() {
  const isLight = localStorage.getItem('scc-theme') === 'light';
  if (isLight) document.body.classList.add('light-mode');
  const btn = g('theme-btn');
  if (btn) btn.textContent = isLight ? '☀ Light' : '☾ Dark';
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('scc-theme', isLight ? 'light' : 'dark');
  const btn = g('theme-btn');
  if (btn) btn.textContent = isLight ? '☀ Light' : '☾ Dark';
}

// ── NAV ────────────────────────────────────────────────────────────────────
function goPage(page) {
  const map = {
    home:       'index.html',
    signals:    'buy-signals.html',
    collection: 'collection.html',
    learn:      'learn.html',
    admin:      'admin.html',
    financials: 'financials.html',
  };
  if (map[page]) window.location.href = map[page];
}

function setActivePage(page) {
  document.querySelectorAll('.ntab').forEach(t => {
    t.classList.toggle('active', t.dataset.page === page);
  });
}

function toggleMobileNav() {
  const nav = g('mobile-nav');
  if (nav) nav.classList.toggle('open');
}

function toggleAcctMenu() {
  const menu = g('acct-menu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// ── AUTH ───────────────────────────────────────────────────────────────────
async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { window.location.href = 'login.html'; return null; }
  CU = data.session.user;
  _renderUserInfo();
  return CU;
}

async function requireAdmin() {
  const user = await requireAuth();
  if (!user || user.email !== ADMIN) { window.location.href = 'index.html'; return null; }
  return user;
}

function _renderUserInfo() {
  const el = g('user-email');
  if (el && CU) el.textContent = CU.email;
  if (CU && CU.email === ADMIN) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }
}

async function doLogout() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

// ── NAV INJECTION ──────────────────────────────────────────────────────────
// Call buildNav('signals') etc. at the top of each page's <body>
function buildNav(activePage) {
  const html = `
<header class="hdr">
  <div class="hdr-top"></div>
  <div class="hdr-inner">
    <div class="brand" onclick="goPage('home')" style="cursor:pointer;">
      <div class="mini-slab">
        <div class="mb">PSA</div>
        <div class="mg">10</div>
      </div>
      <div class="brand-text">
        <h1>GradeIQ</h1>
        <p>Grading Intelligence</p>
      </div>
    </div>

    <nav class="hnav">
      <a class="ntab" data-page="home"       onclick="goPage('home')">Home</a>
      <a class="ntab" data-page="signals"    onclick="goPage('signals')" style="color:var(--green);">⚡ Buy Signals</a>
      <a class="ntab" data-page="collection" onclick="goPage('collection')">My Collection</a>
      <a class="ntab" data-page="learn"      onclick="goPage('learn')">Learn</a>
      <a class="ntab admin-only" data-page="admin" onclick="goPage('admin')" style="display:none;color:var(--amber);">⚡ Admin</a>
    </nav>

    <div class="huser">
      <button class="theme-toggle" id="theme-btn" onclick="toggleTheme()">☾ Dark</button>
      <div class="acct-wrap" style="position:relative;">
        <button class="btn-out" onclick="toggleAcctMenu()" style="display:flex;align-items:center;gap:6px;">
          <span id="user-email" style="font-size:10px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
          <span style="font-size:10px;">▾</span>
        </button>
        <div id="acct-menu" style="display:none;position:absolute;right:0;top:calc(100% + 6px);background:var(--surface);border:1px solid var(--border);border-radius:8px;min-width:160px;z-index:200;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.5);">
          <a class="acct-item" onclick="goPage('financials')" style="display:block;padding:10px 14px;font-size:12px;color:var(--text);cursor:pointer;border-bottom:1px solid var(--border);">💰 Financials</a>
          <a class="acct-item" onclick="doLogout()" style="display:block;padding:10px 14px;font-size:12px;color:var(--text-muted);cursor:pointer;">Sign Out</a>
        </div>
      </div>
      <button class="ham-btn" onclick="toggleMobileNav()">☰</button>
    </div>
  </div>
</header>

<div class="mobile-nav" id="mobile-nav">
  <button class="mob-close" onclick="toggleMobileNav()">✕</button>
  <button class="mntab" onclick="goPage('home');toggleMobileNav()">Home</button>
  <button class="mntab" style="border-color:var(--green);color:var(--green);" onclick="goPage('signals');toggleMobileNav()">⚡ Buy Signals</button>
  <button class="mntab" onclick="goPage('collection');toggleMobileNav()">My Collection</button>
  <button class="mntab" onclick="goPage('learn');toggleMobileNav()">Learn</button>
  <button class="mntab" onclick="goPage('financials');toggleMobileNav()">💰 Financials</button>
  <button class="mntab admin-only" style="display:none;border-color:var(--amber);color:var(--amber);" onclick="goPage('admin');toggleMobileNav()">⚡ Admin</button>
  <button class="mntab" style="border-top:1px solid var(--border);color:#F87171;margin-top:8px;" onclick="doLogout()">Sign Out</button>
</div>`;

  document.body.insertAdjacentHTML('afterbegin', html);
  setActivePage(activePage);
  loadTheme();

  document.addEventListener('click', e => {
    const menu = g('acct-menu');
    const wrap = document.querySelector('.acct-wrap');
    if (menu && wrap && !wrap.contains(e.target)) menu.style.display = 'none';
  });
}

// ── BASE CSS ───────────────────────────────────────────────────────────────
(function injectBaseCSS() {
  const style = document.createElement('style');
  style.textContent = `
:root{
  --red:#CC0000;--red-light:#FF3333;--black:#000000;--near-black:#0B0B0B;
  --surface:#121212;--surface-2:#1A1A1A;--surface-3:#222222;
  --border:#2A2A2A;--text:#FFFFFF;--text-2:#A0A0A0;--text-muted:#8A8A8A;
  --green:#B6FF00;--amber:#F59E0B;--blue:#3B82F6;--r:8px;
}
body.light-mode{
  --black:#F5F5F5;--near-black:#EBEBEB;
  --surface:#FFFFFF;--surface-2:#F5F5F5;--surface-3:#EBEBEB;
  --border:#D0D0D0;--text:#111111;--text-2:#333333;--text-muted:#777777;
  --green:#2D6000;
}
body.light-mode,
body.light-mode *:not(.btn-a):not(.btn-p):not(.ntab.active):not(.bdg){color:#1A1A1A;}
body.light-mode .ntab.active{color:var(--green);}
body.light-mode .hdr{background:#fff;border-bottom:3px solid var(--green);}
body.light-mode .hdr-top{background:var(--green);}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--black);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;min-height:100vh;}
a{text-decoration:none;cursor:pointer;}
/* HEADER */
.hdr{background:var(--near-black);border-bottom:3px solid var(--green);position:sticky;top:0;z-index:100;}
.hdr-top{background:var(--green);height:3px;}
.hdr-inner{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;gap:10px;}
.brand{display:flex;align-items:center;gap:8px;}
.mini-slab{width:26px;height:38px;background:#fff;border-radius:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px;gap:1px;flex-shrink:0;}
.mini-slab .mb{background:var(--green);color:#000;font-size:4px;font-weight:900;width:100%;text-align:center;padding:1px 0;}
.mini-slab .mg{font-size:11px;font-weight:900;color:#000;line-height:1;}
.brand-text h1{font-size:13px;font-weight:800;color:#fff;letter-spacing:1.5px;text-transform:uppercase;}
.brand-text p{font-size:8px;color:var(--green);letter-spacing:2px;text-transform:uppercase;font-weight:600;}
.hnav{display:flex;gap:1px;flex-wrap:wrap;}
.ntab{padding:5px 12px;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text-muted);background:transparent;border:none;cursor:pointer;border-radius:3px 3px 0 0;border-bottom:2px solid transparent;transition:all .15s;}
.ntab:hover{color:#fff;}
.ntab.active{color:var(--green);border-bottom-color:var(--green);}
.huser{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.theme-toggle{background:transparent;border:1px solid var(--border);color:var(--text-muted);padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;transition:all .2s;}
.theme-toggle:hover{border-color:var(--green);color:var(--green);}
.btn-out{background:transparent;border:1px solid var(--border);color:var(--text-muted);padding:4px 10px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;}
.btn-out:hover{border-color:var(--green);color:var(--green);}
.acct-item:hover{background:var(--surface-2);}
/* MOBILE */
.ham-btn{display:none;background:transparent;border:1px solid var(--border);color:var(--text-muted);padding:5px 10px;border-radius:4px;font-size:18px;cursor:pointer;}
.mobile-nav{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:var(--near-black);z-index:200;flex-direction:column;padding:60px 20px 20px;gap:4px;overflow-y:auto;}
.mobile-nav.open{display:flex;}
.mntab{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:14px 16px;border-radius:var(--r);font-size:14px;font-weight:600;cursor:pointer;text-align:left;}
.mntab:hover{border-color:var(--green);color:var(--green);}
.mob-close{position:absolute;top:16px;right:16px;background:transparent;border:none;color:var(--text-muted);font-size:24px;cursor:pointer;}
@media(max-width:768px){.hnav{display:none;}.ham-btn{display:block;}}
/* LAYOUT */
.main{padding:16px;max-width:1600px;margin:0 auto;}
/* BUTTONS */
.btn-p{background:var(--green);color:#000;border:none;padding:10px 20px;border-radius:6px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;cursor:pointer;}
.btn-p:hover{opacity:.9;}
.btn-p:disabled{opacity:.5;cursor:not-allowed;}
.btn-s{background:transparent;border:1px solid var(--border);color:var(--text-muted);padding:6px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;}
.btn-s:hover{border-color:var(--green);color:var(--green);}
/* PANELS */
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px;}
.ptitle{font-size:9px;font-weight:700;color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);}
/* INPUTS */
.fi{background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:6px;font-size:13px;outline:none;width:100%;}
.fi:focus{border-color:var(--green);}
select.fi{cursor:pointer;}
/* LIGHT MODE INPUTS */
body.light-mode .fi,body.light-mode input,body.light-mode select{background:#E8E4DF;color:#1A1A1A;border-color:#C8C4BF;}
body.light-mode .panel,body.light-mode .mobile-nav{background:#F0EDE9;border-color:#C8C4BF;}
/* EMPTY */
.empty{text-align:center;padding:60px 20px;color:var(--text-muted);}
.empty-icon{font-size:40px;margin-bottom:12px;}
.empty-title{font-size:16px;font-weight:700;color:var(--text);margin-bottom:6px;}
  `;
  document.head.insertBefore(style, document.head.firstChild);
})();
