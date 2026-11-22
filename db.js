import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Tự nạp .env nếu có
if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch {}
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const targetDb = path.join(DATA_DIR, 'orders.db');
const seedDb = path.join(__dirname, 'seed_data', 'orders.db');

// Tự động sao chép database ban đầu vào volume mount khi deploy mới
// Nếu FORCE_SEED=1: luôn ghi đè DB (dùng để upload DB local lên Fly.io)
const forceSeed = process.env.FORCE_SEED === '1';
if (fs.existsSync(seedDb) && (!fs.existsSync(targetDb) || forceSeed)) {
  try {
    fs.copyFileSync(seedDb, targetDb);
    // Xóa file journal/wal cũ nếu có để tránh xung đột
    try { fs.unlinkSync(targetDb + '-wal'); } catch {}
    try { fs.unlinkSync(targetDb + '-shm'); } catch {}
    console.log(forceSeed ? '[FORCE_SEED] Đã ghi đè database từ seed!' : 'Đã sao chép database ban đầu vào', targetDb);
  } catch (err) {
    console.error('Lỗi sao chép seed database:', err);
  }
}

export const db = new DatabaseSync(targetDb);
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL, ext_id TEXT NOT NULL, label TEXT,
    customer TEXT, phone TEXT, email TEXT, address TEXT,
    note TEXT, salesperson TEXT,
    amount_total REAL, currency TEXT,
    priority INTEGER DEFAULT 0, status TEXT DEFAULT 'open',
    created_at INTEGER NOT NULL, odoo_write TEXT,
    UNIQUE(source, ext_id));
  CREATE TABLE IF NOT EXISTS items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL, sku TEXT, name TEXT, qty REAL DEFAULT 1,
    done INTEGER DEFAULT 0, lot TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'packer',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions(
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'reminder',
    order_id INTEGER,
    order_label TEXT,
    customer TEXT,
    manager_id INTEGER,
    manager_name TEXT,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// Thêm cột mới nếu database cũ chưa có
const cols = [
  ['phone', 'TEXT'], ['email', 'TEXT'], ['address', 'TEXT'],
  ['salesperson', 'TEXT'], ['amount_total', 'REAL'], ['currency', 'TEXT'],
  ['done_at', 'INTEGER'], ['confirmed_by', 'INTEGER'], ['confirmed_by_name', 'TEXT']
];
for (const [name, type] of cols) {
  try { db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`); } catch {}
}
try { db.exec('ALTER TABLE orders ADD COLUMN odoo_write TEXT'); } catch {}

// Password utilities
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  try {
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
  } catch {
    return false;
  }
}

// User & Auth operations
export function createUser(username, password, displayName, role = 'packer') {
  const uname = String(username || '').trim().toLowerCase();
  const dname = String(displayName || uname).trim();
  const r = role === 'manager' ? 'manager' : 'packer';
  const { hash, salt } = hashPassword(password);
  const ins = db.prepare(`
    INSERT INTO users (username, password_hash, salt, display_name, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uname, hash, salt, dname, r, Date.now());
  return getUserById(Number(ins.lastInsertRowid));
}

export function getUserByUsername(username) {
  const uname = String(username || '').trim().toLowerCase();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
}

export function getUserById(id) {
  return db.prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?').get(Number(id));
}

export function getAllUsers() {
  return db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY id ASC').all();
}

export function updateUserRole(userId, newRole) {
  if (newRole !== 'manager' && newRole !== 'packer') {
    throw new Error('Vai trò chỉ có thể là Quản lý hoặc Đóng hàng');
  }
  const u = getUserById(userId);
  if (!u) throw new Error('Không tìm thấy người dùng');
  if (u.username === 'admin' || u.role === 'admin') {
    throw new Error('Không thể thay đổi vai trò của tài khoản admin');
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, Number(userId));
  return getUserById(userId);
}

// Khởi tạo tài khoản admin mặc định: admin / 1234
export function initAdminUser() {
  const existing = getUserByUsername('admin');
  const { hash, salt } = hashPassword('1234');
  if (!existing) {
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, display_name, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('admin', hash, salt, 'Quản trị viên', 'admin', Date.now());
    console.log('Đã tạo tài khoản admin (mật khẩu: 1234)');
  } else {
    db.prepare(`
      UPDATE users SET role = 'admin', password_hash = ?, salt = ?, display_name = 'Quản trị viên'
      WHERE username = 'admin'
    `).run(hash, salt);
  }
}
initAdminUser();

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 3600 * 1000; // 30 days
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, Number(userId), now, expiresAt);
  return token;
}

