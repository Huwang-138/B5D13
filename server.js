const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const webpush = require('web-push');
const cron = require('node-cron');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});


const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://huwang1308:O75Pt08SbjdRVfOD@cluster0.3v1tne8.mongodb.net/quanly_lop?appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'qlnhom_super_secret_2025_!@#';
const JWT_EXPIRES = '30d'; // Token kéo dài 30 ngày

// ─── Web Push Configuration ───────────────────────────────────────
let VAPID_PUBLIC = process.env.VAPID_PUBLIC;
let VAPID_PRIVATE = process.env.VAPID_PRIVATE;

async function initVapidKeys() {
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails('mailto:admin@quanlylop.com', VAPID_PUBLIC, VAPID_PRIVATE);
    return;
  }

  const Setting = mongoose.model('Setting');
  let vapidSetting = await Setting.findOne({ key: 'vapid' });

  if (!vapidSetting) {
    const keys = webpush.generateVAPIDKeys();
    vapidSetting = await Setting.create({ key: 'vapid', value: keys });
    console.log('✅ Generated new VAPID Keys and saved to DB.');
  } else {
    console.log('✅ Loaded VAPID Keys from DB.');
  }

  VAPID_PUBLIC = vapidSetting.value.publicKey;
  VAPID_PRIVATE = vapidSetting.value.privateKey;
  webpush.setVapidDetails('mailto:admin@quanlylop.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

// ─── Middleware ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Tắt CSP vì dùng inline scripts/styles
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate Limiting ────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 100,
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  standardHeaders: true,
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 5,
  message: { error: 'Đăng nhập quá nhiều lần, vui lòng thử lại sau 1 phút.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', generalLimiter);

// Multer (avatar upload - stored as base64 in DB for Render compatibility)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } });

// ─── MongoDB Schemas ──────────────────────────────────────────────
const settingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});
const Setting = mongoose.model('Setting', settingSchema);
const userSchema = new mongoose.Schema({
  stt: Number,
  fullName: String,
  username: { type: String, unique: true },
  password: String,
  dob: String,
  gender: String,
  hometown: String,
  phone: String,
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  avatar: { type: String, default: '' }, // emoji or base64 data URL
  squad: { type: Number, default: 1 },
  pushSubscriptions: { type: Array, default: [] }
}, { timestamps: true });

