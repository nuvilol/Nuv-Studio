window.addEventListener('unhandledrejection', e => toast('Error: ' + (e.reason?.message || e.reason)));
window.addEventListener('error', e => toast('Error: ' + e.message));
setTimeout(() => { if (!window.native) toast('File bridge missing: preload.js did not load. It must sit next to main.js.'); }, 800);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RANK = { user: 0, mod: 1, admin: 2, owner: 3 };
const MANUAL = ['founder', 'dev', 'bug', 'supporter', 'verified'];
const BADGE = { owner: ['Owner', '👑'], admin: ['Admin', '🛡️'], mod: ['Moderator', '🔨'], founder: ['Founder', '⭐'], dev: ['Developer', '💻'], bug: ['Bug Hunter', '🐛'], supporter: ['Supporter', '💎'], verified: ['Verified', '✅'] };
const THEMES = {
  Midnight: { base: 'vs-dark', accent: '#5b8cff', editor: '#12141a', ui: { bg: '#111318', rail: '#0b0d11', panel: '#161920', text: '#c9d1d9', muted: '#7d8590', border: '#232733' } },
  Nebula:   { base: 'vs-dark', accent: '#a78bfa', editor: '#15102b', ui: { bg: '#120e24', rail: '#0b0818', panel: '#1a1438', text: '#e2d9ff', muted: '#8f84b8', border: '#2c2358' } },
  Ember:    { base: 'vs-dark', accent: '#ff7a45', editor: '#1a1210', ui: { bg: '#17100e', rail: '#0e0807', panel: '#211613', text: '#f0dcd2', muted: '#a38878', border: '#3a2620' } },
  Forest:   { base: 'vs-dark', accent: '#3ddc97', editor: '#0f1a16', ui: { bg: '#0e1714', rail: '#080f0d', panel: '#13201b', text: '#d3ece1', muted: '#76968a', border: '#1f3a31' } },
  Daylight: { base: 'vs', accent: '#2563eb', editor: '#ffffff', ui: { bg: '#f4f5f8', rail: '#e3e6ee', panel: '#ffffff', text: '#1f2430', muted: '#6b7280', border: '#d8dce6' } },
};
const cfg = JSON.parse(localStorage.cfg || '{}');
const S = { view: 'home', arg: null, want: null, token: localStorage.token || '', me: null, server: localStorage.server || (location.protocol === 'file:' ? 'http://localhost:3000' : location.origin), folder: null, tabs: [], active: null, chat: null, friends: [], socket: null, modTab: 'reports' };
const VIEWS = {};
let editor, extMap = {}, nameMap = {};

