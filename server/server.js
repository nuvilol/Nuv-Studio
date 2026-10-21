const express = require('express'), http = require('http'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const cors = require('cors'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), multer = require('multer');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA, 'media'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'repos'), { recursive: true });
const secretFile = path.join(DATA, 'secret.txt');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
const SECRET = fs.readFileSync(secretFile, 'utf8');

const app = express(), server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const online = new Map();
app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use('/media', express.static(path.join(DATA, 'media'), { setHeaders: r => r.set('X-Content-Type-Options', 'nosniff') }));

const db = new Database(path.join(DATA, 'app.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, hash TEXT, role TEXT DEFAULT 'user', created INTEGER,
  bio TEXT DEFAULT '', status TEXT DEFAULT '', avatar TEXT DEFAULT '', banner TEXT DEFAULT '',
  accent TEXT DEFAULT '#5b8cff', effect TEXT DEFAULT 'aurora', card TEXT DEFAULT 'glass', shown TEXT DEFAULT '[]',
  banned INTEGER DEFAULT 0, ban_reason TEXT DEFAULT '', ban_until INTEGER DEFAULT 0,
  sban INTEGER DEFAULT 0, sban_reason TEXT DEFAULT '', sban_until INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS badges(user_id INTEGER, badge TEXT, PRIMARY KEY(user_id, badge));
CREATE TABLE IF NOT EXISTS friends(a INTEGER, b INTEGER, status TEXT, PRIMARY KEY(a, b));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, from_id INTEGER, to_id INTEGER, text TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS repos(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, description TEXT DEFAULT '', created INTEGER);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, reporter_id INTEGER, target_id INTEGER, kind TEXT, ref TEXT, reason TEXT,
  status TEXT DEFAULT 'open', note TEXT DEFAULT '', handled_by INTEGER, created INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT, target_id INTEGER, detail TEXT, created INTEGER);
`);

const now = () => Date.now();
const RANK = { user: 0, mod: 1, admin: 2, owner: 3 };
const MANUAL = ['founder', 'dev', 'bug', 'supporter', 'verified'];
const isBanned = u => u.banned && (!u.ban_until || u.ban_until > now());
const isSBanned = u => u.sban && (!u.sban_until || u.sban_until > now());
const getUser = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const log = (actor, action, target, detail = '') =>
  db.prepare('INSERT INTO audit(actor_id,action,target_id,detail,created) VALUES(?,?,?,?,?)').run(actor, action, target, detail, now());

function badgesOf(u) {
  const list = ['member-' + new Date(u.created).getFullYear()];
  if (u.role !== 'user') list.push(u.role);
  db.prepare('SELECT badge FROM badges WHERE user_id=?').all(u.id).forEach(r => list.push(r.badge));
  return [...new Set(list)];
}
const pub = u => ({
  id: u.id, username: u.username, role: u.role, created: u.created, bio: u.bio, status: u.status,
  avatar: u.avatar, banner: u.banner, accent: u.accent, effect: u.effect, card: u.card,
  badges: badgesOf(u), shown: JSON.parse(u.shown || '[]'), sbanned: !!isSBanned(u), online: online.has(u.id)
});

const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
function auth(req, res, next) {
  try {
    const { id } = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    const u = getUser(id);
    if (!u) throw new Error('no user');
    if (isBanned(u)) return res.status(403).json({ error: 'banned', reason: u.ban_reason });
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Not signed in' }); }
}
const need = role => (req, res, next) => RANK[req.user.role] >= RANK[role] ? next() : res.status(403).json({ error: 'No permission' });
const social = (req, res, next) => isSBanned(req.user) ? res.status(403).json({ error: 'You are social banned: ' + (req.user.sban_reason || 'no reason given') }) : next();

// ---------- accounts ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '') || (password || '').length < 6)
    return res.status(400).json({ error: 'Username: 3-20 letters/numbers/_ . Password: 6+ characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(400).json({ error: 'Username taken' });
  const r = db.prepare('INSERT INTO users(username,hash,role,created) VALUES(?,?,?,?)').run(username, bcrypt.hashSync(password, 10), 'user', now());
  const u = getUser(r.lastInsertRowid);
  res.json({ token: sign(u), user: pub(u) });
});
app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username || '');
  if (!u || !bcrypt.compareSync(req.body.password || '', u.hash)) return res.status(400).json({ error: 'Wrong username or password' });
  if (isBanned(u)) return res.status(403).json({ error: 'Banned: ' + (u.ban_reason || 'no reason given') });
  res.json({ token: sign(u), user: pub(u) });
});
app.get('/api/me', auth, (req, res) => res.json(pub(req.user)));

// ---------- profiles ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA, 'media'),
    filename: (req, f, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(f.originalname).toLowerCase())
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /\.(png|jpe?g|gif|webp)$/i.test(f.originalname))
});
app.put('/api/profile', auth, social, upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), (req, res) => {
  const b = req.body || {}, u = req.user, f = req.files || {};
  let shown; try { shown = JSON.parse(b.shown).filter(x => badgesOf(u).includes(x)).slice(0, 8); } catch { shown = JSON.parse(u.shown); }
  db.prepare('UPDATE users SET bio=?,status=?,accent=?,effect=?,card=?,shown=?,avatar=?,banner=? WHERE id=?').run(
    String(b.bio ?? u.bio).slice(0, 500), String(b.status ?? u.status).slice(0, 80),
    /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : u.accent,
    ['none', 'aurora', 'stars', 'gradient', 'grid'].includes(b.effect) ? b.effect : u.effect,
    ['glass', 'solid', 'neon'].includes(b.card) ? b.card : u.card,
    JSON.stringify(shown),
    f.avatar ? '/media/' + f.avatar[0].filename : u.avatar,
    f.banner ? '/media/' + f.banner[0].filename : u.banner, u.id);
  res.json(pub(getUser(u.id)));
});
app.get('/api/users', auth, (req, res) =>
  res.json(db.prepare('SELECT * FROM users WHERE username LIKE ? AND banned=0 LIMIT 30').all('%' + (req.query.q || '') + '%').map(pub)));
app.get('/api/users/:name', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.params.name);
  if (!u || (isBanned(u) && RANK[req.user.role] < 1)) return res.status(404).json({ error: 'User not found' });
  const repos = db.prepare('SELECT id,name,description,created FROM repos WHERE user_id=? ORDER BY created DESC').all(u.id);
  const fr = db.prepare('SELECT * FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)').get(req.user.id, u.id, u.id, req.user.id);
  res.json({ ...pub(u), repos, friendship: fr ? { status: fr.status, incoming: fr.b === req.user.id } : null });
});

// ---------- friends ----------
app.get('/api/friends', auth, (req, res) => {
  const id = req.user.id;
  res.json(db.prepare('SELECT * FROM friends WHERE a=? OR b=?').all(id, id)
    .map(r => ({ ...pub(getUser(r.a === id ? r.b : r.a)), status: r.status, incoming: r.b === id })));
});
app.post('/api/friends/:id', auth, social, (req, res) => {
  const me = req.user.id, other = +req.params.id;
  if (me === other || !getUser(other)) return res.status(400).json({ error: 'Invalid user' });
  if (db.prepare('SELECT 1 FROM friends WHERE a=? AND b=?').get(other, me))
    db.prepare("UPDATE friends SET status='accepted' WHERE a=? AND b=?").run(other, me);
  else db.prepare("INSERT OR IGNORE INTO friends VALUES(?,?,'pending')").run(me, other);
  io.to('u:' + other).emit('friends:update');
  res.json({ ok: true });
});
app.delete('/api/friends/:id', auth, (req, res) => {
  const me = req.user.id, o = +req.params.id;
  db.prepare('DELETE FROM friends WHERE (a=? AND b=?) OR (a=? AND b=?)').run(me, o, o, me);
  io.to('u:' + o).emit('friends:update');
  res.json({ ok: true });
});

// ---------- messages ----------
app.get('/api/messages/:id', auth, (req, res) => {
  const me = req.user.id, o = +req.params.id;
  res.json(db.prepare('SELECT * FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id DESC LIMIT 100').all(me, o, o, me).reverse());
});
io.use((socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth.token, SECRET);
    const u = getUser(id);
    if (!u || isBanned(u)) throw new Error('auth');
    socket.uid = id; next();
  } catch { next(new Error('auth')); }
});
io.on('connection', socket => {
  socket.join('u:' + socket.uid);
  online.set(socket.uid, (online.get(socket.uid) || 0) + 1);
  socket.on('dm', ({ to, text } = {}, ack) => {
    const u = getUser(socket.uid); to = +to;
    text = String(text || '').trim().slice(0, 2000);
    if (!text || !u) return;
    if (isBanned(u)) return ack?.({ error: 'Banned' });
    if (isSBanned(u)) return ack?.({ error: 'You are social banned' });
    const ok = db.prepare("SELECT 1 FROM friends WHERE status='accepted' AND ((a=? AND b=?) OR (a=? AND b=?))").get(u.id, to, to, u.id);
    if (!ok) return ack?.({ error: 'You can only message friends' });
    const r = db.prepare('INSERT INTO messages(from_id,to_id,text,created) VALUES(?,?,?,?)').run(u.id, to, text, now());
    io.to('u:' + to).to('u:' + u.id).emit('dm', { id: r.lastInsertRowid, from_id: u.id, to_id: to, text, created: now() });
    ack?.({ ok: true });
  });
  socket.on('disconnect', () => {
    const n = (online.get(socket.uid) || 1) - 1;
    n ? online.set(socket.uid, n) : online.delete(socket.uid);
  });
});

// ---------- repos ----------
const walk = (dir, base = dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    e.isDirectory() ? walk(f, base, out) : out.push(path.relative(base, f).split(path.sep).join('/'));
  }
  return out;
};
app.post('/api/repos', auth, social, (req, res) => {
  const { name, description, files } = req.body;
  if (!/^[\w.-]{1,50}$/.test(name || '') || !Array.isArray(files) || !files.length) return res.status(400).json({ error: 'Bad repo (name: letters, numbers, . _ - only)' });
  const r = db.prepare('INSERT INTO repos(user_id,name,description,created) VALUES(?,?,?,?)').run(req.user.id, name, String(description || '').slice(0, 300), now());
  const root = path.join(DATA, 'repos', String(r.lastInsertRowid));
  for (const f of files.slice(0, 2000)) {
    const dest = path.resolve(root, String(f.path));
    if (!dest.startsWith(root + path.sep)) continue; // block path traversal
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(f.data, 'base64'));
  }
  res.json({ id: r.lastInsertRowid });
});
app.get('/api/repos/:id', auth, (req, res) => {
  const r = db.prepare('SELECT r.*, u.username FROM repos r JOIN users u ON u.id=r.user_id WHERE r.id=?').get(+req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ ...r, files: walk(path.join(DATA, 'repos', String(r.id))) });
});
app.get('/api/repos/:id/file', auth, (req, res) => {
  const root = path.join(DATA, 'repos', String(+req.params.id));
  const f = path.resolve(root, String(req.query.path || ''));
  if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return res.status(404).json({ error: 'No file' });
  if (fs.statSync(f).size > 1e6) return res.status(413).json({ error: 'File is too large to preview' });
  const buf = fs.readFileSync(f);
  if (buf.subarray(0, 8000).includes(0)) return res.status(415).json({ error: 'Binary file: no preview available' });
  res.set('X-Content-Type-Options', 'nosniff').type('text/plain').send(buf.toString('utf8'));
});
app.delete('/api/repos/:id', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM repos WHERE id=?').get(+req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.user_id !== req.user.id && RANK[req.user.role] < 1) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM repos WHERE id=?').run(r.id);
  fs.rmSync(path.join(DATA, 'repos', String(r.id)), { recursive: true, force: true });
  if (r.user_id !== req.user.id) log(req.user.id, 'delete_repo', r.user_id, r.name);
  res.json({ ok: true });
});

// ---------- reports ----------
app.post('/api/reports', auth, (req, res) => {
  const { target_id, kind, ref, reason } = req.body;
  if (!['user', 'message', 'repo'].includes(kind) || !reason || !getUser(+target_id)) return res.status(400).json({ error: 'Bad report' });
  db.prepare('INSERT INTO reports(reporter_id,target_id,kind,ref,reason,created) VALUES(?,?,?,?,?,?)')
    .run(req.user.id, +target_id, kind, String(ref || ''), String(reason).slice(0, 500), now());
  res.json({ ok: true });
});

// ---------- moderation ----------
const mod = [auth, need('mod')];
app.get('/api/mod/reports', mod, (req, res) =>
  res.json(db.prepare(`SELECT r.*, a.username reporter, b.username target FROM reports r
    LEFT JOIN users a ON a.id=r.reporter_id LEFT JOIN users b ON b.id=r.target_id
    WHERE r.status='open' ORDER BY r.id DESC LIMIT 100`).all()));
app.post('/api/mod/reports/:id', mod, (req, res) => {
  const status = req.body.status === 'dismissed' ? 'dismissed' : 'resolved';
  db.prepare('UPDATE reports SET status=?, note=?, handled_by=? WHERE id=?').run(status, String(req.body.note || '').slice(0, 500), req.user.id, +req.params.id);
  log(req.user.id, 'report_' + status, null, '#' + req.params.id);
  res.json({ ok: true });
});
app.get('/api/mod/users', mod, (req, res) =>
  res.json(db.prepare('SELECT id,username,role,banned,sban FROM users WHERE username LIKE ? LIMIT 30').all('%' + (req.query.q || '') + '%')));
app.get('/api/mod/user/:id', mod, (req, res) => {
  const u = getUser(+req.params.id);
  if (!u) return res.status(404).json({ error: 'No such user' });
  res.json({ ...pub(u), banned: !!isBanned(u), ban_reason: u.ban_reason, sban_reason: u.sban_reason,
    reportsAgainst: db.prepare('SELECT * FROM reports WHERE target_id=? ORDER BY id DESC LIMIT 20').all(u.id),
    history: db.prepare('SELECT * FROM audit WHERE target_id=? ORDER BY id DESC LIMIT 20').all(u.id) });
});
app.get('/api/mod/chatlog/:reportId', mod, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(+req.params.reportId);
  if (!r) return res.status(404).json({ error: 'No report' });
  log(req.user.id, 'view_chatlog', r.target_id, 'report #' + r.id); // every DM view is audited
  res.json(db.prepare(`SELECT m.*, u.username FROM messages m JOIN users u ON u.id=m.from_id
    WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY m.id DESC LIMIT 100`).all(r.reporter_id, r.target_id, r.target_id, r.reporter_id).reverse());
});
app.get('/api/mod/audit', auth, need('admin'), (req, res) =>
  res.json(db.prepare(`SELECT a.*, x.username actor, y.username target FROM audit a
    LEFT JOIN users x ON x.id=a.actor_id LEFT JOIN users y ON y.id=a.target_id ORDER BY a.id DESC LIMIT 100`).all()));
app.post('/api/mod/action', mod, (req, res) => {
  const { action, user_id, reason = '', hours = 0, value } = req.body;
  const t = getUser(+user_id), me = req.user;
  if (!t) return res.status(404).json({ error: 'No such user' });
  if (t.id === me.id) return res.status(400).json({ error: "You can't target yourself" });
  if (RANK[t.role] >= RANK[me.role]) return res.status(403).json({ error: 'Target outranks you' });
  const until = hours > 0 ? now() + hours * 3600e3 : 0;
  switch (action) {
    case 'ban':
      db.prepare('UPDATE users SET banned=1, ban_reason=?, ban_until=? WHERE id=?').run(reason, until, t.id);
      io.in('u:' + t.id).disconnectSockets(true); break;
    case 'unban': db.prepare('UPDATE users SET banned=0 WHERE id=?').run(t.id); break;
    case 'sban': db.prepare('UPDATE users SET sban=1, sban_reason=?, sban_until=? WHERE id=?').run(reason, until, t.id); break;
    case 'unsban': db.prepare('UPDATE users SET sban=0 WHERE id=?').run(t.id); break;
    case 'warn': io.to('u:' + t.id).emit('warning', reason || 'Please follow the community rules.'); break;
    case 'clear_profile': db.prepare("UPDATE users SET bio='', status='', avatar='', banner='' WHERE id=?").run(t.id); break;
    case 'badge_add': case 'badge_remove':
      if (RANK[me.role] < 2 || !MANUAL.includes(value)) return res.status(403).json({ error: 'Admins only, known badges only' });
      action === 'badge_add'
        ? db.prepare('INSERT OR IGNORE INTO badges VALUES(?,?)').run(t.id, value)
        : db.prepare('DELETE FROM badges WHERE user_id=? AND badge=?').run(t.id, value);
      break;
    case 'role':
      if (me.role !== 'owner' || !['user', 'mod', 'admin'].includes(value)) return res.status(403).json({ error: 'Owner only' });
      db.prepare('UPDATE users SET role=? WHERE id=?').run(value, t.id); break;
    default: return res.status(400).json({ error: 'Unknown action' });
  }
  log(me.id, action, t.id, (value || '') + ' ' + reason + (hours ? ` (${hours}h)` : ''));
  res.json({ ok: true });
});

// ---------- web version (open http://localhost:3000 in a browser) ----------
const ROOT = path.join(__dirname, '..'), mod_ = p => path.join(ROOT, 'node_modules', p);
app.use('/vendor/monaco', express.static(mod_('monaco-editor/min')));
app.use('/vendor/socketio', express.static(mod_('socket.io-client/dist')));
app.get('/renderer.js', (req, res) => res.sendFile(path.join(ROOT, 'renderer.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(ROOT, 'styles.css')));
app.use(express.static(path.join(ROOT, 'web')));

app.use((err, req, res, next) => res.status(400).json({ error: err.message }));
server.listen(PORT, () => console.log('Server running on port ' + PORT));