const sessionSchema = new mongoose.Schema({
  subject: String,
  mode: { type: String, enum: ['manual', 'random'] },
  active: { type: Boolean, default: true },
  groups: [{
    groupId: Number,
    name: String,
    capacity: Number,
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    fixedMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  completedAt: Date,
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Session = mongoose.model('Session', sessionSchema);

const violationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  note: { type: String, default: '' },
  points: { type: Number, default: 0 },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  message: { type: String, required: true },
  type: { type: String, default: 'info' }, // info, warning, success
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = for all
  targetGroup: { type: Number, default: null },
  targetRole: { type: String, default: null },
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  relatedViolation: { type: mongoose.Schema.Types.ObjectId, ref: 'Violation', default: null },
  relatedSession: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
}, { timestamps: true });

const Violation = mongoose.model('Violation', violationSchema);
const Notification = mongoose.model('Notification', notificationSchema);

// ─── Seed Data ────────────────────────────────────────────────────
const STUDENTS = [
  { stt: 1, fullName: 'Trần Trọng Thế Anh', dob: '28/04/2004', gender: 'Nam', hometown: 'Thái Bình', phone: '0941139262', username: 'trantrongtheanh', role: 'user' },
  { stt: 2, fullName: 'Bùi Xuân Bằng', dob: '19/01/2005', gender: 'Nam', hometown: 'Thanh Hóa', phone: '0347157821', username: 'buixuanbang', role: 'user' },
  { stt: 3, fullName: 'Nguyễn Nhật Bình', dob: '31/05/2005', gender: 'Nam', hometown: 'Quảng Trị', phone: '0948024515', username: 'nguyennhatbinh', role: 'user' },
  { stt: 4, fullName: 'Đỗ Chí Công', dob: '05/07/2005', gender: 'Nam', hometown: 'Hà Nội', phone: '0782000061', username: 'dochicong', role: 'user' },
  { stt: 5, fullName: 'Nguyễn Phương Duy', dob: '04/01/2005', gender: 'Nam', hometown: 'Bắc Ninh', phone: '0965041035', username: 'nguyenphuongduy', role: 'user' },
  { stt: 6, fullName: 'Phương Thế Duy', dob: '04/07/2004', gender: 'Nam', hometown: 'Lâm Đồng', phone: '0902219391', username: 'phuongtheduy', role: 'user' },
  { stt: 7, fullName: 'Nguyễn Thành Đạt', dob: '15/12/2004', gender: 'Nam', hometown: 'Hải Dương', phone: '0917633317', username: 'nguyenthanhdat', role: 'user' },
  { stt: 8, fullName: 'Nguyễn Tuấn Đạt', dob: '30/10/2003', gender: 'Nam', hometown: 'Gia Lai', phone: '0782273030', username: 'nguyentuandat', role: 'user' },
  { stt: 9, fullName: 'Nguyễn Đăng Hải', dob: '02/07/2003', gender: 'Nam', hometown: 'Hà Nội', phone: '0854309399', username: 'nguyendanghai', role: 'user' },
  { stt: 10, fullName: 'Lê Quang Quốc Hiệu', dob: '29/11/2005', gender: 'Nam', hometown: 'TT-Huế', phone: '0812733455', username: 'lequangquochieu', role: 'user' },
  { stt: 11, fullName: 'Đào Văn Xuân Hoàng', dob: '13/01/2005', gender: 'Nam', hometown: 'Lâm Đồng', phone: '0792047112', username: 'daovanxuanhoang', role: 'user' },
  { stt: 12, fullName: 'Nguyễn Hữu Hoàng', dob: '13/08/2004', gender: 'Nam', hometown: 'Hải Phòng', phone: '0943888822', username: 'nguyenhuuhoang', role: 'admin' },
  { stt: 13, fullName: 'Phan Huỳnh Khang', dob: '09/10/2004', gender: 'Nam', hometown: 'Phú Yên', phone: '0358675444', username: 'phanhuynhkhang', role: 'user' },
  { stt: 14, fullName: 'Huỳnh Quốc Khải', dob: '24/09/2003', gender: 'Nam', hometown: 'Đồng Tháp', phone: '0389469195', username: 'huynhquockhai', role: 'user' },
  { stt: 15, fullName: 'Nguyễn Hải Long', dob: '04/11/2005', gender: 'Nam', hometown: 'Hà Nam', phone: '0859936330', username: 'nguyenhailong', role: 'user' },
  { stt: 16, fullName: 'Trần Lê Na', dob: '05/01/2005', gender: 'Nữ', hometown: 'Quảng Bình', phone: '0964337595', username: 'tranlena', role: 'user' },
  { stt: 17, fullName: 'Nguyễn Thiện Nghĩa', dob: '18/10/2005', gender: 'Nam', hometown: 'An Giang', phone: '0359890788', username: 'nguyenthiennghia', role: 'user' },
  { stt: 18, fullName: 'Vũ Trần Trung Nghĩa', dob: '05/05/2005', gender: 'Nam', hometown: 'Gia Lai', phone: '0987255079', username: 'vutrantrungnghia', role: 'user' },
  { stt: 19, fullName: 'Huỳnh Hửu Nhân', dob: '04/11/2005', gender: 'Nam', hometown: 'Bạc Liêu', phone: '0902227954', username: 'huynhhuunhan', role: 'user' },
  { stt: 20, fullName: 'Nguyễn Thành Quân', dob: '29/11/2004', gender: 'Nam', hometown: 'Kon Tum', phone: '0329464014', username: 'nguyenthanhquan', role: 'user' },
  { stt: 21, fullName: 'Trịnh Duy Tuấn', dob: '16/06/2005', gender: 'Nam', hometown: 'Nam Định', phone: '0388203916', username: 'trinhduytuan', role: 'user' },
  { stt: 22, fullName: 'Nguyễn Gia Tuyến', dob: '18/11/2005', gender: 'Nam', hometown: 'Bắc Ninh', phone: '0344412229', username: 'nguyengiatuyen', role: 'user' },
  { stt: 23, fullName: 'Lê Thanh Tùng', dob: '09/05/2005', gender: 'Nam', hometown: 'Thái Nguyên', phone: '0375200186', username: 'lethanhtung', role: 'admin' },
  { stt: 24, fullName: 'Lê Phước Vinh', dob: '14/03/2005', gender: 'Nam', hometown: 'Kon Tum', phone: '0348824479', username: 'lephuocvinh', role: 'user' },
  { stt: 25, fullName: 'Hoàng Thị Lê Vy', dob: '03/09/2005', gender: 'Nữ', hometown: 'Đắk Lắk', phone: '0363417355', username: 'hoangthilevy', role: 'user' },
];

function dobToPassword(dob) {
  // dob: "dd/mm/yyyy" → "ddmmyyyy@"
  return dob.replace(/\//g, '') + '@';
}

async function seedDatabase() {
  const count = await User.countDocuments();
  if (count === 0) {
    console.log('🌱 Seeding database with 25 students...');
    for (const s of STUDENTS) {
      const hashed = await bcrypt.hash(dobToPassword(s.dob), 10);
      await User.create({ ...s, password: hashed, avatar: '' });
    }
    console.log('✅ Seed complete!');
  }
}

// ─── JWT Auth Helper ──────────────────────────────────────────────
function makeToken(userId) {
  return jwt.sign({ userId: userId.toString() }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).lean();
    if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn, vui lòng đăng nhập lại' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ Admin mới có quyền' });
  next();
}

// ─── Socket.io Helper: broadcast session update ───────────────────
async function broadcastSessionUpdate() {
  try {
    const session = await Session.findOne({ active: true })
      .populate('groups.members groups.fixedMembers', 'fullName username avatar stt')
      .lean();
    io.emit('sessionUpdated', session || null);
  } catch (err) {
    console.error('broadcastSessionUpdate error:', err.message);
  }
}

// ─── Auth Routes ──────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
    const searchStr = username.toLowerCase().trim();
    const user = await User.findOne({
      $or: [
        { username: searchStr },
        { phone: searchStr }
      ]
    }).lean();
    if (!user) return res.status(401).json({ error: 'Tài khoản hoặc số điện thoại không tồn tại' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Mật khẩu không đúng' });
    const token = makeToken(user._id);
    res.json({ token, user: { id: user._id, username: user.username, fullName: user.fullName, role: user.role, avatar: user.avatar, stt: user.stt } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  // JWT is stateless — client just deletes the token
  res.json({ ok: true });
});

// ─── User Profile Routes ──────────────────────────────────────────
app.get('/api/user/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    res.json({ id: user._id, username: user.username, fullName: user.fullName, role: user.role, avatar: user.avatar, dob: user.dob, gender: user.gender, hometown: user.hometown, phone: user.phone, stt: user.stt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword, avatar } = req.body;
    const user = await User.findById(req.user._id);
    const updates = {};
    if (newPassword) {
      if (!oldPassword) return res.status(400).json({ error: 'Cần nhập mật khẩu cũ' });
      const ok = await bcrypt.compare(oldPassword, user.password);
      if (!ok) return res.status(400).json({ error: 'Mật khẩu cũ không đúng' });
      updates.password = await bcrypt.hash(newPassword, 10);
    }
    if (avatar !== undefined) updates.avatar = avatar;
    const updated = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).lean();
    res.json({ id: updated._id, username: updated.username, fullName: updated.fullName, role: updated.role, avatar: updated.avatar });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/avatar-upload', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Không có file' });
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    await User.findByIdAndUpdate(req.user._id, { avatar: b64 });
    res.json({ avatar: b64 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Class List Route ─────────────────────────────────────────────
app.get('/api/class/members', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({}, 'stt fullName username dob gender hometown phone role avatar').sort('stt').lean();
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Violations Routes ────────────────────────────────────────────
app.get('/api/violations', authMiddleware, async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { user: req.user._id };
    const violations = await Violation.find(filter)
      .populate('user', 'fullName stt username')
      .populate('recordedBy', 'fullName')
      .sort('-createdAt')
      .lean();
    res.json(violations);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/violations', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId, type, note, points } = req.body;
    if (!userId || !type) return res.status(400).json({ error: 'Thiếu thông tin lỗi' });
    if (type === 'Khác' && !note?.trim()) return res.status(400).json({ error: 'Vui lòng ghi chú nội dung lỗi' });

    const violation = await Violation.create({
      user: userId,
      type,
      note: note?.trim() || '',
      points: Number(points) || 0,
      recordedBy: req.user._id
    });
    const populated = await violation.populate('user', 'fullName stt username');

    // Create notification
    const noteText = note?.trim() ? ` (${note.trim()})` : '';
    const messageText = `Bạn vừa bị ghi lỗi: ${type}${noteText} (-${points} điểm)`;
    const notif = await Notification.create({
      message: messageText,
      type: 'warning',
      targetUser: userId,
      relatedViolation: violation._id
    });
    io.emit('newNotification', notif);

    // Send Web Push Notification
    const targetUserObj = await User.findById(userId);
    if (targetUserObj && targetUserObj.pushSubscriptions && targetUserObj.pushSubscriptions.length > 0) {
      const pushPayload = JSON.stringify({
        title: 'Cảnh báo vi phạm ⚠️',
        body: messageText,
        url: '/'
      });
      targetUserObj.pushSubscriptions.forEach(sub => {
        webpush.sendNotification(sub, pushPayload).catch(err => console.error('Push error:', err));
      });
    }

    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Web Push Subscribe Route ─────────────────────────────────────
app.get('/api/notifications/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

app.post('/api/notifications/subscribe', authMiddleware, async (req, res) => {
  try {
    const subscription = req.body;
    const user = await User.findById(req.user._id);

    // Lưu ý: Chỉ thêm nếu chưa có (dựa vào endpoint)
    const exists = user.pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
    if (!exists) {
      user.pushSubscriptions.push(subscription);
      await user.save();
    }
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/violations/my-points', authMiddleware, async (req, res) => {
  try {
    const violations = await Violation.find({ user: req.user._id }).lean();
    const totalDeducted = violations.reduce((sum, v) => sum + (v.points || 0), 0);
    res.json({ totalDeducted, count: violations.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/violations/leaderboard', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({}, 'fullName stt role squad').lean();
    const violations = await Violation.find({}).lean();
    const map = {};
    violations.forEach(v => {
      const uid = v.user.toString();
      if (!map[uid]) map[uid] = 0;
      map[uid] += v.points || 0;
    });
    const result = users.map(u => ({
      _id: u._id,
      fullName: u.fullName,
      stt: u.stt,
      role: u.role,
      squad: u.squad || 1,
      totalDeducted: map[u._id.toString()] || 0
    })).sort((a, b) => b.totalDeducted - a.totalDeducted);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/violations/:id/appeal', authMiddleware, async (req, res) => {
  try {
    const violation = await Violation.findById(req.params.id).populate('user');
    if (!violation) return res.status(404).json({ error: 'Không tìm thấy lỗi' });
    if (violation.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Không có quyền khiếu nại lỗi của người khác' });
    }

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recentAppeal = await Notification.findOne({
      triggeredBy: req.user._id,
      targetRole: 'admin',
      message: { $regex: 'vừa khiếu nại về lỗi' },
      createdAt: { $gte: thirtyMinsAgo }
    });

    if (recentAppeal) {
      const timeLeft = Math.ceil((recentAppeal.createdAt.getTime() + 30 * 60 * 1000 - Date.now()) / 60000);
      return res.status(429).json({ error: `Bạn chỉ được khiếu nại 30 phút một lần. Vui lòng thử lại sau ${timeLeft} phút.` });
    }

    const messageText = `${req.user.fullName} vừa khiếu nại về lỗi ${violation.type} (-${violation.points} điểm).`;
    const notif = await Notification.create({
      message: messageText,
      type: 'warning',
      targetRole: 'admin',
      triggeredBy: req.user._id,
      relatedViolation: violation._id
    });
    io.emit('newNotification', notif);

    // Send Web Push Notification to Admins
    const admins = await User.find({ role: 'admin' });
    const pushPayload = JSON.stringify({
      title: 'Có khiếu nại mới ⚠️',
      body: messageText,
      url: '/'
    });

    admins.forEach(admin => {
      if (admin.pushSubscriptions && admin.pushSubscriptions.length > 0) {
        admin.pushSubscriptions.forEach(sub => {
          webpush.sendNotification(sub, pushPayload).catch(e => { });
        });
      }
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/violations/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const violation = await Violation.findByIdAndDelete(req.params.id);
    if (!violation) return res.status(404).json({ error: 'Không tìm thấy lỗi' });

    await Notification.deleteMany({ relatedViolation: req.params.id });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Notifications Routes ─────────────────────────────────────────
app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const session = await Session.findOne({ active: true }).lean();
    let myGroupId = null;
    if (session) {
      for (const g of session.groups) {
        if (g.members.some(m => m.toString() === req.user._id.toString()) ||
          (g.fixedMembers && g.fixedMembers.some(m => m.toString() === req.user._id.toString()))) {
          myGroupId = g.groupId;
          break;
        }
      }
    }

    // Get global notifications and user-specific notifications
    const notifs = await Notification.find({
      $and: [
        { $or: [{ targetUser: null }, { targetUser: req.user._id }] },
        { $or: [{ targetGroup: null }, { targetGroup: myGroupId }] },
        { $or: [{ targetRole: null }, { targetRole: req.user.role }] }
      ]
    }).sort('-createdAt').limit(50).lean();

    // Generate dynamic birthday notifications for the closest upcoming birthday
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize today to midnight for accurate day diff
    const users = await User.find({}, 'fullName dob').lean();
    let minDiff = Infinity;
    let closestUsers = [];

    users.forEach(u => {
      if (!u.dob) return;
      const [d, m, y] = u.dob.split('/');
      if (d && m) {
        let bday = new Date(today.getFullYear(), parseInt(m) - 1, parseInt(d));
        let diffTime = bday - today;
        let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) { // Passed this year, check next year
          bday = new Date(today.getFullYear() + 1, parseInt(m) - 1, parseInt(d));
          diffTime = bday - today;
          diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        if (diffDays < minDiff) {
          minDiff = diffDays;
          closestUsers = [{ user: u, diffDays }];
        } else if (diffDays === minDiff) {
          closestUsers.push({ user: u, diffDays });
        }
      }
    });

    const birthdayNotifs = [];
    closestUsers.forEach(({ user, diffDays }) => {
      birthdayNotifs.push({
        _id: 'bday-' + user._id,
        message: diffDays === 0 ? `Hôm nay là sinh nhật của ${user.fullName}! Chúc mừng sinh nhật!` : `Còn ${diffDays} ngày nữa là đến sinh nhật của ${user.fullName}.`,
        type: 'success',
        createdAt: new Date(),
        targetUser: null
      });
    });

    res.json([...birthdayNotifs, ...notifs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Session Routes (Admin) ───────────────────────────────────────
app.post('/api/admin/session/create', authMiddleware, adminOnly, async (req, res) => {
  try {
    const activeSessions = await Session.find({ active: true });
    for (const s of activeSessions) {
      await Notification.deleteMany({ relatedSession: s._id });
    }
    await Session.updateMany({ active: true }, { active: false, completedAt: new Date() });
    const { subject, mode, groupCount, memberPerGroup, fixedAssignments } = req.body;
    const totalMembers = 25;
    let numGroups = parseInt(groupCount) || 0;
    if (!numGroups && memberPerGroup) numGroups = Math.ceil(totalMembers / parseInt(memberPerGroup));
    if (numGroups < 1) return res.status(400).json({ error: 'Số nhóm không hợp lệ' });
    const baseSize = Math.floor(totalMembers / numGroups);
    const extra = totalMembers % numGroups;
    const groups = [];
    for (let i = 0; i < numGroups; i++) {
      groups.push({ groupId: i + 1, name: `Nhóm ${i + 1}`, capacity: baseSize + (i < extra ? 1 : 0), members: [], fixedMembers: [] });
    }
    const fixedList = fixedAssignments || [];
    for (const fa of fixedList) {
      const grp = groups.find(g => g.groupId === parseInt(fa.groupId));
      if (grp) {
        grp.members.push(new mongoose.Types.ObjectId(fa.userId));
        grp.fixedMembers.push(new mongoose.Types.ObjectId(fa.userId));
      }
    }
    const session = await Session.create({ subject: subject || 'Môn học', mode: mode || 'manual', groups, createdBy: req.user._id, active: true });
    const populated = await session.populate('groups.members groups.fixedMembers', 'fullName username avatar stt');
    await broadcastSessionUpdate();
    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/sessions', authMiddleware, adminOnly, async (req, res) => {
  try {
    const sessions = await Session.find({}).sort('-createdAt').limit(20).populate('groups.members groups.fixedMembers', 'fullName username avatar stt dob phone gender hometown').lean();
    res.json(sessions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/session/stop', authMiddleware, adminOnly, async (req, res) => {
  try {
    const activeSessions = await Session.find({ active: true });
    for (const s of activeSessions) {
      await Notification.deleteMany({ relatedSession: s._id });
    }
    await Session.updateMany({ active: true }, { active: false, completedAt: new Date() });
    await broadcastSessionUpdate();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/session/reset', authMiddleware, adminOnly, async (req, res) => {
  try {
    const session = await Session.findOne({ active: true });
    if (!session) return res.status(404).json({ error: 'Không có phiên nào đang hoạt động' });
    for (const g of session.groups) { g.members = [...g.fixedMembers]; }
    await session.save();
    const populated = await session.populate('groups.members groups.fixedMembers', 'fullName username avatar stt');
    await broadcastSessionUpdate();
    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/session/update-capacity', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { groupId, capacity } = req.body;
    const session = await Session.findOne({ active: true });
    if (!session) return res.status(404).json({ error: 'Không có phiên nào đang hoạt động' });
    const grp = session.groups.find(g => g.groupId === parseInt(groupId));
    if (!grp) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    grp.capacity = parseInt(capacity);
    await session.save();
    await broadcastSessionUpdate();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/session/move-member', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId, fromGroupId, toGroupId } = req.body;
    const session = await Session.findOne({ active: true });
    if (!session) return res.status(404).json({ error: 'Không có phiên nào đang hoạt động' });
    const uid = new mongoose.Types.ObjectId(userId);
    for (const g of session.groups) {
      g.members = g.members.filter(m => m.toString() !== uid.toString());
    }
    if (toGroupId) {
      const toGrp = session.groups.find(g => g.groupId === parseInt(toGroupId));
      if (toGrp) toGrp.members.push(uid);
    }
    await session.save();
    const populated = await session.populate('groups.members groups.fixedMembers', 'fullName username avatar stt');
    await broadcastSessionUpdate();
    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/session/assign-fixed', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId, groupId } = req.body;
    const session = await Session.findOne({ active: true });
    if (!session) return res.status(404).json({ error: 'Không có phiên nào đang hoạt động' });
    const uid = new mongoose.Types.ObjectId(userId);
    for (const g of session.groups) {
      g.members = g.members.filter(m => m.toString() !== uid.toString());
      g.fixedMembers = g.fixedMembers.filter(m => m.toString() !== uid.toString());
    }
    if (groupId) {
      const grp = session.groups.find(g => g.groupId === parseInt(groupId));
      if (grp) { grp.members.push(uid); grp.fixedMembers.push(uid); }
    }
    await session.save();
    const populated = await session.populate('groups.members groups.fixedMembers', 'fullName username avatar stt');
    await broadcastSessionUpdate();
    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/session/auto-assign', authMiddleware, adminOnly, async (req, res) => {
  try {
    const session = await Session.findOne({ active: true });
    if (!session) return res.status(404).json({ error: 'Không có phiên nào đang hoạt động' });
    const allUsers = await User.find({}, '_id').lean();
    const assignedIds = new Set();
    for (const g of session.groups) g.members.forEach(m => assignedIds.add(m.toString()));
    const unassigned = allUsers.map(u => u._id).filter(id => !assignedIds.has(id.toString()));
    for (let i = unassigned.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unassigned[i], unassigned[j]] = [unassigned[j], unassigned[i]];
    }
    let idx = 0;
    for (const g of session.groups) {
      while (g.members.length < g.capacity && idx < unassigned.length) {
        g.members.push(unassigned[idx++]);
      }
    }
    await session.save();
    const populated = await session.populate('groups.members groups.fixedMembers', 'fullName username avatar stt');
    await broadcastSessionUpdate();
    res.json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CSV export đã được thay thế bằng PDF export phía client

// ─── Session Status (User + Admin) ────────────────────────────────
app.get('/api/session/status', authMiddleware, async (req, res) => {
  try {
    const session = await Session.findOne({ active: true }).populate('groups.members groups.fixedMembers', 'fullName username avatar stt').lean();
    if (!session) {
      const lastSession = await Session.findOne({ active: false }).sort({ createdAt: -1 }).populate('groups.members groups.fixedMembers', 'fullName username avatar stt').lean();
      return res.json({ active: false, lastSession });
    }
    const myId = req.user._id.toString();
    let myGroup = null;
    let isFixed = false;
    for (const g of session.groups) {
      const inGroup = g.members.some(m => m._id.toString() === myId);
      const inFixed = g.fixedMembers.some(m => m._id.toString() === myId);
      if (inGroup) { myGroup = g.groupId; if (inFixed) isFixed = true; break; }
    }
    res.json({ active: true, session: { _id: session._id, subject: session.subject, mode: session.mode, groups: session.groups, createdAt: session.createdAt }, myGroup, isFixed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Join Group (User + Admin in user mode) ────────────────────────
app.post('/api/session/join', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.body;
    const session = await Session.findOne({ active: true });
    if (!session) return res.status(404).json({ error: 'Không có phiên nào đang hoạt động' });
    
    // NGĂN CHẶN BYPASS BẰNG API KHI ĐANG Ở CHẾ ĐỘ RANDOM
    if (session.mode !== 'manual') {
      return res.status(403).json({ error: 'Hành vi bị chặn: Phiên này chỉ cho phép hệ thống bốc thăm ngẫu nhiên!' });
    }

    const uid = new mongoose.Types.ObjectId(req.user._id);
    for (const g of session.groups) {
      if (g.fixedMembers.some(m => m.toString() === uid.toString())) {
        return res.status(403).json({ error: 'Bạn đã được Admin xếp cố định vào nhóm, không thể thay đổi' });
      }
    }
    for (const g of session.groups) {
      g.members = g.members.filter(m => m.toString() !== uid.toString());
    }
    const targetGroup = session.groups.find(g => g.groupId === parseInt(groupId));
    if (!targetGroup) return res.status(404).json({ error: 'Nhóm không tồn tại' });
    if (targetGroup.members.length >= targetGroup.capacity) return res.status(400).json({ error: 'Nhóm đã đầy' });
    targetGroup.members.push(uid);
    await session.save();
    const populated = await session.populate('groups.members groups.fixedMembers', 'fullName username avatar stt');
    await broadcastSessionUpdate();

    // Tạo notification
    const notif = await Notification.create({
      message: `${req.user.fullName} vừa vào ${targetGroup.name}.`,
      type: 'success',
      targetGroup: targetGroup.groupId,
      triggeredBy: req.user._id,
      relatedSession: session._id
    });
    io.emit('newNotification', notif);

    // Send Web Push Notification to group members
    const targetUsers = await User.find({ _id: { $in: targetGroup.members } });
    const pushPayload = JSON.stringify({
      title: 'Thành viên mới 🎉',
      body: `${req.user.fullName} vừa tham gia ${targetGroup.name}.`,
      url: '/'
    });
    targetUsers.forEach(u => {
      if (u._id.toString() !== req.user._id.toString() && u.pushSubscriptions && u.pushSubscriptions.length > 0) {
        u.pushSubscriptions.forEach(sub => {
          webpush.sendNotification(sub, pushPayload).catch(e => console.error('Push error:', e));
        });
      }
    });

    const myId = uid.toString();
    let myGroup = null, isFixed = false;
    for (const g of populated.groups) {
      if (g.members.some(m => m._id.toString() === myId)) {
        myGroup = g.groupId;
        if (g.fixedMembers.some(m => m._id.toString() === myId)) isFixed = true;
        break;
      }
    }
    res.json({ ok: true, myGroup, isFixed, groups: populated.groups });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/session/leave', authMiddleware, async (req, res) => {
  try {
    const session = await Session.findOne({ active: true });
    if (!session) return res.status(404).json({ error: 'Không có phiên nào đang hoạt động' });
    
    // NGĂN CHẶN BYPASS BẰNG API KHI ĐANG Ở CHẾ ĐỘ RANDOM
    if (session.mode !== 'manual') {
      return res.status(403).json({ error: 'Hành vi bị chặn: Phiên này chỉ cho phép hệ thống bốc thăm ngẫu nhiên!' });
    }

    const uid = req.user._id.toString();
    for (const g of session.groups) {
      if (g.fixedMembers.some(m => m.toString() === uid)) {
        return res.status(403).json({ error: 'Bạn đã được Admin xếp cố định, không thể rời nhóm' });
      }
    }
    for (const g of session.groups) {
      g.members = g.members.filter(m => m.toString() !== uid);
    }
    await session.save();
    await broadcastSessionUpdate();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/session/spin', authMiddleware, async (req, res) => {
  try {
    const session = await Session.findOne({ active: true });
    if (!session) return res.status(404).json({ error: 'Không có phiên nào đang hoạt động' });
    if (session.mode !== 'random') return res.status(400).json({ error: 'Phiên này không phải chế độ random' });
    const uid = new mongoose.Types.ObjectId(req.user._id);
    for (const g of session.groups) {
      if (g.fixedMembers.some(m => m.toString() === uid.toString())) {
        return res.status(403).json({ error: 'Bạn đã được Admin xếp cố định vào nhóm' });
      }
    }
    for (const g of session.groups) {
      if (g.members.some(m => m.toString() === uid.toString())) {
        return res.status(400).json({ error: 'Bạn đã được xếp nhóm rồi' });
      }
    }
    const available = session.groups.filter(g => g.members.length < g.capacity);
    if (available.length === 0) return res.status(400).json({ error: 'Tất cả các nhóm đã đầy' });
    const chosen = available[Math.floor(Math.random() * available.length)];
    chosen.members.push(uid);
    await session.save();
    await broadcastSessionUpdate();

    // Tạo notification
    const notif = await Notification.create({
      message: `${req.user.fullName} vừa bốc thăm vào ${chosen.name}.`,
      type: 'success',
      targetGroup: chosen.groupId,
      triggeredBy: req.user._id,
      relatedSession: session._id
    });
    io.emit('newNotification', notif);

    // Send Web Push Notification to group members
    const targetUsers = await User.find({ _id: { $in: chosen.members } });
    const pushPayload = JSON.stringify({
      title: 'Thành viên mới 🎉',
      body: `${req.user.fullName} vừa bốc thăm vào ${chosen.name}.`,
      url: '/'
    });
    targetUsers.forEach(u => {
      if (u._id.toString() !== req.user._id.toString() && u.pushSubscriptions && u.pushSubscriptions.length > 0) {
        u.pushSubscriptions.forEach(sub => {
          webpush.sendNotification(sub, pushPayload).catch(e => console.error('Push error:', e));
        });
      }
    });

    res.json({ ok: true, groupId: chosen.groupId, groupName: chosen.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Admin reset password for a user ─────────────────────────────
app.post('/api/admin/user/reset-password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId } = req.body;
    const targetUser = await User.findById(userId).lean();
    if (!targetUser) return res.status(404).json({ error: 'Người dùng không tồn tại.' });
    const defaultPw = dobToPassword(targetUser.dob);
    const hashed = await bcrypt.hash(defaultPw, 10);
    await User.findByIdAndUpdate(userId, { password: hashed });
    res.json({ ok: true, message: `Đã reset về mật khẩu mặc định: ${defaultPw}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Catch all → serve SPA ────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Cron Job: Chúc mừng sinh nhật lúc 07:00 sáng mỗi ngày ──────────
cron.schedule('0 7 * * *', async () => {
  try {
    const today = new Date();
    // Format ngày sinh theo định dạng trong DB (dd/mm/yyyy), ví dụ "08/06"
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const searchString = `${day}/${month}`; // Chứa dd/mm

    const allUsers = await User.find({}).lean();
    const birthdayUsers = allUsers.filter(u => u.dob && u.dob.startsWith(searchString));

    if (birthdayUsers.length > 0) {
      const names = birthdayUsers.map(u => u.fullName).join(', ');
      const messageText = `🎉 Chúc mừng sinh nhật: ${names}! Hãy gửi những lời chúc tốt đẹp nhất đến ${birthdayUsers.length > 1 ? 'các bạn ấy' : 'bạn ấy'} nhé! 🎂`;

      const pushPayload = JSON.stringify({
        title: 'Thông báo sinh nhật 🥳',
        body: messageText,
        url: '/'
      });

      // Gửi cho tất cả mọi người trong lớp
      for (const u of allUsers) {
        if (u.pushSubscriptions && u.pushSubscriptions.length > 0) {
          for (const sub of u.pushSubscriptions) {
            webpush.sendNotification(sub, pushPayload).catch(e => { });
          }
        }
      }
    }
  } catch (err) {
    console.error('Lỗi khi chạy cron sinh nhật:', err);
  }
});

// ─── Khởi động Server ─────────────────────────────────────────────
mongoose.connect(MONGODB_URI).then(async () => {
  console.log('✅ Connected to MongoDB');
  await initVapidKeys();
  await seedDatabase();

  // Migration: update existing squad 2 members if they exist and are not set
  try {
    const squad2Names = ["Nguyễn Phương Duy", "Nguyễn Tuấn Đạt", "Nguyễn Đăng Hải", "Lê Quang Quốc Hiệu", "Đào Văn Xuân Hoàng", "Nguyễn Hữu Hoàng", "Huỳnh Quốc Khải", "Phan Huỳnh Khang", "Trần Lê Na", "Nguyễn Hải Long", "Trịnh Duy Tuấn", "Lê Thanh Tùng", "Lê Phước Vinh"];
    await User.updateMany(
      { fullName: { $in: squad2Names }, squad: { $ne: 2 } },
      { $set: { squad: 2 } }
    );
  } catch (e) {
    console.error("Migration error:", e);
  }

  // Migration: Sửa năm sinh Nguyễn Gia Tuyến → 2005 + reset mật khẩu
  try {
    const tuyen = await User.findOne({ username: 'nguyengiatuyen' });
    if (tuyen && tuyen.dob === '18/11/2004') {
      const newDob = '18/11/2005';
      const newPw = await bcrypt.hash(dobToPassword(newDob), 10);
      await User.updateOne(
        { username: 'nguyengiatuyen' },
        { $set: { dob: newDob, password: newPw } }
      );
      console.log('✅ Migration: Đã sửa năm sinh + reset mật khẩu Nguyễn Gia Tuyến → 2005');
    }
  } catch (e) {
    console.error('Migration error (Nguyễn Gia Tuyến):', e);
  }

  server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}).catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});