/* ---------- helpers ---------- */
const badgeInfo = b => b.startsWith('member-') ? ['Member since ' + b.slice(7), '🎖️'] : BADGE[b] || [b, '🏷️'];
const media = p => p ? S.server + p : '';
const hue = s => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
const avatar = (u, c = 'fav') => u.avatar ? `<img class="${c}" src="${esc(media(u.avatar))}">` : `<div class="${c} ${c === 'av' ? 'ph' : ''}">${esc(u.username[0].toUpperCase())}</div>`;
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }
function modal(html, wide) { const m = $('#modal'); m.innerHTML = `<div class="box ${wide ? 'wide' : ''}">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m) closeModal(); }; return m.firstChild; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function ask(title, label, def = '') {
  return new Promise(res => {
    const b = modal(`<h3>${esc(title)}</h3><textarea id="askv" placeholder="${esc(label)}">${esc(def)}</textarea><div class="row"><button id="ok" class="btn">Submit</button><button id="no" class="btn ghost">Cancel</button></div>`);
    b.querySelector('#ok').onclick = () => { const v = b.querySelector('#askv').value.trim(); closeModal(); res(v); };
    b.querySelector('#no').onclick = () => { closeModal(); res(null); };
  });
}
async function api(path, opts = {}) {
  const headers = { Authorization: 'Bearer ' + S.token };
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  try {
    const r = await fetch(S.server + path, { method: opts.method || 'GET', headers, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error === 'banned' ? 'Banned: ' + j.reason : j.error || 'Request failed');
    return j;
  } catch (e) { toast(e.message === 'Failed to fetch' ? 'Server offline. Run: npm run server' : e.message); throw e; }
}

/* ---------- theme ---------- */
function applyTheme() {
  const t = THEMES[cfg.theme] || THEMES.Midnight, r = document.documentElement.style, acc = cfg.accent || t.accent;
  Object.entries(t.ui).forEach(([k, v]) => r.setProperty('--' + k, v));
  r.setProperty('--accent', acc); r.setProperty('--editor', t.editor);
  try { native.overlay(t.ui.rail, t.ui.muted); } catch {}
  try { applyTermTheme(); } catch {}
  if (editor) {
    monaco.editor.defineTheme('app', {
      base: t.base, inherit: true,
      rules: t.base === 'vs-dark' ? [
        { token: 'comment', foreground: '6b7a90', fontStyle: 'italic' }, { token: 'keyword', foreground: 'c792ea' },
        { token: 'string', foreground: '9ece6a' }, { token: 'number', foreground: 'ff9e64' }, { token: 'type', foreground: '7dcfff' }
      ] : [],
      colors: { 'editor.background': t.editor, 'editor.selectionBackground': acc + '44', 'editor.lineHighlightBackground': acc + '14', 'editorCursor.foreground': acc, 'editorLineNumber.activeForeground': acc }
    });
    monaco.editor.setTheme('app');
    editor.updateOptions({
      fontSize: cfg.fontSize || 14, fontFamily: `"${cfg.font || 'Cascadia Code'}", Consolas, monospace`, fontLigatures: !!cfg.lig,
      minimap: { enabled: cfg.minimap !== false }, padding: { top: 12 }, lineHeight: 22, smoothScrolling: true,
      cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on', bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true }, scrollBeyondLastLine: false, renderLineHighlight: 'all', roundedSelection: true,
      formatOnPaste: true, linkedEditing: true, mouseWheelZoom: true, stickyScroll: { enabled: true }, dropIntoEditor: { enabled: false }
    });
  }
}

/* ---------- skeleton + Monaco ---------- */
function buildSkeleton() {
  $('#main').innerHTML = '<div id="editorWrap"><div id="tabs"></div><div id="edArea"><div id="editorHost"></div><div id="welcome"><div class="wlogo">N</div><h2>Nuv Studio</h2><div class="keys"><span><kbd>Ctrl</kbd><kbd>P</kbd> Go to file</span><span><kbd>Ctrl</kbd><kbd>S</kbd> Save</span><span><kbd>Ctrl</kbd><kbd>W</kbd> Close tab</span><span><kbd>Ctrl</kbd><kbd>B</kbd> Toggle sidebar</span><span><kbd>F1</kbd> Command palette</span><span><kbd>Ctrl</kbd><kbd>`</kbd> Terminal</span><span>Right-click the explorer for more</span></div></div></div><div id="termPanel" hidden></div></div><div id="page"></div>';
  $('#status').innerHTML = '<button id="tbtn" class="sbtn" hidden></button><span id="sUser"></span><span class="sp"></span><span id="sPos"></span><select id="lang"></select>';
  $('#lang').onchange = e => S.active && monaco.editor.setModelLanguage(S.active.model, e.target.value);
}
let monacoReadyResolve; const monacoReady = new Promise(r => { monacoReadyResolve = r; });
require.config({ paths: { vs: window.MONACO_PATH || 'node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  const langs = monaco.languages.getLanguages();
  langs.forEach(l => { (l.extensions || []).forEach(e => extMap[e] = l.id); (l.filenames || []).forEach(f => nameMap[f] = l.id); });
  $('#lang').innerHTML = langs.map(l => `<option value="${esc(l.id)}">${esc(l.aliases?.[0] || l.id)}</option>`).join('');
  editor = monaco.editor.create($('#editorHost'), { automaticLayout: true, model: null, dropIntoEditor: { enabled: false } });
  editor.onDidChangeCursorPosition(updateStatus);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
  applyTheme();
  monacoReadyResolve();
});
const langFor = n => nameMap[n] || extMap['.' + n.split('.').pop().toLowerCase()] || 'plaintext';

function updateStatus() {
  if (!$('#sPos')) return;
  const p = editor?.getPosition();
  $('#sUser').textContent = S.me ? '● ' + S.me.username : 'Signed out';
  $('#sPos').textContent = S.view === 'editor' && p && S.active ? `Ln ${p.lineNumber}, Col ${p.column}` : '';
  if (S.active) $('#lang').value = S.active.model.getLanguageId();
}

/* ---------- editor: folders, tabs, files ---------- */
async function openFolder(dir) {
  dir = dir || await native.pickFolder(); if (!dir) return;
  if (S.tabs.some(t => t.dirty) && !confirm('Discard unsaved changes?')) return;
  S.tabs.forEach(t => t.model.dispose()); S.tabs = []; S.active = null; editor?.setModel(null);
  S.folder = dir; S.sel = null; S.selDir = false;
  if (!native.isWeb) localStorage.recents = JSON.stringify([dir, ...JSON.parse(localStorage.recents || '[]').filter(x => x !== dir)].slice(0, 8));
  termFolderChanged();
  go('editor');
}
async function renderTree(dir, host, depth = 0) {
  let items; try { items = await native.readDir(dir); } catch { return toast('Cannot read folder'); }
  host.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div'), isOpen = it.dir && S.open.has(it.path);
    row.className = 'node' + (S.sel === it.path ? ' sel' : '');
    row.style.paddingLeft = 6 + depth * 14 + 'px';
    row.dataset.path = it.path; row.dataset.dir = it.dir ? '1' : '';
    row.innerHTML = `<span class="chev ${isOpen ? 'down' : ''}">${it.dir ? ic('chev', 12) : ''}</span>${fileIcon(it)}<span class="nm">${esc(it.name)}</span>`;
    host.appendChild(row);
    const kids = it.dir ? host.appendChild(document.createElement('div')) : null;
    if (isOpen) await renderTree(it.path, kids, depth + 1);
    row.onclick = async e => {
      if ((e.ctrlKey || e.metaKey) && S.sel === it.path) return clearSel();   // Ctrl+click = deselect
      S.sel = it.path; S.selDir = it.dir;
      document.querySelectorAll('#tree .sel, .proj.sel').forEach(n => n.classList.remove('sel')); row.classList.add('sel');
      if (!it.dir) return openFile(it.path);
      const open = !S.open.has(it.path);
      open ? S.open.add(it.path) : S.open.delete(it.path);
      row.querySelector('.chev').classList.toggle('down', open);
      if (open) await renderTree(it.path, kids, depth + 1); else kids.innerHTML = '';
    };
  }
}
async function openFile(p) {
  await monacoReady;
  let t = S.tabs.find(t => t.path === p);
  if (!t) {
    let text; try { text = await native.readFile(p); } catch { return toast('Cannot open that file'); }
    const name = p.split(/[\\/]/).pop();
    const model = monaco.editor.createModel(text, langFor(name), monaco.Uri.file(p));
    t = { path: p, name, model, dirty: false };
    model.onDidChangeContent(() => { if (!t.dirty) { t.dirty = true; renderTabs(); } });
    S.tabs.push(t);
  }
  activate(t);
}
function activate(t) { S.active = t; editor.setModel(t.model); renderTabs(); updateStatus(); editor.focus(); }
function closeTab(t) {
  if (t.dirty && !confirm('Close without saving?')) return;
  const i = S.tabs.indexOf(t); S.tabs.splice(i, 1); t.model.dispose();
  if (S.active === t) { S.active = null; S.tabs.length ? activate(S.tabs[Math.max(0, i - 1)]) : editor.setModel(null); }
  renderTabs();
}
function renderTabs() {
  const el = $('#tabs'); el.innerHTML = '';
  S.tabs.forEach(t => {
    const d = document.createElement('div'); d.className = 'tab' + (t === S.active ? ' on' : '');
    d.innerHTML = `${fileIcon({ name: t.name })}<span>${esc(t.name)}</span><button class="tx">${t.dirty ? '<i class="dirty"></i>' : ic('x', 14)}</button>`;
    d.querySelector('.tx').onclick = e => { e.stopPropagation(); closeTab(t); };
    d.onclick = () => activate(t);
    d.onauxclick = e => { if (e.button === 1) closeTab(t); };
    el.appendChild(d);
  });
  const w = $('#welcome'); if (w) w.hidden = S.tabs.length > 0;
}
async function save() {
  const t = S.active; if (!t) return;
  const r = await native.writeFile(t.path, t.model.getValue()); t.dirty = false; renderTabs();
  toast(r === 'mem' ? 'Saved in the browser. Right-click the file > Download to keep a copy.' : 'Saved');
}

