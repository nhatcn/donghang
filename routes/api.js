import { Router } from 'express';
import {
  db,
  kvGet,
  kvSet,
  setItemDone,
  completeOrder,
  deleteOrder,
  addNotification,
  getNotifications,
  getAllUsers,
  updateUserRole,
  getUserById
} from '../db.js';
import { syncOdoo, isOdooConfigured } from '../odoo.js';
import { authMiddleware } from './auth.js';

const r = Router();

r.use(authMiddleware);

// Danh sách đơn (đang làm + đã xong 60 ngày gần đây), kèm các món
r.get('/orders', (req, res) => {
  const since = Date.now() - 60 * 86400000;
  const orders = db.prepare(
    `SELECT * FROM orders
     WHERE status='open' OR (status='done' AND COALESCE(done_at, created_at) > ?)`
  ).all(since);
  const items = db.prepare('SELECT * FROM items WHERE order_id=? ORDER BY id');
  res.json(orders.map(o => ({ ...o, items: items.all(o.id) })));
});

r.get('/status', (req, res) => {
  res.json({
    enabled: isOdooConfigured(),
    ok_at: Number(kvGet('odoo_ok_at')) || 0,
    error: kvGet('odoo_error') || ''
  });
});

r.post('/sync', async (req, res) => {
  await syncOdoo();
  const error = kvGet('odoo_error') || '';
  res.json({ ok: !error, error });
});

// Tick / bỏ tick món, đổi mã lô: KHÔNG đổi trạng thái đơn
r.patch('/items/:id', (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  if (b.done !== undefined) setItemDone(id, !!b.done);
  if (b.lot !== undefined) db.prepare('UPDATE items SET lot=? WHERE id=?').run(String(b.lot), id);
  res.json({ ok: true });
});

r.post('/items/batch-lot', (req, res) => {
  const upd = db.prepare('UPDATE items SET lot=? WHERE id=?');
  const list = Array.isArray(req.body?.updates) ? req.body.updates : [];
  for (const u of list) upd.run(String(u.lot ?? ''), Number(u.id));
  res.json({ ok: true, count: list.length });
});

// Ưu tiên + hoàn tất đơn (chỉ ở đây đơn mới chuyển sang 'done')
r.patch('/orders/:id', (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  if (b.priority !== undefined) db.prepare('UPDATE orders SET priority=? WHERE id=?').run(b.priority ? 1 : 0, id);
  if (b.status === 'done') {
    const userId = req.user ? req.user.id : null;
    const userName = req.user ? req.user.display_name : '';
    completeOrder(id, userId, userName);
  }
  res.json({ ok: true });
});

// Xóa đơn hàng (chỉ dành cho tài khoản Admin)
r.delete('/orders/:id', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Chỉ tài khoản admin mới có quyền xóa đơn hàng' });
  }
  const id = Number(req.params.id);
  const ord = db.prepare('SELECT id, label FROM orders WHERE id=?').get(id);
  if (!ord) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng' });
  deleteOrder(id);
  res.json({ ok: true, message: `Đã xóa đơn ${ord.label}` });
});

// Quản lý nhắc nhở đơn chưa hoàn thành
r.post('/orders/:id/remind', (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng' });
  if (order.status === 'done') return res.status(400).json({ ok: false, error: 'Đơn hàng này đã hoàn tất' });

  const managerName = req.user?.display_name || 'Người quản lý';
  const cust = order.customer ? order.customer.trim() : (order.label || 'đơn hàng');
  const orderDate = new Date(order.created_at).toLocaleDateString('vi-VN');
  const message = `${managerName} đã nhắc nhở về đơn hàng của khách hàng ${cust} ngày ${orderDate}`;

  const notifId = addNotification({
    type: 'reminder',
    orderId: order.id,
    orderLabel: order.label,
    customer: order.customer,
    managerId: req.user?.id,
    managerName,
    message
  });

  res.json({ ok: true, message, notifId });
});

// Lấy danh sách thông báo
r.get('/notifications', (req, res) => {
  const since = Number(req.query.since) || 0;
  const list = getNotifications(since, 50);
  res.json(list);
});

// Lấy / lưu mã lô MIX 8 vị hàng ngày
r.get('/mix-lot', (req, res) => {
  const dateKey = req.query.date || new Date().toISOString().slice(0, 10);
  const data = kvGet('mix_lot_' + dateKey) || kvGet('mix_lot_latest') || '';
  let parsed = {};
  try { parsed = JSON.parse(data); } catch {}
  res.json({ ok: true, date: dateKey, lots: parsed });
});

r.post('/mix-lot', (req, res) => {
  const dateKey = req.body?.date || new Date().toISOString().slice(0, 10);
  const lots = req.body?.lots || {};
  const str = JSON.stringify(lots);
  kvSet('mix_lot_' + dateKey, str);
  kvSet('mix_lot_latest', str);
  res.json({ ok: true, date: dateKey, lots });
});

// ================= ADMIN: QUẢN LÝ NGƯỜI DÙNG & PHÂN QUYỀN =================
r.get('/users', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Chỉ tài khoản admin mới có quyền xem danh sách người dùng' });
  }
  res.json({ ok: true, users: getAllUsers() });
});

r.patch('/users/:id/role', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Chỉ tài khoản admin mới có quyền phân quyền người dùng' });
  }
  const id = Number(req.params.id);
  const { role } = req.body || {};
  if (role !== 'manager' && role !== 'packer') {
    return res.status(400).json({ ok: false, error: 'Vai trò chỉ có thể là Quản lý (manager) hoặc Đóng hàng (packer)' });
  }
  try {
    const updated = updateUserRole(id, role);
    res.json({ ok: true, user: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default r;
