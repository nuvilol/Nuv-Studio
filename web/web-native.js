/* Browser version of the `native` bridge that preload.js provides on desktop.
   renderer.js is shared; it just talks to window.native.

   Folders/files are opened by picking or dragging them in:
   - Chrome / Edge (File System Access API): real read AND write to the folder on your disk.
   - Firefox / Safari (or drops without handles): files are copied into browser memory;
     edits stay in the page (right-click a file > Download to keep it).
   Paths look like  /<folder name>/sub/file.js  */
(() => {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '__pycache__']);
  const LOOSE = 'Open files';
  const roots = new Map();
  const abort = e => e && e.name === 'AbortError';
  const base = p => p.split('/').pop();
  const newRoot = (name, handle = null) => ({ name, handle, files: new Map(), handles: new Map(), dirs: new Set() });

  /* ----- path helpers ----- */
  function parse(p) {
    const all = String(p).split('/').filter(Boolean), root = roots.get(all[0]);
    if (!root) throw new Error('That folder is no longer open. Open it again.');
    const parts = all.slice(1);
    return { root, parts, rel: parts.join('/') };
  }
  const addDirs = (root, parts) => { for (let i = 1; i <= parts.length; i++) root.dirs.add(parts.slice(0, i).join('/')); };
  const under = (k, rel) => k === rel || k.startsWith(rel + '/');

  /* ----- real folder (File System Access API) ----- */
  async function rw(h) {
    try { if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') await h.requestPermission({ mode: 'readwrite' }); } catch {}
  }
  async function hDir(root, parts, create = false) { let h = root.handle; for (const n of parts) h = await h.getDirectoryHandle(n, { create }); return h; }
  async function hFile(root, parts, create = false) { return (await hDir(root, parts.slice(0, -1), create)).getFileHandle(parts[parts.length - 1], { create }); }
  async function hExists(root, parts) {
    if (!parts.length) return true;
    const dir = await hDir(root, parts.slice(0, -1)).catch(() => null);
    if (!dir) return false;
    const n = parts[parts.length - 1];
    return !!((await dir.getFileHandle(n).catch(() => null)) || (await dir.getDirectoryHandle(n).catch(() => null)));
  }
  async function hWrite(fh, data) { await rw(fh); const w = await fh.createWritable(); await w.write(data); await w.close(); }
  async function hCopy(src, dst) {
    for await (const [n, h] of src.entries()) {
      if (h.kind === 'file') await hWrite(await dst.getFileHandle(n, { create: true }), await h.getFile());
      else await hCopy(h, await dst.getDirectoryHandle(n, { create: true }));
    }
  }

  /* ----- in-memory folder ----- */
  function memList(root, rel) {
    const pre = rel ? rel + '/' : '', seen = new Map();
    const add = k => { if (!k.startsWith(pre) || k === rel) return; const rest = k.slice(pre.length), i = rest.indexOf('/'); seen.set(i < 0 ? rest : rest.slice(0, i), i >= 0); };
    for (const k of root.files.keys()) add(k);
    for (const d of root.dirs) { add(d); if (d.startsWith(pre) && d !== rel) seen.set(d.slice(pre.length).split('/')[0], true); }
    return [...seen].map(([name, dir]) => ({ name, dir }));
  }
  const mExists = (root, rel) => !!rel && ([...root.files.keys()].some(k => under(k, rel)) || [...root.dirs].some(k => under(k, rel)));
  const exists = (root, parts, rel) => root.handle ? hExists(root, parts) : Promise.resolve(mExists(root, rel));

  /* ----- the bridge ----- */
  async function readDir(p) {
    const { root, parts, rel } = parse(p);
    let items = [];
    if (root.handle) for await (const [name, h] of (await hDir(root, parts)).entries()) items.push({ name, dir: h.kind === 'directory' });
    else items = memList(root, rel);
    return items.filter(i => !SKIP.has(i.name))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name))
      .map(i => ({ ...i, path: p.replace(/\/$/, '') + '/' + i.name }));
  }
  async function blobOf(p) {
    const { root, parts, rel } = parse(p);
    if (root.handle) return (await hFile(root, parts)).getFile();
    return root.handles.has(rel) ? root.handles.get(rel).getFile() : root.files.get(rel);
  }
  async function readFile(p) {
    const blob = await blobOf(p);
    if (!blob) throw new Error('File not found');
    if (blob.size > 5e6) throw new Error('File too big');
    return blob.text();
  }
  async function writeFile(p, text) {
    const { root, parts, rel } = parse(p);
    if (root.handle) { await hWrite(await hFile(root, parts), text); return true; }
    if (root.handles.has(rel)) { await hWrite(root.handles.get(rel), text); root.files.set(rel, new Blob([text])); return true; }
    root.files.set(rel, new Blob([text]));
    return 'mem';
  }
  async function createFile(p) {
    const { root, parts, rel } = parse(p);
    if (await exists(root, parts, rel)) throw new Error('Already exists');
    if (root.handle) await hFile(root, parts, true);
    else { root.files.set(rel, new Blob([''])); addDirs(root, parts.slice(0, -1)); }
    return true;
  }
  async function createDir(p) {
    const { root, parts, rel } = parse(p);
    if (await exists(root, parts, rel)) throw new Error('Already exists');
    if (root.handle) await hDir(root, parts, true); else addDirs(root, parts);
    return true;
  }
  async function rename(a, b) {
    const A = parse(a), B = parse(b);
    if (A.root !== B.root) throw new Error('Cannot move between different folders');
    if (a !== b && a.toLowerCase() === b.toLowerCase()) { const tmp = a + '.__nuv_tmp'; await rename(a, tmp); return rename(tmp, b); }  // case-only rename
    if (await exists(B.root, B.parts, B.rel)) throw new Error('Already exists');
    const root = A.root;
    if (root.handle) {
      const parent = await hDir(root, A.parts.slice(0, -1)), name = A.parts[A.parts.length - 1];
      const newParent = await hDir(root, B.parts.slice(0, -1), true), newName = B.parts[B.parts.length - 1];
      if (await parent.getDirectoryHandle(name).then(() => true, () => false)) await hCopy(await parent.getDirectoryHandle(name), await newParent.getDirectoryHandle(newName, { create: true }));
      else await hWrite(await newParent.getFileHandle(newName, { create: true }), await (await parent.getFileHandle(name)).getFile());
      await parent.removeEntry(name, { recursive: true });
    } else {
      if ([...root.handles.keys()].some(k => under(k, A.rel))) throw new Error('Files opened from your computer can\'t be renamed here');
      const mv = k => k === A.rel ? B.rel : B.rel + k.slice(A.rel.length);
      for (const k of [...root.files.keys()]) if (under(k, A.rel)) { root.files.set(mv(k), root.files.get(k)); root.files.delete(k); }
      for (const k of [...root.dirs]) if (under(k, A.rel)) { root.dirs.delete(k); root.dirs.add(mv(k)); }
      addDirs(root, B.parts.slice(0, -1));
    }
    return true;
  }
  async function remove(p) {
    const { root, parts, rel } = parse(p);
    if (!parts.length) throw new Error('Cannot remove the root folder');
    if (root.handle) { await (await hDir(root, parts.slice(0, -1))).removeEntry(parts[parts.length - 1], { recursive: true }); return true; }
    if ([...root.handles.keys()].some(k => under(k, rel))) throw new Error('This file was opened from your computer, so it can\'t be deleted here. Close its tab instead.');
    for (const k of [...root.files.keys()]) if (under(k, rel)) root.files.delete(k);
    for (const k of [...root.dirs]) if (under(k, rel)) root.dirs.delete(k);
    return true;
  }
  async function listFiles(p) {
    const out = [];
    const walk = async (dir, rel) => {
      for (const it of await readDir(dir)) {
        if (out.length > 5000) return;
        const r = rel ? rel + '/' + it.name : it.name;
        it.dir ? await walk(it.path, r) : out.push(r);
      }
    };
    await walk(p, '');
    return out;
  }
  const b64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(blob); });
  async function collectRepo(p) {
    const out = []; let total = 0;
    for (const rel of await listFiles(p)) {
      const blob = await blobOf(p.replace(/\/$/, '') + '/' + rel);
      if (!blob || blob.size > 1e6 || total + blob.size > 20e6) continue;
      total += blob.size;
      out.push({ path: rel, data: await b64(blob) });
    }
    return out;
  }
  async function download(p) {
    const blob = await blobOf(p);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = base(p); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ----- opening things: picker + drag & drop ----- */
  function addHandleRoot(h) {
    const name = h.name === LOOSE ? LOOSE + ' (folder)' : (h.name || 'folder');
    roots.set(name, newRoot(name, h));
    return '/' + name;
  }
  function addMemoryRoot(top, files) {           // files: [{ rel: 'top/sub/a.js', file }]
    const name = top === LOOSE ? LOOSE + ' (folder)' : top, root = newRoot(name);
    for (const { rel, file } of files) {
      const r = rel.split('/').slice(1).join('/');
      if (!r || r.split('/').some(s => SKIP.has(s))) continue;
      root.files.set(r, file); addDirs(root, r.split('/').slice(0, -1));
    }
    roots.set(name, root);
    return '/' + name;
  }
  function addLoose(items) {                     // items: [{ name, file, handle? }]
    if (!items.length) return null;
    let r = roots.get(LOOSE); if (!r) roots.set(LOOSE, r = newRoot(LOOSE));
    const files = [];
    for (const { name, file, handle } of items) {
      r.files.set(name, file);
      handle ? r.handles.set(name, handle) : r.handles.delete(name);
      files.push('/' + LOOSE + '/' + name);
    }
    return { root: '/' + LOOSE, files };
  }
  function chooseFiles({ dir = false } = {}) {   // classic <input> picker (works in every browser)
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.multiple = true; if (dir) i.webkitdirectory = true; i.style.display = 'none';
      document.body.appendChild(i);
      const done = v => { i.remove(); res(v); };
      i.onchange = () => done([...i.files].map(f => ({ rel: f.webkitRelativePath || f.name, file: f })));
      i.addEventListener('cancel', () => done([]));
      i.click();
    });
  }
  async function pickFolder() {
    if (window.showDirectoryPicker) {
      try { return addHandleRoot(await showDirectoryPicker({ mode: 'readwrite' })); }
      catch (e) { if (abort(e)) return null; throw e; }
    }
    const files = await chooseFiles({ dir: true });
    return files.length ? addMemoryRoot(files[0].rel.split('/')[0], files) : null;
  }
  async function pickFiles() {
    if (window.showOpenFilePicker) {
      try {
        const hs = await showOpenFilePicker({ multiple: true });
        return addLoose(await Promise.all(hs.map(async h => ({ name: h.name, file: await h.getFile(), handle: h }))));
      } catch (e) { if (abort(e)) return null; throw e; }
    }
    return addLoose((await chooseFiles()).map(x => ({ name: x.file.name, file: x.file })));
  }
  async function readEntry(entry, prefix = '') {  // webkit FileSystemEntry (Firefox / Safari drops)
    const out = [], rel = prefix + entry.name;
    if (entry.isFile) { out.push({ rel, file: await new Promise((ok, no) => entry.file(ok, no)) }); return out; }
    if (SKIP.has(entry.name)) return out;
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
      if (!batch.length) break;
      for (const e of batch) out.push(...await readEntry(e, rel + '/'));
    }
    return out;
  }
  async function fromDrop(dt) {
    // DataTransfer items stop working after the first await, so grab everything synchronously
    const items = [...dt.items].filter(i => i.kind === 'file').map(i => ({
      handle: i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null),
      entry: i.webkitGetAsEntry ? i.webkitGetAsEntry() : null,
      file: i.getAsFile(),
    }));
    const got = await Promise.all(items.map(async x => ({ ...x, handle: await x.handle })));
    const isDir = x => (x.handle && x.handle.kind === 'directory') || (x.entry && x.entry.isDirectory);
    const dirs = got.filter(isDir), files = got.filter(x => !isDir(x));
    if (dirs.length === 1 && !files.length) {
      const d = dirs[0];
      if (d.handle) { await rw(d.handle); return { root: addHandleRoot(d.handle), files: [] }; }
      return { root: addMemoryRoot(d.entry.name, await readEntry(d.entry)), files: [] };
    }
    if (dirs.length) throw new Error('Drop one folder at a time, or only files.');
    if (!files.length) return null;
    return addLoose(files.map(x => ({ name: (x.handle && x.handle.name) || x.file.name, file: x.file, handle: x.handle && x.handle.kind === 'file' ? x.handle : null })));
  }

  window.native = {
    isWeb: true, permanentDelete: true,
    pickFolder, pickFiles, fromDrop,
    readDir, readFile, writeFile, listFiles, collectRepo, createFile, createDir, rename, remove, download,
    openExternal: url => { if (/^https?:\/\//i.test(String(url))) window.open(String(url), '_blank', 'noopener'); },
    overlay: async () => {},
  };
})();