/* ---------- icons ---------- */
const P = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  gear: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  collapse: '<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
};
P.filePlus = P.file + '<path d="M9 15h6M12 18v-6"/>';
P.folderPlus = P.folder + '<path d="M12 10v6M9 13h6"/>';
P.terminal = '<path d="m4 17 6-6-6-6M12 19h8"/>';
P.book = '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>';
const ic = (n, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;
const EXT_COLOR = { js: '#f7df1e', mjs: '#f7df1e', ts: '#3b82f6', tsx: '#38bdf8', jsx: '#38bdf8', json: '#f59e0b', html: '#f97316', css: '#a78bfa', scss: '#ec4899', py: '#4ade80', java: '#ef4444', c: '#60a5fa', cpp: '#60a5fa', cs: '#a78bfa', go: '#22d3ee', rs: '#fb923c', php: '#818cf8', rb: '#f43f5e', md: '#94a3b8', sh: '#86efac', yml: '#f472b6', yaml: '#f472b6', sql: '#fbbf24', xml: '#fb923c', png: '#34d399', jpg: '#34d399', gif: '#34d399', svg: '#34d399' };
const fileIcon = it => it.dir
  ? `<span class="fi" style="color:var(--accent)">${ic('folder', 16)}</span>`
  : `<span class="fi" style="color:${EXT_COLOR[it.name.split('.').pop().toLowerCase()] || '#8b98a9'}">${ic('file', 16)}</span>`;

/* ---------- explorer actions ---------- */
S.open = new Set(); S.sel = null; S.selDir = false;
const sepOf = p => p.includes('\\') ? '\\' : '/';
const joinP = (a, b) => a.replace(/[\\/]+$/, '') + sepOf(a) + b.replace(/[\\/]/g, sepOf(a));
const dirOf = p => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));
const baseOf = p => p.split(/[\\/]/).pop();
const bad = n => /[:*?"<>|]/.test(n) || /(^|[\\/])\.\.([\\/]|$)/.test(n) || /^[\\/]/.test(n);
const errText = e => String(e?.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
const targetDir = (p, isDir) => (!p || !S.folder || !p.startsWith(S.folder)) ? S.folder : isDir ? p : dirOf(p);
const refreshTree = () => (S.folder && $('#tree')) ? renderTree(S.folder, $('#tree')) : null;
const relTo = d => (!d || d === S.folder) ? 'project root' : d.slice(S.folder.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
function clearSel() {   // nothing selected = new files/folders go in the project root
  S.sel = null; S.selDir = false;
  document.querySelectorAll('#tree .sel').forEach(n => n.classList.remove('sel'));
  $('.proj')?.classList.add('sel');
}

function nameBox(title, def = '') {
  return new Promise(res => {
    const b = modal(`<h3>${esc(title)}</h3><input id="nm" value="${esc(def)}" autocomplete="off"><div class="row"><button id="ok" class="btn">OK</button><button id="no" class="btn ghost">Cancel</button></div>`);
    const i = b.querySelector('#nm'), done = v => { closeModal(); res(v); };
    i.focus(); const dot = def.lastIndexOf('.'); i.setSelectionRange(0, dot > 0 ? dot : def.length);
    i.onkeydown = e => { if (e.key === 'Enter') done(i.value.trim()); if (e.key === 'Escape') done(null); };
    b.querySelector('#ok').onclick = () => done(i.value.trim());
    b.querySelector('#no').onclick = () => done(null);
  });
}
function ctxMenu(x, y, items) {
  document.querySelector('.ctx')?.remove();
  const m = document.createElement('div'); m.className = 'ctx';
  items.forEach(([label, fn, danger]) => {
    if (!label) return m.appendChild(document.createElement('hr'));
    const d = document.createElement('div'); d.className = 'ci' + (danger ? ' danger' : ''); d.textContent = label;
    d.onclick = () => { m.remove(); fn(); }; m.appendChild(d);
  });
  document.body.appendChild(m);
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
}
function closeUnder(p) {
  const hit = S.tabs.filter(t => t.path === p || t.path.startsWith(p + sepOf(p)));
  if (hit.some(t => t.dirty) && !confirm('Unsaved changes will be lost. Continue?')) return false;
  hit.forEach(t => { t.dirty = false; closeTab(t); });
  return true;
}
async function createItem(kind, dir) {
  const name = await nameBox(`New ${kind} in ${relTo(dir)}`); if (!name) return;
  if (bad(name)) return toast('Invalid name');
  const full = joinP(dir, name);
  try {
    await (kind === 'file' ? native.createFile(full) : native.createDir(full));
    S.open.add(dir); await refreshTree();
    if (kind === 'file') openFile(full);
  } catch (e) { toast(errText(e)); }
}
async function renameItem(p) {
  const old = baseOf(p), name = await nameBox('Rename', old);
  if (!name || name === old) return;
  if (bad(name) || /[\\/]/.test(name)) return toast('Invalid name');
  const to = joinP(dirOf(p), name), reopen = S.tabs.some(t => t.path === p);
  if (!closeUnder(p)) return;
  try { await native.rename(p, to); } catch (e) { return toast(errText(e)); }
  if (S.open.delete(p)) S.open.add(to);
  if (S.sel === p) S.sel = to;
  await refreshTree(); if (reopen) openFile(to);
}
async function deleteItem(p) {
  if (!confirm(native.permanentDelete ? `Permanently delete "${baseOf(p)}"? This can't be undone.` : `Move "${baseOf(p)}" to the Recycle Bin?`) || !closeUnder(p)) return;
  try { await native.remove(p); } catch (e) { return toast(errText(e)); }
  if (S.sel === p) S.sel = null;
  await refreshTree(); toast(native.permanentDelete ? 'Deleted' : 'Moved to Recycle Bin');
}
async function quickOpen() {
  if (!S.folder) return toast('Open a folder first');
  let files; try { files = await native.listFiles(S.folder); } catch (e) { return toast(errText(e)); }
  const m = modal('<input id="qo" placeholder="Go to file…" autocomplete="off"><div id="ql"></div>'); m.classList.add('qo');
  const input = m.querySelector('#qo'), list = m.querySelector('#ql'); let sel = 0, shown = [];
  const rank = (f, q) => {
    const s = f.toLowerCase(); if (!q) return 0;
    if (s.includes(q)) return 1000 - s.length + (baseOf(s).includes(q) ? 500 : 0);
    let i = 0; for (const c of q) { i = s.indexOf(c, i); if (i < 0) return -Infinity; i++; }
    return 100 - s.length;
  };
  const pick = i => { const f = shown[i]; if (!f) return; closeModal(); go('editor'); openFile(joinP(S.folder, f)); };
  const draw = () => {
    const q = input.value.toLowerCase().trim();
    shown = files.map(f => [f, rank(f, q)]).filter(x => x[1] > -Infinity).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
    sel = Math.min(sel, Math.max(shown.length - 1, 0));
    list.innerHTML = shown.map((f, i) => `<div class="qi ${i === sel ? 'on' : ''}" data-i="${i}">${fileIcon({ name: baseOf(f) })}<b>${esc(baseOf(f))}</b><span>${esc(f)}</span></div>`).join('') || '<div class="empty">No matches</div>';
    list.querySelectorAll('.qi').forEach(e => e.onclick = () => pick(+e.dataset.i));
  };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') pick(sel);
    else if (e.key === 'Escape') closeModal();
  };
  draw(); input.focus();
}

/* ---------- listeners ---------- */
$('#cmd').innerHTML = ic('search', 14) + '<span>Go to file</span><kbd>Ctrl P</kbd>';
$('#cmd').onclick = quickOpen;
addEventListener('click', () => document.querySelector('.ctx')?.remove());
$('#side').addEventListener('contextmenu', e => {
  if (S.view !== 'editor' || !S.folder) return;
  e.preventDefault();
  const n = e.target.closest('.node'), p = n?.dataset.path, dir = targetDir(p, !!n?.dataset.dir);
  ctxMenu(e.clientX, e.clientY, [
    ['New file', () => createItem('file', dir)],
    ['New folder', () => createItem('folder', dir)],
    ...(canTerm() ? [['Open in terminal', () => openTermAt(dir)]] : []),
    ...(p ? [[], ['Rename', () => renameItem(p)], ['Delete', () => deleteItem(p), true], [],
      ['Copy path', () => navigator.clipboard.writeText(p).then(() => toast('Path copied'))],
      ...(native.reveal ? [['Reveal in File Explorer', () => native.reveal(p)]] : []),
      ...(native.download && !n.dataset.dir ? [['Download', () => native.download(p)]] : [])] : [])
  ]);
});
$('#side').addEventListener('click', e => {   // click empty space in the explorer = deselect
  if (S.view === 'editor' && S.folder && !e.target.closest('.node, .sh, .proj, .empty')) clearSel();
});
addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.closest?.('.monaco-editor');
  if (e.ctrlKey || e.metaKey) {
    if (e.target.closest?.('#termPanel')) return;   // terminal keeps its own shortcuts
    const k = e.key.toLowerCase();
    if (k === '`') { e.preventDefault(); return toggleTerminal(); }
    if (k === 'p' && !e.shiftKey) { e.preventDefault(); quickOpen(); }
    else if (k === 'w' && S.active && S.view === 'editor') { e.preventDefault(); closeTab(S.active); }
    else if (k === 'b') { e.preventDefault(); $('#app').classList.toggle('no-side'); editor?.layout(); }
  } else if (!typing && S.view === 'editor' && S.sel) {
    if (e.key === 'Escape') clearSel();
    if (e.key === 'F2') renameItem(S.sel);
    if (e.key === 'Delete') deleteItem(S.sel);
  }
});