export function getSession(token) {
  if (!token) return null;
  const s = db.prepare(`
    SELECT s.token, s.expires_at, u.id, u.username, u.display_name, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, Date.now());
  return s || null;
}

export function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Notifications
export function addNotification({ type = 'reminder', orderId, orderLabel, customer, managerId, managerName, message }) {
  const r = db.prepare(`
    INSERT INTO notifications (type, order_id, order_label, customer, manager_id, manager_name, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    type,
    orderId ? Number(orderId) : null,
    orderLabel || '',
    customer || '',
    managerId ? Number(managerId) : null,
    managerName || '',
    message,
    Date.now()
  );
  return Number(r.lastInsertRowid);
}

export function getNotifications(since = 0, limit = 50) {
  return db.prepare(`
    SELECT * FROM notifications
    WHERE created_at > ?
    ORDER BY id DESC
    LIMIT ?
  `).all(Number(since) || 0, limit);
}

export const kvGet = k => db.prepare('SELECT v FROM kv WHERE k=?').get(k)?.v;
export const kvSet = (k, v) => db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

export function createOrder(data) {
  const { source, ext_id, label, customer, phone, email, address, note, salesperson, amount_total, currency, created_at, lines } = data;
  db.exec('BEGIN');
  try {
    const r = db.prepare(`INSERT INTO orders
      (source,ext_id,label,customer,phone,email,address,note,salesperson,amount_total,currency,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(source, String(ext_id), label || String(ext_id), customer || '', phone || '', email || '',
           address || '', note || '', salesperson || '', amount_total || 0, currency || '', created_at || Date.now());
    const id = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO items(order_id,sku,name,qty) VALUES(?,?,?,?)');
    for (const l of lines) ins.run(id, l.sku || '', l.name, l.qty);
    db.exec('COMMIT');
    return id;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function syncLines(orderId, lines) {
  const cur = db.prepare('SELECT * FROM items WHERE order_id=?').all(orderId);
  const used = new Set();
  for (const l of lines) {
    const m = cur.find(i => !used.has(i.id) && i.name === l.name && i.sku === l.sku);
    if (m) {
      used.add(m.id);
      if (m.qty !== l.qty) db.prepare('UPDATE items SET qty=? WHERE id=?').run(l.qty, m.id);
    } else {
      db.prepare('INSERT INTO items(order_id,sku,name,qty) VALUES(?,?,?,?)').run(orderId, l.sku, l.name, l.qty);
    }
  }
  for (const i of cur) if (!used.has(i.id) && !i.done) db.prepare('DELETE FROM items WHERE id=?').run(i.id);
  // Nếu đơn đã xong mà Odoo thêm món mới chưa đóng thì mở lại đơn.
  const left = db.prepare('SELECT COUNT(*) as c FROM items WHERE order_id=? AND done=0').get(orderId).c;
  const ord = db.prepare('SELECT status FROM orders WHERE id=?').get(orderId);
  if (left > 0 && ord && ord.status === 'done') {
    db.prepare("UPDATE orders SET status='open', done_at=NULL, confirmed_by=NULL, confirmed_by_name=NULL WHERE id=?").run(orderId);
  }
}

export function setItemDone(itemId, done) {
  db.prepare('UPDATE items SET done=? WHERE id=?').run(done ? 1 : 0, itemId);
  // Bỏ tick một món của đơn đã hoàn tất thì mở lại đơn
  const it = db.prepare('SELECT order_id FROM items WHERE id=?').get(itemId);
  if (it && !done) {
    db.prepare("UPDATE orders SET status='open', done_at=NULL, confirmed_by=NULL, confirmed_by_name=NULL WHERE id=? AND status='done'").run(it.order_id);
  }
}

export function completeOrder(orderId, userId = null, userName = '') {
  db.prepare('UPDATE items SET done=1 WHERE order_id=?').run(orderId);
  db.prepare(`
    UPDATE orders 
    SET status='done', done_at=?, confirmed_by=?, confirmed_by_name=? 
    WHERE id=? AND status!='cancelled'
  `).run(Date.now(), userId ? Number(userId) : null, userName || '', orderId);
}

export function deleteOrder(orderId) {
  const id = Number(orderId);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM items WHERE order_id=?').run(id);
    db.prepare('DELETE FROM orders WHERE id=?').run(id);
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
