const Database = require('better-sqlite3');
const path = require('path');
const [name, role] = process.argv.slice(2);
if (!name || !['user', 'mod', 'admin', 'owner'].includes(role)) {
  console.log('Usage: node server/setrole.js <username> <user|mod|admin|owner>');
  process.exit(1);
}
const db = new Database(path.join(__dirname, 'data', 'app.db'));
const r = db.prepare('UPDATE users SET role=? WHERE username=?').run(role, name);
console.log(r.changes ? `${name} is now ${role}` : 'No such user');