/* ---------- rail, sidebar, navigation ---------- */
function renderRail() {
  const items = [['home', 'home', 'Home'], ['editor', 'code', 'Editor'], ['community', 'globe', 'Community'], ['messages', 'chat', 'Messages'], ['profile', 'user', 'Profile']];
  if (S.me && RANK[S.me.role] >= 1) items.push(['mod', 'shield', 'Moderation']);
  const btn = (v, i, t) => `<button class="${S.view === v ? 'active' : ''}" title="${t}" data-v="${v}">${ic(i, 22)}</button>`;
  $('#rail').innerHTML = '<div class="logo">N</div>' + items.map(x => btn(...x)).join('') + '<span class="sp"></span>' + btn('settings', 'gear', 'Settings');
  $('#rail').querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.v));
}
function renderSide() {
  const s = $('#side');
  s.className = S.view === 'editor' ? 'ex' : '';
  if (S.view === 'editor') {
    s.innerHTML = `<div class="sh"><span>EXPLORER</span><span class="sp"></span>
      <button class="ib" data-x="file" title="New file">${ic('filePlus', 16)}</button>
      <button class="ib" data-x="folder" title="New folder">${ic('folderPlus', 16)}</button>
      <button class="ib" data-x="refresh" title="Refresh">${ic('refresh', 15)}</button>
      <button class="ib" data-x="collapse" title="Collapse all">${ic('collapse', 16)}</button></div>
      ${S.folder ? `<div class="proj ${S.sel ? '' : 'sel'}" title="Click to deselect: new files and folders go in the project root">${ic('folder', 15)}${esc(baseOf(S.folder))}</div><div id="tree"></div>`
        : `<div class="empty">${ic('folder', 34)}<p>No folder open</p><button class="btn" id="of2">Open Folder</button></div>`}`;
    s.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
      const x = b.dataset.x;
      if (!S.folder) return toast('Open a folder first');
      if (x === 'file' || x === 'folder') createItem(x, targetDir(S.sel, S.selDir));
      else { if (x === 'collapse') S.open.clear(); refreshTree(); }
    });
    if (S.folder) { renderTree(S.folder, $('#tree')); s.querySelector('.proj').onclick = clearSel; } else $('#of2').onclick = () => openFolder();
    renderTabs();
  } else if (S.view === 'messages') {
    const reqs = S.friends.filter(f => f.status === 'pending' && f.incoming), list = S.friends.filter(f => f.status === 'accepted');
    s.innerHTML = `<h4>FRIEND REQUESTS</h4>${reqs.map(f => `<div class="friend" data-u="${esc(f.username)}">${avatar(f)}<span>${esc(f.username)}</span></div>`).join('') || '<div class="muted">None</div>'}
      <h4>FRIENDS</h4>${list.map(f => `<div class="friend ${S.chat?.id === f.id ? 'on' : ''}" data-c="${f.id}">${avatar(f)}<span>${esc(f.username)}</span><span class="sp"></span>${f.online ? '<span class="dot"></span>' : ''}</div>`).join('') || '<div class="muted">No friends yet</div>'}`;
    s.querySelectorAll('[data-u]').forEach(e => e.onclick = () => go('profile', e.dataset.u));
    s.querySelectorAll('[data-c]').forEach(e => e.onclick = () => { S.chat = list.find(f => f.id === +e.dataset.c); go('messages'); });
  }
}
function go(v, arg) {
  if (!S.me && ['community', 'messages', 'profile', 'mod'].includes(v)) { S.want = v; return authModal(); }
  S.view = v; S.arg = arg;
  const ed = v === 'editor';
  $('#editorWrap').style.display = ed ? 'flex' : 'none';
  $('#page').style.display = ed ? 'none' : 'block';
  $('#app').classList.toggle('no-side', !['editor', 'messages'].includes(v));
  renderRail(); renderSide(); updateStatus();
  if (!ed) VIEWS[v](arg); else editor?.layout();
  const tb = $('#tbtn'); if (tb) tb.hidden = !(ed && canTerm());
  if (ed && T.open) setTimeout(fitTerm, 50);
  if (v === 'messages') loadFriends();
}

/* ---------- auth + socket ---------- */
function authModal() {
  const b = modal(`<h3>Sign in</h3><input id="u" placeholder="Username"><input id="p" type="password" placeholder="Password">
    <div class="row"><button id="li" class="btn">Log in</button><button id="rg" class="btn ghost">Register</button><button id="sk" class="btn ghost">Not now</button></div>
    <small class="muted">Server: ${esc(S.server)}</small>`);
  const submit = path => async () => {
    const r = await api(path, { method: 'POST', body: { username: b.querySelector('#u').value, password: b.querySelector('#p').value } });
    S.token = r.token; localStorage.token = r.token; S.me = r.user; closeModal(); connect(); loadFriends(); go(S.want || 'home'); S.want = null;
  };
  b.querySelector('#li').onclick = submit('/api/login'); b.querySelector('#rg').onclick = submit('/api/register'); b.querySelector('#sk').onclick = closeModal;
}
function connect() {
  S.socket?.disconnect(); if (!S.token) return;
  S.socket = io(S.server, { auth: { token: S.token } });
  S.socket.on('dm', m => { if (S.view === 'messages' && S.chat && (m.from_id === S.chat.id || m.to_id === S.chat.id)) addMsg(m); else if (m.from_id !== S.me.id) toast('New message'); });
  S.socket.on('friends:update', loadFriends);
  S.socket.on('warning', r => modal(`<h3>⚠️ Warning from moderators</h3><p>${esc(r)}</p><div class="row"><button class="btn" onclick="closeModal()">OK</button></div>`));
}
async function loadFriends() {
  if (!S.me) return;
  try { S.friends = await api('/api/friends'); } catch { return; }
  if (S.view === 'messages') renderSide();
}

/* ---------- views ---------- */
VIEWS.home = () => {
  const recents = native.isWeb ? [] : JSON.parse(localStorage.recents || '[]');
  $('#page').innerHTML = `<div class="pg">
    <div class="hero"><h1>${S.me ? 'Welcome back, ' + esc(S.me.username) : 'Welcome to Nuv Studio'}</h1>
      <p class="muted">A fast, themeable code editor with profiles, friends and projects you can share.</p>
      <div class="actions"><button class="btn" id="of">${ic('folder', 16)}Open folder</button>
        ${native.pickFiles ? `<button class="btn ghost" id="of3">${ic('file', 16)}Open files</button>` : ''}
        <button class="btn ghost" id="qp">${ic('search', 16)}Go to file</button>
        ${S.me ? '' : '<button class="btn ghost" id="si">Sign in</button>'}</div></div>
    ${native.isWeb ? `<div class="dropzone" id="dz">${ic('folder', 34)}<b>Drag a folder or files here</b><span class="muted">or use the buttons above. Your files stay in your browser until you save or upload them.</span></div>` : '<div class="sec">Recent projects</div>'}
    <div class="grid" ${native.isWeb ? 'hidden' : ''}>${recents.map(p => `<div class="game" data-p="${esc(p)}" style="--h:${hue(p)}"><div class="cover">${esc((baseOf(p)[0] || '•').toUpperCase())}</div><div class="rname">${esc(baseOf(p))}</div><div class="rpath">${esc(p)}</div></div>`).join('')
      || `<div class="empty">${ic('folder', 34)}<p>No projects yet. Open a folder to get started.</p></div>`}</div></div>`;
  $('#of').onclick = () => openFolder(); $('#qp').onclick = quickOpen;
  $('#of3')?.addEventListener('click', async () => openIncoming(await native.pickFiles()));
  $('#dz')?.addEventListener('click', () => openFolder());
  $('#si')?.addEventListener('click', authModal);
  $('#page').querySelectorAll('[data-p]').forEach(e => e.onclick = () => openFolder(e.dataset.p));
};

