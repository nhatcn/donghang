import { Router } from 'express';
import {
  createUser,
  getUserByUsername,
  verifyPassword,
  createSession,
  getSession,
  deleteSession
} from '../db.js';

const r = Router();

export function getAuthToken(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/tc_session=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.slice(7).trim();
  }
  return null;
}

export function authMiddleware(req, res, next) {
  const token = getAuthToken(req);
  if (token) {
    const session = getSession(token);
    if (session) {
      req.user = {
        id: session.id,
        username: session.username,
        display_name: session.display_name,
        role: session.role
      };
      req.token = token;
    }
  }
  next();
}

// Lấy thông tin user hiện tại
r.get('/me', authMiddleware, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Chưa đăng nhập' });
  }
  res.json({ ok: true, user: req.user });
});

// Đăng ký tài khoản mới (Người đăng ký mới chỉ có thể là người đóng hàng)
r.post('/signup', (req, res) => {
  const { username, password, display_name } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  const pass = String(password || '');
  const dname = String(display_name || '').trim();
  const rle = 'packer'; // Quy tắc: Người đăng ký mới chỉ có thể là người đóng hàng (packer)

  if (!uname || uname.length < 3) {
    return res.status(400).json({ ok: false, error: 'Tên đăng nhập phải có ít nhất 3 ký tự' });
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(uname)) {
    return res.status(400).json({ ok: false, error: 'Tên đăng nhập chỉ chứa chữ, số hoặc gạch dưới' });
  }
  if (!pass || pass.length < 4) {
    return res.status(400).json({ ok: false, error: 'Mật khẩu phải có ít nhất 4 ký tự' });
  }
  if (!dname) {
    return res.status(400).json({ ok: false, error: 'Vui lòng nhập họ tên hiển thị' });
  }

  const existing = getUserByUsername(uname);
  if (existing) {
    return res.status(400).json({ ok: false, error: 'Tên đăng nhập đã tồn tại, vui lòng chọn tên khác' });
  }

  try {
    const user = createUser(uname, pass, dname, rle);
    const token = createSession(user.id);
    res.setHeader('Set-Cookie', `tc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role
      },
      token
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Không thể tạo tài khoản: ' + err.message });
  }
});

// Đăng nhập
r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  const pass = String(password || '');

  if (!uname || !pass) {
    return res.status(400).json({ ok: false, error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu' });
  }

  const user = getUserByUsername(uname);
  if (!user || !verifyPassword(pass, user.password_hash, user.salt)) {
    return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
  }

  const token = createSession(user.id);
  res.setHeader('Set-Cookie', `tc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role
    },
    token
  });
});

// Đăng xuất
r.post('/logout', authMiddleware, (req, res) => {
  if (req.token) {
    deleteSession(req.token);
  }
  res.setHeader('Set-Cookie', 'tc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

export default r;
