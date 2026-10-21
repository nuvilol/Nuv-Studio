const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs'), path = require('path');
const { spawn, execFile } = require('child_process');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);

/* ---------- files ---------- */
function collect(root, dir = root, out = [], st = { total: 0 }) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { collect(root, full, out, st); continue; }
    const size = fs.statSync(full).size;
    if (size > 1e6 || st.total + size > 20e6) continue;
    st.total += size;
    out.push({ path: path.relative(root, full).split(path.sep).join('/'), data: fs.readFileSync(full).toString('base64') });
  }
  return out;
}

ipcMain.handle('listFiles', (_, root) => {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name) || out.length > 5000) continue;
      const f = path.join(d, e.name);
      e.isDirectory() ? walk(f) : out.push(path.relative(root, f).split(path.sep).join('/'));
    }
  })(root);
  return out;
});
ipcMain.handle('createFile', (_, p) => {
  if (fs.existsSync(p)) throw new Error('Already exists');
  fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); return true;
});
ipcMain.handle('createDir', (_, p) => {
  if (fs.existsSync(p)) throw new Error('Already exists');
  fs.mkdirSync(p, { recursive: true }); return true;
});
ipcMain.handle('rename', (_, a, b) => {
  if (fs.existsSync(b) && a.toLowerCase() !== b.toLowerCase()) throw new Error('Already exists');
  fs.renameSync(a, b); return true;
});
ipcMain.handle('remove', (_, p) => shell.trashItem(p)); // Recycle Bin, not permanent
ipcMain.handle('reveal', (_, p) => shell.showItemInFolder(p));
ipcMain.handle('overlay', (e, color, symbolColor) => {
  try { BrowserWindow.fromWebContents(e.sender).setTitleBarOverlay({ color, symbolColor, height: 32 }); } catch {}
});
ipcMain.handle('pickFolder', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('readDir', (_, d) => fs.readdirSync(d, { withFileTypes: true })
  .filter(e => !SKIP.has(e.name))
  .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
  .map(e => ({ name: e.name, path: path.join(d, e.name), dir: e.isDirectory() })));
ipcMain.handle('readFile', (_, f) => {
  if (fs.statSync(f).size > 5e6) throw new Error('File too big');
  return fs.readFileSync(f, 'utf8');
});
ipcMain.handle('writeFile', (_, f, t) => { fs.writeFileSync(f, t); return true; });
ipcMain.handle('collectRepo', (_, root) => collect(root));
// links inside READMEs etc. open in the real browser, never inside the app window
ipcMain.handle('openExternal', (_, url) => { if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url)); });

/* ---------- integrated terminal (PowerShell) ----------
   Full terminal when a pty module is installed (npm i @lydell/node-pty).
   Otherwise falls back to a "basic" PowerShell session over pipes, so the terminal always works. */
let ptyLib = null;
for (const n of ['@lydell/node-pty', 'node-pty']) { try { ptyLib = require(n); break; } catch {} }
const IS_WIN = process.platform === 'win32';
const terms = new Map(); // id -> { write, resize, kill }
const shellInfo = () => IS_WIN
  ? { file: 'powershell.exe', args: ['-NoLogo'], ps: true }
  : { file: process.env.SHELL || '/bin/bash', args: [], ps: false };

function killTree(c) {
  if (!c) return;
  if (IS_WIN) execFile('taskkill', ['/pid', String(c.pid), '/T', '/F'], () => {});
  else { try { c.kill('SIGKILL'); } catch {} }
}

function ptySession(info, cwd, cols, rows, out, done) {
  const p = ptyLib.spawn(info.file, info.args, { name: 'xterm-256color', cols, rows, cwd, env: process.env });
  p.onData(out);
  p.onExit(e => done(e.exitCode));
  return {
    write: d => p.write(d),
    resize: (c, r) => { try { p.resize(c, r); } catch {} },
    kill: () => { try { p.kill(); } catch {} }
  };
}