VIEWS.community = () => {
  $('#page').innerHTML = '<div class="pg"><h2>Community</h2><input id="q" placeholder="Search users…"><div id="res" class="grid"></div></div>';
  const run = async () => {
    const us = await api('/api/users?q=' + encodeURIComponent($('#q').value));
    $('#res').innerHTML = us.map(u => `<div class="game" data-u="${esc(u.username)}">${avatar(u)}<b>${esc(u.username)}</b><div class="muted">${esc(u.status)}</div></div>`).join('');
    $('#res').querySelectorAll('[data-u]').forEach(e => e.onclick = () => go('profile', e.dataset.u));
  };
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(run, 250); }; run();
};

VIEWS.profile = async name => {
  const u = await api('/api/users/' + encodeURIComponent(name || S.me.username));
  const mine = u.id === S.me.id;
  const shown = (u.shown.length ? u.shown : u.badges).filter(b => u.badges.includes(b));
  $('#page').innerHTML = `<div class="profile fx-${esc(u.effect)} card-${esc(u.card)}" style="--pa:${esc(u.accent)}">
    <div class="banner" ${u.banner ? `style="background-image:url('${esc(media(u.banner))}')"` : ''}></div>
    <div class="phead">${avatar(u, 'av')}<div><h1>${esc(u.username)} ${u.online ? '<span class="dot"></span>' : ''}</h1><div class="muted">${esc(u.status)}</div></div><div class="pbtns" id="pbtns"></div></div>
    <div class="chips">${shown.map(b => { const [n, i] = badgeInfo(b); return `<span class="chip">${i} ${esc(n)}</span>`; }).join('')}</div>
    <div class="pcard"><h4>ABOUT</h4><p>${esc(u.bio || 'No bio yet.')}</p><small class="muted">Joined ${new Date(u.created).toLocaleDateString()}</small></div>
    <div class="pcard"><h4>REPOSITORIES</h4><div id="repos"></div></div></div>`;
  $('#repos').innerHTML = u.repos.map(r => `<div class="repo" data-r="${r.id}"><b>${esc(r.name)}</b> <span class="muted">${esc(r.description)}</span></div>`).join('') || '<span class="muted">No repositories yet</span>';
  $('#repos').querySelectorAll('[data-r]').forEach(e => e.onclick = () => repoViewer(+e.dataset.r));
  const del = () => friend(u.id, 'DELETE'), f = u.friendship, btns = [];
  if (mine) btns.push(['Customize', editProfile], ['Upload repo', uploadRepo]);
  else {
    if (!f) btns.push(['Add friend', () => friend(u.id, 'POST')]);
    else if (f.status === 'accepted') btns.push(['Message', () => { S.chat = u; go('messages'); }], ['Remove friend', del]);
    else if (f.incoming) btns.push(['Accept request', () => friend(u.id, 'POST')], ['Decline', del]);
    else btns.push(['Cancel request', del]);
    btns.push(['Report', () => report(u.id, 'user')]);
    if (S.me.role !== 'user' && RANK[S.me.role] > RANK[u.role]) btns.push(['Mod tools', () => modUser(u.id)]);
  }
  btns.forEach(([t, fn]) => { const b = document.createElement('button'); b.className = 'btn' + (/Report|Remove|Decline|Cancel/.test(t) ? ' ghost' : ''); b.textContent = t; b.onclick = fn; $('#pbtns').appendChild(b); });
};
async function friend(id, method) { await api('/api/friends/' + id, { method }); loadFriends(); go('profile', S.arg); }
async function report(target_id, kind, ref = '') {
  const reason = await ask('Report', 'What happened?'); if (!reason) return;
  await api('/api/reports', { method: 'POST', body: { target_id, kind, ref, reason } }); toast('Report sent. Thank you.');
}

function editProfile() {
  const u = S.me, sel = (id, opts, cur) => `<select id="${id}">${opts.map(x => `<option ${x === cur ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  const m = modal(`<h3>Customize profile</h3>
    <label>Avatar (PNG / JPG / GIF / WebP, up to 25 MB)</label><input type="file" id="av" accept="image/*">
    <label>Banner (GIFs animate)</label><input type="file" id="bn" accept="image/*">
    <label>Status</label><input id="st" maxlength="80" value="${esc(u.status)}">
    <label>Bio</label><textarea id="bio" maxlength="500">${esc(u.bio)}</textarea>
    <label>Accent color</label><input type="color" id="ac" value="${esc(u.accent)}">
    <label>Background effect</label>${sel('fx', ['none', 'aurora', 'stars', 'gradient', 'grid'], u.effect)}
    <label>Card style</label>${sel('cd', ['glass', 'solid', 'neon'], u.card)}
    <label>Badges to display</label><div class="chips">${u.badges.map(b => `<label class="chk"><input type="checkbox" value="${esc(b)}" ${(u.shown.length ? u.shown : u.badges).includes(b) ? 'checked' : ''}>${badgeInfo(b)[1]} ${esc(badgeInfo(b)[0])}</label>`).join('')}</div>
    <div class="row"><button class="btn" id="sv">Save</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
  m.querySelector('#sv').onclick = async () => {
    const f = new FormData();
    f.append('status', m.querySelector('#st').value); f.append('bio', m.querySelector('#bio').value);
    f.append('accent', m.querySelector('#ac').value); f.append('effect', m.querySelector('#fx').value); f.append('card', m.querySelector('#cd').value);
    f.append('shown', JSON.stringify([...m.querySelectorAll('.chips input:checked')].map(i => i.value)));
    const av = m.querySelector('#av').files[0], bn = m.querySelector('#bn').files[0];
    if (av) f.append('avatar', av); if (bn) f.append('banner', bn);
    S.me = await api('/api/profile', { method: 'PUT', body: f }); closeModal(); go('profile');
  };
}
async function uploadRepo() {
  const dir = await native.pickFolder(); if (!dir) return;
  let name = await ask('Repository name', 'my-project', dir.split(/[\\/]/).pop()); if (!name) return;
  name = name.replace(/\s+/g, '-'); toast('Uploading…');
  const files = await native.collectRepo(dir);
  await api('/api/repos', { method: 'POST', body: { name, description: '', files } });
  toast(files.some(f => f.path.toLowerCase() === 'readme.md') ? 'Repository uploaded' : 'Uploaded. Add a README.md to show an overview on the repo page.'); go('profile');
}
VIEWS.messages = async () => {
  const c = S.chat;
  $('#page').innerHTML = c ? `<div class="chat"><header>${esc(c.username)}</header><div id="msgs"></div><div class="inbar"><input id="mi" placeholder="Message ${esc(c.username)}"></div></div>`
    : '<div class="pg"><h2>Messages</h2><p class="muted">Pick a friend on the left. You can add friends from their profile.</p></div>';
  if (!c) return;
  (await api('/api/messages/' + c.id)).forEach(m => addMsg(m));
  $('#mi').onkeydown = e => {
    if (e.key === 'Enter' && e.target.value.trim()) { S.socket?.emit('dm', { to: c.id, text: e.target.value }, r => r?.error && toast(r.error)); e.target.value = ''; }
  };
};
function addMsg(m) {
  const box = $('#msgs'); if (!box) return;
  const mine = m.from_id === S.me.id, d = document.createElement('div'); d.className = 'msg' + (mine ? ' mine' : '');
  d.innerHTML = `<div class="bubble">${esc(m.text)}</div><small>${new Date(m.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${mine ? '' : ' · <a>report</a>'}</small>`;
  d.querySelector('a')?.addEventListener('click', () => report(m.from_id, 'message', String(m.id)));
  box.appendChild(d); box.scrollTop = box.scrollHeight;
}

VIEWS.mod = async () => {
  const tab = S.modTab, isAdmin = RANK[S.me.role] >= 2;
  $('#page').innerHTML = `<div class="pg"><h2>Moderation</h2><div class="tabs2">${['reports', 'users', ...(isAdmin ? ['audit'] : [])].map(t => `<button data-t="${t}" class="${t === tab ? 'on' : ''}">${t}</button>`).join('')}</div><div id="modbody"></div></div>`;
  $('.tabs2').querySelectorAll('button').forEach(b => b.onclick = () => { S.modTab = b.dataset.t; VIEWS.mod(); });
  const body = $('#modbody');
  if (tab === 'reports') {
    const rs = await api('/api/mod/reports');
    body.innerHTML = rs.map(r => `<div class="card2"><b>#${r.id}</b> ${esc(r.kind)} report · <b>${esc(r.reporter)}</b> → <b>${esc(r.target)}</b><p>${esc(r.reason)}</p>
      <div class="row"><button class="btn sm" data-a="user" data-id="${r.target_id}">Open user</button><button class="btn sm" data-a="chat" data-id="${r.id}">Chat log</button>
      <button class="btn sm" data-a="resolved" data-id="${r.id}">Resolve</button><button class="btn sm ghost" data-a="dismissed" data-id="${r.id}">Dismiss</button></div></div>`).join('') || '<p class="muted">No open reports.</p>';
    body.onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const id = +b.dataset.id, a = b.dataset.a;
      if (a === 'user') return modUser(id);
      if (a === 'chat') {
        const l = await api('/api/mod/chatlog/' + id);
        return modal(`<h3>Chat log (report #${id})</h3>${l.map(m => `<p><b>${esc(m.username)}</b>: ${esc(m.text)} <small class="muted">${new Date(m.created).toLocaleString()}</small></p>`).join('') || '<p class="muted">No messages</p>'}<div class="row"><button class="btn" onclick="closeModal()">Close</button></div>`, true);
      }
      const note = await ask(a === 'resolved' ? 'Resolve report' : 'Dismiss report', 'Note (optional)'); if (note === null) return;
      await api('/api/mod/reports/' + id, { method: 'POST', body: { status: a, note } }); VIEWS.mod();
    };
  } else if (tab === 'users') {
    body.innerHTML = '<input id="mq" placeholder="Search username…"><div id="ml"></div>';
    const run = async () => {
      const us = await api('/api/mod/users?q=' + encodeURIComponent($('#mq').value));
      $('#ml').innerHTML = us.map(u => `<div class="card2 friend" data-id="${u.id}"><b>${esc(u.username)}</b> <span class="muted">${esc(u.role)}</span>${u.banned ? ' ⛔' : ''}${u.sban ? ' 🔇' : ''}</div>`).join('');
      $('#ml').querySelectorAll('[data-id]').forEach(e => e.onclick = () => modUser(+e.dataset.id));
    };
    let t; $('#mq').oninput = () => { clearTimeout(t); t = setTimeout(run, 250); }; run();
  } else {
    const a = await api('/api/mod/audit');
    body.innerHTML = a.map(x => `<div class="muted">${new Date(x.created).toLocaleString()} · <b>${esc(x.actor)}</b> ${esc(x.action)} ${esc(x.target || '')} ${esc(x.detail)}</div>`).join('');
  }
};
async function modUser(id) {
  const u = await api('/api/mod/user/' + id), me = S.me.role;
  const m = modal(`<h3>${esc(u.username)} <small class="muted">${esc(u.role)}</small></h3>
    <p class="muted">${u.banned ? '⛔ Banned: ' + esc(u.ban_reason) : 'Not banned'} · ${u.sbanned ? '🔇 Social banned: ' + esc(u.sban_reason) : 'Not social banned'}</p>
    <input id="mr" placeholder="Reason"><input id="mh" type="number" min="0" placeholder="Hours (0 = permanent)">
    <div class="row wrap">${[['ban', 'Ban'], ['unban', 'Unban'], ['sban', 'Social ban'], ['unsban', 'Lift social ban'], ['warn', 'Warn'], ['clear_profile', 'Clear profile']].map(([a, l]) => `<button class="btn sm" data-a="${a}">${l}</button>`).join('')}</div>
    ${RANK[me] >= 2 ? `<div class="row"><select id="bd">${MANUAL.map(b => `<option value="${b}">${esc(badgeInfo(b)[0])}</option>`).join('')}</select><button class="btn sm" data-a="badge_add">Give badge</button><button class="btn sm ghost" data-a="badge_remove">Remove</button></div>` : ''}
    ${me === 'owner' ? '<div class="row"><select id="rl"><option>user</option><option>mod</option><option>admin</option></select><button class="btn sm" data-a="role">Set role</button></div>' : ''}
    <h4>REPORTS AGAINST (${u.reportsAgainst.length})</h4>${u.reportsAgainst.map(r => `<div class="muted">#${r.id} ${esc(r.kind)}: ${esc(r.reason)} (${esc(r.status)})</div>`).join('')}
    <h4>HISTORY</h4>${u.history.map(h => `<div class="muted">${new Date(h.created).toLocaleString()} · ${esc(h.action)} ${esc(h.detail)}</div>`).join('') || '<div class="muted">None</div>'}
    <div class="row"><button class="btn ghost" onclick="closeModal()">Close</button></div>`, true);
  m.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    const a = b.dataset.a, value = a.startsWith('badge') ? m.querySelector('#bd').value : a === 'role' ? m.querySelector('#rl').value : '';
    await api('/api/mod/action', { method: 'POST', body: { action: a, user_id: id, reason: m.querySelector('#mr').value, hours: +m.querySelector('#mh').value || 0, value } });
    toast('Done'); modUser(id);
  });
}

VIEWS.settings = () => {
  const th = THEMES[cfg.theme] || THEMES.Midnight;
  $('#page').innerHTML = `<div class="pg"><h2>Settings</h2>
    <h4>THEME</h4><div class="grid">${Object.entries(THEMES).map(([n, t]) => `<div class="game" data-th="${n}"><div class="cover" style="background:${t.ui.bg};border:2px solid ${t.accent}"></div><b>${n}</b></div>`).join('')}</div>
    <h4>ACCENT COLOR</h4><input type="color" id="ac" value="${cfg.accent || th.accent}">
    <h4>EDITOR</h4><label>Font size</label><input type="number" id="fs" min="10" max="32" value="${cfg.fontSize || 14}">
    <label>Font</label><select id="ff">${['Cascadia Code', 'Consolas', 'Fira Code', 'JetBrains Mono'].map(f => `<option ${f === cfg.font ? 'selected' : ''}>${f}</option>`).join('')}</select>
    <label class="chk"><input type="checkbox" id="mm" ${cfg.minimap !== false ? 'checked' : ''}>Minimap</label><label class="chk"><input type="checkbox" id="lg" ${cfg.lig ? 'checked' : ''}>Ligatures</label>
    <h4>SERVER</h4><input id="sv" value="${esc(S.server)}"><div class="row"><button class="btn" id="svb">Save server</button>${S.me ? '<button class="btn ghost" id="out">Sign out</button>' : ''}</div></div>`;
  const set = (k, v) => { cfg[k] = v; localStorage.cfg = JSON.stringify(cfg); applyTheme(); };
  $('#page').querySelectorAll('[data-th]').forEach(e => e.onclick = () => { delete cfg.accent; set('theme', e.dataset.th); VIEWS.settings(); });
  $('#ac').oninput = e => set('accent', e.target.value);
  $('#fs').onchange = e => set('fontSize', +e.target.value);
  $('#ff').onchange = e => set('font', e.target.value);
  $('#mm').onchange = e => set('minimap', e.target.checked);
  $('#lg').onchange = e => set('lig', e.target.checked);
  $('#svb').onclick = () => { S.server = $('#sv').value.replace(/\/$/, ''); localStorage.server = S.server; connect(); toast('Server updated'); };
  $('#out')?.addEventListener('click', () => { localStorage.removeItem('token'); S.token = ''; S.me = null; S.socket?.disconnect(); go('home'); });
};

/* ---------- integrated terminal ---------- */
const T = { term: null, fit: null, id: '', seq: 0, open: false, started: false, cwd: null, rt: 0 };
const canTerm = () => !!(window.native?.termCreate && window.Terminal && window.FitAddon);
const termTheme = () => {
  const c = getComputedStyle(document.documentElement), v = n => c.getPropertyValue(n).trim();
  return { background: v('--editor') || v('--bg'), foreground: v('--text'), cursor: v('--accent'), cursorAccent: v('--editor'), selectionBackground: v('--accent') + '55' };
};
function applyTermTheme() { if (T.term) { T.term.options.theme = termTheme(); T.term.options.fontFamily = `"${cfg.font || 'Cascadia Code'}", Consolas, monospace`; } }
function fitTerm() {
  if (!T.term || !T.open || $('#termBody').clientWidth < 20) return;
  try { T.fit.fit(); } catch {}
}
function initTerm() {
  if (T.term) return;
  T.term = new Terminal({ fontFamily: `"${cfg.font || 'Cascadia Code'}", Consolas, monospace`, fontSize: Math.max(11, (cfg.fontSize || 14) - 1), cursorBlink: true, scrollback: 5000, allowProposedApi: true, theme: termTheme() });
  T.fit = new FitAddon.FitAddon(); T.term.loadAddon(T.fit); T.term.open($('#termBody'));
  T.term.onData(d => native.termWrite(T.id, d));
  T.term.onResize(({ cols, rows }) => native.termResize(T.id, cols, rows));
  T.term.attachCustomKeyEventHandler(ev => {
    if (ev.type !== 'keydown') return true;
    if (ev.ctrlKey && ev.key === '`') { toggleTerminal(); return false; }
    const copy = (ev.ctrlKey && ev.key.toLowerCase() === 'c' && T.term.hasSelection()) || (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyC');
    if (copy) { navigator.clipboard.writeText(T.term.getSelection()); T.term.clearSelection(); return false; }
    return true;
  });
  native.onTermData((id, d) => { if (id === T.id) T.term.write(d); });
  native.onTermExit(id => { if (id === T.id) { T.started = false; T.term.write('\r\n\x1b[90m[shell exited - press the restart button]\x1b[0m\r\n'); } });
  new ResizeObserver(() => { clearTimeout(T.rt); T.rt = setTimeout(fitTerm, 30); }).observe($('#termBody'));
}
async function startShell(cwd) {
  initTerm();
  if (T.started) native.termKill(T.id);
  T.id = 't' + (++T.seq); T.cwd = cwd || S.folder; T.started = false;
  T.term.reset(); fitTerm();
  $('#tpath').textContent = baseOf(T.cwd); $('#tpath').title = T.cwd;
  try { await native.termCreate(T.id, T.cwd, T.term.cols, T.term.rows); T.started = true; }
  catch (e) { toast(errText(e)); }
}
function toggleTerminal(force) {
  if (!canTerm()) return toast(native?.isWeb ? 'The terminal is only in the desktop app.' : 'Terminal is not available.');
  const open = force ?? !T.open;
  if (open && !S.folder) return toast('Open a folder first');
  if (open && S.view !== 'editor') go('editor');
  T.open = open; $('#termPanel').hidden = !open; $('#tbtn')?.classList.toggle('on', open);
  if (open) { initTerm(); requestAnimationFrame(() => { fitTerm(); if (!T.started) startShell(S.folder); T.term.focus(); }); }
  else editor?.focus();
}
function openTermAt(dir) {
  if (!canTerm()) return;
  if (S.view !== 'editor') go('editor');
  T.open = true; $('#termPanel').hidden = false; $('#tbtn')?.classList.add('on'); initTerm();
  requestAnimationFrame(() => { fitTerm(); startShell(dir); T.term.focus(); });
}
function termFolderChanged() {   // a different project was opened: the shell follows it
  if (!T.term || !T.started) return;
  native.termKill(T.id); T.started = false;
  if (T.open) startShell(S.folder);
}
function setupTerminalUI() {
  const b = $('#tbtn'); if (!b) return;
  $('#termPanel').innerHTML = `<div id="termResize"></div><div class="th"><span>TERMINAL</span><span class="tpath" id="tpath"></span><span class="sp"></span>
    <button class="ib" id="tnew" title="Restart terminal">${ic('refresh', 14)}</button><button class="ib" id="tclose" title="Hide (Ctrl+\`)">${ic('x', 15)}</button></div><div id="termBody"></div>`;
  b.hidden = true; b.innerHTML = ic('terminal', 14) + '<span>Terminal</span>';
  b.onclick = () => toggleTerminal();
  $('#tclose').onclick = () => toggleTerminal(false);
  $('#tnew').onclick = () => startShell(S.folder);
  $('#termResize').onmousedown = e => {
    e.preventDefault();
    const y0 = e.clientY, h0 = $('#termPanel').offsetHeight;
    const move = ev => { $('#termPanel').style.height = Math.max(110, Math.min(innerHeight - 220, h0 + y0 - ev.clientY)) + 'px'; };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); fitTerm(); editor?.layout(); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  };
}

/* ---------- web: open / drag & drop (desktop never uses this) ---------- */
async function openIncoming(res) {
  if (!res?.root) return;
  if (S.folder === res.root) { go('editor'); await refreshTree(); }
  else await openFolder(res.root);
  for (const f of res.files || []) await openFile(f);
}
if (window.native?.fromDrop) {
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); document.body.classList.add('dropping'); }, true);
  addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); }, true);
  addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation(); document.body.classList.remove('dropping');
    native.fromDrop(e.dataTransfer).then(openIncoming).catch(err => toast(errText(err)));  // fromDrop reads the items synchronously
  }, true);
  addEventListener('beforeunload', e => { if (S.tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ''; } });
}