function pipeSession(info, cwd, cols, rows, out, done) {
  const MARK = '__NUV_PROMPT__';
  const probe = info.ps ? `Write-Output ('${MARK}' + (Get-Location).Path)` : `echo "${MARK}$PWD"`;
  let child = null, buf = '', line = '', where = cwd, dead = false;
  const hist = []; let hi = 0;
  const prompt = () => out(`\x1b[32m${info.ps ? 'PS ' : ''}${where}${info.ps ? '>' : '$'}\x1b[0m `);

  // stdout arrives as text; swallow the marker line and print a prompt in its place
  function feed(text) {
    buf += text.replace(/\r?\n/g, '\r\n');
    for (;;) {
      const i = buf.indexOf(MARK);
      if (i >= 0) {
        const j = buf.indexOf('\r\n', i);
        if (j < 0) { if (i) out(buf.slice(0, i)); buf = buf.slice(i); return; }
        if (i) out(buf.slice(0, i));
        where = buf.slice(i + MARK.length, j) || where;
        buf = buf.slice(j + 2); prompt(); continue;
      }
      let k = Math.min(buf.length, MARK.length - 1);
      while (k > 0 && !MARK.startsWith(buf.slice(-k))) k--;
      const emit = buf.slice(0, buf.length - k);
      if (emit) out(emit);
      buf = buf.slice(buf.length - k); return;
    }
  }
  function start() {
    const c = child = spawn(info.file, info.ps ? ['-NoLogo', '-NoProfile', '-Command', '-'] : [], { cwd: where, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    c.stdout.setEncoding('utf8'); c.stderr.setEncoding('utf8');
    c.stdout.on('data', feed);
    c.stderr.on('data', d => out('\x1b[31m' + d.replace(/\r?\n/g, '\r\n') + '\x1b[0m'));
    c.stdin.on('error', () => {});
    c.on('error', err => out(`\x1b[31m${err.message}\x1b[0m\r\n`));
    c.on('exit', code => { if (c !== child || dead) return; dead = true; done(code); });
    if (info.ps) c.stdin.write('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n');
    c.stdin.write(probe + '\n');
  }
  function restart() { const old = child; child = null; killTree(old); start(); }
  function run(cmd) {
    if (cmd.trim()) hist.push(cmd);
    hi = hist.length;
    child?.stdin.write(cmd + '\n' + probe + '\n');
  }
  function input(data) {
    for (const tok of data.match(/\x1b\[[0-9;?]*[@-~]|\x1b[\s\S]?|[\s\S]/gu) || []) {
      if (tok === '\r' || tok === '\n') { out('\r\n'); const l = line; line = ''; run(l); }
      else if (tok === '\x7f' || tok === '\b') { if (line) { line = [...line].slice(0, -1).join(''); out('\b \b'); } }
      else if (tok === '\x03') { out('^C\r\n'); line = ''; restart(); }           // Ctrl+C restarts the shell
      else if (tok === '\x15') { out('\b \b'.repeat([...line].length)); line = ''; } // Ctrl+U
      else if (tok === '\x1b[A' || tok === '\x1b[B') {                              // history
        if (!hist.length) continue;
        hi = Math.max(0, Math.min(hist.length, hi + (tok === '\x1b[A' ? -1 : 1)));
        out('\b \b'.repeat([...line].length)); line = hist[hi] ?? ''; out(line);
      }
      else if (tok >= ' ') { line += tok; out(tok); }
    }
  }
  out('\x1b[90mBasic terminal mode. For a full terminal run: npm install @lydell/node-pty\x1b[0m\r\n');
  start();
  return { write: input, resize() {}, kill() { dead = true; const c = child; child = null; killTree(c); } };
}

ipcMain.handle('termCreate', (e, id, cwd, cols, rows) => {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('Folder does not exist');
  terms.get(id)?.kill(); terms.delete(id);
  const wc = e.sender, info = shellInfo();
  cols = Math.max(2, cols | 0 || 80); rows = Math.max(1, rows | 0 || 24);
  let s;
  const out = d => { if (!wc.isDestroyed()) wc.send('termData', id, d); };
  const done = code => { if (terms.get(id) === s) terms.delete(id); if (!wc.isDestroyed()) wc.send('termExit', id, code); };
  let mode = 'pty';
  try {
    if (!ptyLib) throw new Error('no pty');
    s = ptySession(info, cwd, cols, rows, out, done);
  } catch {
    mode = 'basic';
    s = pipeSession(info, cwd, cols, rows, out, done);
  }
  terms.set(id, s);
  return { mode };
});
ipcMain.on('termWrite', (_, id, d) => terms.get(id)?.write(String(d)));
ipcMain.on('termResize', (_, id, c, r) => terms.get(id)?.resize(Math.max(2, c | 0), Math.max(1, r | 0)));
ipcMain.on('termKill', (_, id) => { terms.get(id)?.kill(); terms.delete(id); });
app.on('before-quit', () => { for (const s of terms.values()) s.kill(); terms.clear(); });

/* ---------- window ---------- */
app.whenReady().then(() => {
  console.log('PRELOAD PATH:', path.join(__dirname, 'preload.js'), 'exists:', fs.existsSync(path.join(__dirname, 'preload.js')));
  console.log('Terminal mode:', ptyLib ? 'pty' : 'basic (npm i @lydell/node-pty for a full terminal)');
  const win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 900, minHeight: 600,
    backgroundColor: '#111318',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d11', symbolColor: '#9aa4b2', height: 32 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile('index.html');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  win.webContents.on('preload-error', (_, p, err) => console.error('PRELOAD ERROR:', p, err));
  win.webContents.on('before-input-event', (_, i) => {
    if (i.type === 'keyDown' && (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i'))) win.webContents.toggleDevTools();
  });
});