/* ---------- markdown (escapes everything first, so user content can't inject HTML) ---------- */
function md(src) {
  const code = [], keep = [];
  let t = esc(String(src).replace(/[\u0000\u0001]/g, '').replace(/\r\n?/g, '\n'));
  t = t.replace(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, (_, c) => `\u0000${code.push('<pre class="mdcode"><code>' + c.replace(/\n$/, '') + '</code></pre>') - 1}\u0000`);
  const inline = s => {
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0001${keep.push('<code>' + c + '</code>') - 1}\u0001`)
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/!?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a data-href="$2">$1</a>')   // images are shown as links
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a data-href="$2">$2</a>');
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => keep[+i]);
  };
  const lines = t.split('\n'), out = [], cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  let list = null, para = [];
  const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>` + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${list.t}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]; let m;
    if (/^\u0000\d+\u0000$/.test(ln.trim())) { flushP(); flushL(); out.push(ln.trim()); }
    else if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { flushP(); flushL(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flushP(); flushL(); out.push('<hr>'); }
    else if (ln.includes('|') && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      flushP(); flushL();
      const head = cells(ln); let rows = '';
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows += '<tr>' + cells(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
      i--; out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`);
    }
    else if ((m = ln.match(/^\s*[-*+]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
    else if ((m = ln.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); }
    else if ((m = ln.match(/^&gt;\s?(.*)$/))) { flushP(); flushL(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); }
    else if (!ln.trim()) { flushP(); flushL(); }
    else { flushL(); para.push(ln.trim()); }
  }
  flushP(); flushL();
  return out.join('\n').replace(/\u0000(\d+)\u0000/g, (_, i) => code[+i] ?? '');
}
const openLink = u => /^https?:\/\//i.test(u) && (native.openExternal ? native.openExternal(u) : window.open(u, '_blank', 'noopener'));
document.addEventListener('click', e => { const a = e.target.closest?.('a[data-href]'); if (a) { e.preventDefault(); openLink(a.dataset.href); } });

/* ---------- repository page (GitHub style) ---------- */
const RV = { data: null, dir: '', file: null, raw: false, t: 0 };
const joinRel = (a, b) => a ? a + '/' + b : b;
const parentRel = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const readmeIn = names => names.find(n => n.toLowerCase() === 'readme.md');
function listDir(files, dir) {
  const pre = dir ? dir + '/' : '', dirs = new Set(), fl = [];
  for (const f of files) if (f.startsWith(pre)) { const rest = f.slice(pre.length), i = rest.indexOf('/'); i < 0 ? fl.push(rest) : dirs.add(rest.slice(0, i)); }
  const by = (a, b) => a.localeCompare(b);
  return { dirs: [...dirs].sort(by), files: fl.sort(by) };
}
async function repoText(id, p) {
  const r = await fetch(`${S.server}/api/repos/${id}/file?path=${encodeURIComponent(p)}`, { headers: { Authorization: 'Bearer ' + S.token } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Cannot load file');
  return r.text();
}
VIEWS.repo = async id => {
  RV.data = await api('/api/repos/' + id); RV.dir = ''; RV.file = null; RV.raw = false;
  drawRepo();
};
function repoHead(r) {
  const parts = (RV.file ? parentRel(RV.file) : RV.dir).split('/').filter(Boolean);
  const crumbs = [`<a data-d="">${esc(r.name)}</a>`, ...parts.map((p, i) => `<a data-d="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</a>`), ...(RV.file ? [`<b>${esc(baseOf(RV.file))}</b>`] : [])];
  const mine = r.user_id === S.me.id, canDelete = mine || RANK[S.me.role] >= 1;
  return `<div class="gh-top">${ic('folder', 22)}<a data-u="${esc(r.username)}">${esc(r.username)}</a><span class="muted">/</span><b>${esc(r.name)}</b>
      <span class="sp"></span><button class="btn ghost sm" id="rp">Report</button>${canDelete ? '<button class="btn ghost sm" id="dl">Delete</button>' : ''}</div>
    ${r.description ? `<p class="muted gh-desc">${esc(r.description)}</p>` : ''}
    <div class="gh-bar"><div class="crumbs">${crumbs.join('<span class="muted"> / </span>')}</div><span class="sp"></span><span class="muted">${r.files.length} file${r.files.length === 1 ? '' : 's'}</span></div>`;
}
function wireRepo() {
  const r = RV.data, pg = $('#page');
  pg.onclick = e => {
    const u = e.target.closest('[data-u]'), d = e.target.closest('[data-d]'), f = e.target.closest('[data-f]');
    if (u) return go('profile', u.dataset.u);
    if (d) { RV.dir = d.dataset.d; RV.file = null; return drawRepo(); }
    if (f) { RV.file = f.dataset.f; RV.dir = parentRel(RV.file); RV.raw = false; return drawFile(); }
  };
  $('#rp').onclick = () => report(r.user_id, 'repo', String(r.id));
  $('#dl')?.addEventListener('click', async () => {
    if (!confirm('Delete this repository?')) return;
    await api('/api/repos/' + r.id, { method: 'DELETE' }); go('profile', r.username);
  });
}
async function drawRepo() {
  const r = RV.data, mine = r.user_id === S.me.id, tok = ++RV.t;
  const { dirs, files } = listDir(r.files, RV.dir), rn = readmeIn(files);
  const row = (attr, val, icon, name) => `<div class="gh-row" ${attr}="${esc(val)}">${icon}<span class="nm">${esc(name)}</span></div>`;
  $('#page').innerHTML = `<div class="gh">${repoHead(r)}
    <div class="gh-box">
      ${RV.dir ? row('data-d', parentRel(RV.dir), `<span class="fi" style="color:var(--accent)">${ic('folder', 16)}</span>`, '..') : ''}
      ${dirs.map(d => row('data-d', joinRel(RV.dir, d), fileIcon({ dir: true }), d)).join('')}
      ${files.map(f => row('data-f', joinRel(RV.dir, f), fileIcon({ name: f }), f)).join('')}
      ${!dirs.length && !files.length ? '<div class="empty">Empty folder</div>' : ''}
    </div><div id="readme"></div></div>`;
  wireRepo();
  const box = $('#readme');
  if (rn) {
    try {
      const text = await repoText(r.id, joinRel(RV.dir, rn));
      if (tok !== RV.t || !$('#readme')) return;
      box.innerHTML = `<div class="gh-box"><div class="gh-hd">${ic('book', 16)}<span>${esc(rn)}</span></div><div class="md">${md(text)}</div></div>`;
    } catch (e) { if (tok === RV.t && $('#readme')) box.innerHTML = `<p class="muted">Could not load ${esc(rn)}: ${esc(e.message)}</p>`; }
  } else if (!RV.dir) {
    box.innerHTML = mine
      ? `<div class="gh-box gh-note">${ic('book', 18)}<div><b>Add a README.md</b><p class="muted">Put a file named README.md in the root of this repository and it will be shown right here, like on GitHub.</p></div></div>`
      : '<p class="muted gh-nr">This repository has no README.md.</p>';
  }
}
async function drawFile() {
  const r = RV.data, p = RV.file, name = baseOf(p), isMd = /\.md$/i.test(name), tok = ++RV.t;
  $('#page').innerHTML = `<div class="gh">${repoHead(r)}<div class="gh-box"><div class="gh-hd"><span class="nm">${esc(name)}</span><span class="sp"></span><span id="finfo" class="muted"></span>
    ${isMd ? '<button class="btn ghost sm" id="tg"></button>' : ''}<button class="btn ghost sm" id="cp">Copy</button></div><div id="fbody" class="fbody"><div class="empty">Loading…</div></div></div></div>`;
  wireRepo();
  let text;
  try { text = await repoText(r.id, p); }
  catch (e) { if (tok === RV.t && $('#fbody')) $('#fbody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (tok !== RV.t || !$('#fbody')) return;
  const n = text.split('\n').length;
  $('#finfo').textContent = `${n} lines · ${(new Blob([text]).size / 1024).toFixed(1)} KB`;
  $('#cp').onclick = () => navigator.clipboard.writeText(text).then(() => toast('Copied'));
  const show = async () => {
    if (isMd) $('#tg').textContent = RV.raw ? 'Preview' : 'Code';
    if (isMd && !RV.raw) { $('#fbody').innerHTML = `<div class="md">${md(text)}</div>`; return; }
    let html = esc(text).replace(/\n$/, '');
    if (n <= 3000) { try { await monacoReady; html = (await monaco.editor.colorize(text, langFor(name), { tabSize: 4 })).replace(/(<br\/>)+$/, ''); } catch {} }
    if (tok !== RV.t || !$('#fbody')) return;
    $('#fbody').innerHTML = `<div class="code"><pre class="ln">${Array.from({ length: n }, (_, i) => i + 1).join('\n')}</pre><pre class="src">${html}</pre></div>`;
  };
  if (isMd) $('#tg').onclick = () => { RV.raw = !RV.raw; show(); };
  show();
}
function repoViewer(id) { go('repo', id); }

/* ---------- start ---------- */
(async function init() {
  buildSkeleton(); setupTerminalUI(); applyTheme();
  if (S.token) {
    try { S.me = await api('/api/me'); connect(); loadFriends(); }
    catch { S.token = ''; localStorage.removeItem('token'); }
  }
  go('home');
})();