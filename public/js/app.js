/* ════════════════════════════════════════════════════════════════════
   app.js — Ứng dụng Quản lý Nhóm Lớp Học
   - JWT auth (bền vững qua restart Render)
   - Socket.io realtime (không cần polling)
   - Admin có thể chuyển sang chế độ học sinh để chọn nhóm/quay random
   ════════════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────────
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

let state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  session: null,
  myGroup: null,
  isFixed: false,
  members: [],
  isAdminInUserMode: false,  // Admin đang xem giao diện học sinh
  selectedAvatarEmoji: null,
};

const lockIcon = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-0.125em;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

// ─── Socket.io ────────────────────────────────────────────────────────
const socket = io({
  auth: (cb) => {
    cb({ token: localStorage.getItem('token') });
  }
});

socket.on('connect', () => {
  console.log('🔌 Socket.io connected:', socket.id);
});

socket.on('sessionUpdated', (session) => {
  state.session = session;
  const inUserView = document.getElementById('view-user').classList.contains('active');
  const inAdminView = document.getElementById('view-admin').classList.contains('active');

  if (inUserView || (inAdminView && state.isAdminInUserMode)) {
    const myId = state.user?.id?.toString();
    let myGroup = null, isFixed = false;
    if (session && myId) {
      for (const g of session.groups) {
        const inGroup = g.members.some(m => (m._id || m).toString() === myId);
        const inFixed = g.fixedMembers.some(m => (m._id || m).toString() === myId);
        if (inGroup) { myGroup = g.groupId; if (inFixed) isFixed = true; break; }
      }
    }
    state.myGroup = myGroup;
    state.isFixed = isFixed;
    renderUserSession({ active: !!session, session, myGroup, isFixed });
  }

  if (inAdminView && !state.isAdminInUserMode) {
    const data = { active: !!session, session };
    renderAdminStats(data);
    const manageTab = document.getElementById('tab-manage');
    if (manageTab && manageTab.classList.contains('active') && session) {
      renderAdminGroups(session);
    }
    const alert = document.getElementById('active-session-alert');
    if (session) {
      alert.classList.remove('hidden');
      alert.style.display = 'flex';
      document.getElementById('active-session-name').textContent =
        ` "${session.subject}" — ${session.mode === 'manual' ? 'Tự chọn' : 'Random'} — ${session.groups.length} nhóm`;
      document.getElementById('session-creator-box')?.classList.add('hidden');
    } else {
      alert.classList.add('hidden');
      document.getElementById('session-creator-box')?.classList.remove('hidden');
    }
  }
});

// ─── API Base ─────────────────────────────────────────────────────────
const API = {
  async req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    return data;
  },
  get: (path) => API.req('GET', path),
  post: (path, body) => API.req('POST', path, body),
  patch: (path, body) => API.req('PATCH', path, body),
  delete: (path) => API.req('DELETE', path),
};

// ─── Toast ────────────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  document.getElementById('toast-container').prepend(el);
  setTimeout(() => {
    el.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ─── Views ────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = id === 'view-login' ? 'hidden' : '';
}

function showLoginView() {
  document.getElementById('app-layout').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('layout-container');
  showView('view-login');
}

async function loadFullProfile() {
  if (!state.user) return;
  try {
    const data = await API.get('/api/user/me');
    state.user = { ...state.user, ...data };
    localStorage.setItem('user', JSON.stringify(state.user));
    updateNavbar();
  } catch (err) { }
}

function showUserView() {
  document.getElementById('app-layout').classList.remove('hidden');
  document.getElementById('app-layout').classList.add('layout-container');
  updateNavbar();
  loadFullProfile();
  showView('view-user');
  loadClassMembersBackground();
  fetchSessionStatus();
  fetchNotifications();
}

function showAdminView() {
  document.getElementById('app-layout').classList.remove('hidden');
  document.getElementById('app-layout').classList.add('layout-container');
  state.isAdminInUserMode = false;
  updateNavbar();
  loadFullProfile();
  showView('view-admin');
  loadClassMembersBackground(true);
  loadAdminSession();
  fetchNotifications();
}

// ─── Navbar & Sidebar ───────────────────────────────────────────────────
function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  if (sidebar && overlay) {
    if (sidebar.classList.contains('show')) {
      sidebar.classList.remove('show');
      overlay.classList.remove('show');
    } else {
      sidebar.classList.add('show');
      overlay.classList.add('show');
    }
  }
}

// ─── Swipe Gestures for Sidebar ───────────────────────────────────────
let touchstartX = 0;
let touchendX = 0;
const SWIPE_THRESHOLD = 50;

document.addEventListener('touchstart', e => {
  touchstartX = e.changedTouches[0].screenX;
});

document.addEventListener('touchend', e => {
  touchendX = e.changedTouches[0].screenX;
  if (window.innerWidth <= 768) {
    handleSwipeGesture();
  }
});

function handleSwipeGesture() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  if (!sidebar || !overlay) return;

  // Vuốt từ TRÁI sang PHẢI (Mở sidebar) - chỉ nhận diện nếu vuốt từ rìa màn hình (<30px)
  if (touchendX - touchstartX > SWIPE_THRESHOLD && touchstartX < 30) {
    if (!sidebar.classList.contains('show')) {
      sidebar.classList.add('show');
      overlay.classList.add('show');
    }
  }

  // Vuốt từ PHẢI sang TRÁI (Đóng sidebar)
  if (touchstartX - touchendX > SWIPE_THRESHOLD) {
    if (sidebar.classList.contains('show')) {
      sidebar.classList.remove('show');
      overlay.classList.remove('show');
    }
  }
}

function updateNavbar() {
  if (!state.user) return;
  const avatarEl = document.getElementById('sidebar-avatar');
  if (avatarEl) setAvatarEl(avatarEl, state.user.avatar, state.user.fullName);

  const nameEl = document.getElementById('sidebar-username');
  if (nameEl) {
    const parts = state.user.fullName.trim().split(' ');
    nameEl.textContent = parts[parts.length - 1];
  }

  const roleEl = document.getElementById('sidebar-role');
  if (roleEl) roleEl.textContent = state.user.role === 'admin' ? 'Quản trị viên' : 'Học viên';

  const dobEl = document.getElementById('sidebar-dob');
  if (dobEl) dobEl.textContent = state.user.dob || 'Chưa cập nhật';

  const hometownEl = document.getElementById('sidebar-hometown');
  if (hometownEl) hometownEl.textContent = state.user.hometown || 'Chưa cập nhật';

  const toggleBtn = document.getElementById('btn-admin-toggle');
  if (state.user.role === 'admin') {
    toggleBtn.classList.remove('hidden');
    if (state.isAdminInUserMode) {
      toggleBtn.textContent = '🛠️ Admin';
      toggleBtn.style.background = 'var(--amber)';
    } else {
      toggleBtn.textContent = '🎓 Học viên';
      toggleBtn.style.background = '';
    }
  } else {
    toggleBtn.classList.add('hidden');
  }
}

function setAvatarEl(el, avatar, fullName) {
  if (avatar && avatar.startsWith('data:')) {
    el.innerHTML = `<img src="${avatar}" alt="${fullName}" style="width: 100%; height: 100%; object-fit: cover;" />`;
  } else if (avatar) {
    el.textContent = avatar;
    el.style.background = 'none';
    el.style.fontSize = ''; // Remove hardcoded 16px so CSS can control it
  } else {
    el.textContent = (fullName || '?').charAt(0).toUpperCase();
    el.style.background = '';
    el.style.fontSize = '';
  }
}

// ─── Admin ↔ User mode toggle ─────────────────────────────────────────
function toggleAdminUserMode() {
  if (!state.user || state.user.role !== 'admin') return;
  if (state.isAdminInUserMode) {
    // Quay về trang quản trị
    state.isAdminInUserMode = false;
    showAdminView();
    toast('Quay lại trang Quản trị', 'info');
  } else {
    // Chuyển sang chế độ học sinh
    state.isAdminInUserMode = true;
    updateNavbar();
    showView('view-user');
    fetchSessionStatus();
    toast('Đã chuyển sang chế độ Học viên', 'info');
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btnText = document.getElementById('login-btn-text');
  const spinner = document.getElementById('login-spinner');
  btnText.textContent = 'Đang đăng nhập...';
  spinner.classList.remove('hidden');
  document.getElementById('login-btn').disabled = true;
  try {
    const data = await API.post('/api/auth/login', { username, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    toast(`Chào mừng, ${data.user.fullName}! 👋`, 'success');
    if (data.user.role === 'admin') showAdminView();
    else showUserView();
    // Default to violations tab after login
    const violationTab = document.querySelector('[data-tab="tab-danh-sach-loi"]');
    if (violationTab) switchAppTab('tab-danh-sach-loi', violationTab);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btnText.textContent = 'Đăng nhập';
    spinner.classList.add('hidden');
    document.getElementById('login-btn').disabled = false;
  }
}

async function logout() {
  if (!confirm('Bạn có chắc chắn muốn đăng xuất?')) return;
  try { await API.post('/api/auth/logout'); } catch { }
  state.token = null;
  state.user = null;
  state.isAdminInUserMode = false;
  localStorage.removeItem('token');
  localStorage.removeItem('user');

  document.getElementById('sidebar-username').textContent = '—';
  const avatarEl = document.getElementById('sidebar-avatar');
  avatarEl.innerHTML = '👤';
  avatarEl.style.background = '';

  showLoginView();
  toast('Đã đăng xuất', 'info');
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = `<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94'/><path d='M1 1l22 22'/><path d='M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19'/></svg>`;
  } else {
    input.type = 'password';
    btn.innerHTML = `<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>`;
  }
}

// ─── Fetch session on load (initial state) ────────────────────────────
async function fetchSessionStatus() {
  try {
    const data = await API.get('/api/session/status');
    state.session = data.active ? data.session : null;
    state.myGroup = data.myGroup || null;
    state.isFixed = data.isFixed || false;
    renderUserSession(data);
  } catch { }
}

async function refreshGroups(btn) {
  if (btn) {
    btn.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    btn.disabled = true;
  }
  await fetchSessionStatus();
  if (state.user && state.user.role === 'admin' && typeof loadAdminSessions === 'function') {
    try { await loadAdminSessions(); } catch (e) { }
  }
  if (btn) {
    btn.innerHTML = '🔄 Làm mới';
    btn.disabled = false;
  }
}

// ─── Class Members (background load) ─────────────────────────────────
async function loadClassMembersBackground(isAdmin = false) {
  try {
    const members = await API.get('/api/class/members');
    state.members = members;
  } catch { }
}

// ─── User Session Rendering ───────────────────────────────────────────
function renderUserSession(data) {
  const banner = document.getElementById('session-banner');
  const noSession = document.getElementById('no-session-placeholder');
  const groupsSection = document.getElementById('groups-section');
  const myGroupCard = document.getElementById('my-group-card');
  const sliderTrigger = document.getElementById('slider-trigger-section');

  if (!data.active && !data.lastSession) {
    banner.classList.add('hidden');
    noSession.classList.remove('hidden');
    groupsSection.classList.add('hidden');
    myGroupCard.classList.add('hidden');
    sliderTrigger.classList.add('hidden');
    return;
  }

  const session = data.active ? data.session : data.lastSession;

  noSession.classList.add('hidden');
  banner.classList.remove('hidden');
  document.getElementById('sb-subject').textContent = session.subject;
  document.getElementById('sb-mode-badge').innerHTML =
    session.mode === 'manual' ? '🖱️ Tự chọn' : '🎰 Ngẫu nhiên';
  document.getElementById('sb-groups-badge').innerHTML = `${session.groups.length} nhóm`;

  // Nếu là lịch sử (không active)
  if (!data.active) {
    document.getElementById('sb-mode-badge').innerHTML = 'Đã kết thúc';
    document.getElementById('sb-mode-badge').className = 'badge'; // xám
    data.myGroup = null;
  } else {
    document.getElementById('sb-mode-badge').className = 'badge badge-purple';
  }

  if (data.myGroup && data.active) {
    myGroupCard.classList.remove('hidden');
    const grp = session.groups.find(g => g.groupId === data.myGroup);
    document.getElementById('my-group-name').textContent = grp ? grp.name : `Nhóm ${data.myGroup}`;
    const fixedMsg = document.getElementById('my-group-fixed-msg');
    if (data.isFixed) fixedMsg.classList.remove('hidden'); else fixedMsg.classList.add('hidden');
    sliderTrigger.classList.add('hidden');
    groupsSection.classList.remove('hidden');
  } else {
    myGroupCard.classList.add('hidden');
    groupsSection.classList.remove('hidden');
    if (session.mode === 'random' && data.active) {
      sliderTrigger.classList.remove('hidden');
    } else {
      sliderTrigger.classList.add('hidden');
    }
  }

  renderGroupsGrid(session, data.myGroup, data.isFixed, data.active ? session.mode : 'history');
}

function renderGroupsGrid(session, myGroupId, isFixed, mode) {
  const grid = document.getElementById('groups-grid');
  if (!grid) return;

  const colors = ['var(--purple)', 'var(--cyan)', 'var(--rose)', 'var(--green)', 'var(--amber)', '#ec4899', '#f97316', '#84cc16'];
  const cooldownEnd = parseInt(localStorage.getItem('groupJoinCooldown') || '0');
  const now = Date.now();
  const cdRemaining = Math.max(0, Math.ceil((cooldownEnd - now) / 1000));
  const inCooldown = cdRemaining > 0;

  if (inCooldown && typeof window.startCooldownTimer === 'function') {
    window.startCooldownTimer();
  }

  grid.innerHTML = session.groups.map((g, idx) => {
    const pct = g.capacity > 0 ? (g.members.length / g.capacity) * 100 : 0;
    const isFull = g.members.length >= g.capacity;
    const isMyGroup = myGroupId === g.groupId;
    const isJoinableTarget = !isMyGroup && !isFull && !isFixed && mode === 'manual';
    const canJoin = isJoinableTarget && !inCooldown;
    const color = colors[idx % colors.length];
    const emptySlots = g.capacity - g.members.length;

    const membersHtml = g.members.map(m => {
      const isFixedMember = g.fixedMembers && g.fixedMembers.some(f => (f._id || f) === (m._id || m));
      const avatarHtml = m.avatar && m.avatar.startsWith('data:')
        ? `<img src="${m.avatar}" alt="" />`
        : (m.avatar || m.fullName.charAt(0));
      return `<div class="member-item" style="cursor:pointer;" onclick="event.stopPropagation();showUserProfileModal('${m._id}')">
        <div class="member-avatar-sm">${avatarHtml}</div>
        <span class="member-name">${escapeHTML(m.fullName)}</span>
        ${isFixedMember ? `<span class="member-fixed">${lockIcon}</span>` : ''}
      </div>`;
    }).join('');

    return `<div class="group-card ${canJoin ? 'joinable' : ''} ${isFull ? 'full' : ''} ${isMyGroup ? 'my-group' : ''}"
      onclick="${canJoin ? `joinGroup(${g.groupId})` : ''}" >
      <div class="group-header">
        <span class="group-name" style="color:${color}">${escapeHTML(g.name)}</span>
        <span class="group-count">${g.members.length}/${g.capacity}</span>
      </div>
      <div class="group-progress-bar">
        <div class="group-progress-fill" style="width:${pct}%;background:${color};"></div>
      </div>
      <div class="group-members">${membersHtml}</div>
      ${emptySlots > 0 ? `<div class="group-empty-slots">+${emptySlots} chỗ trống</div>` : ''}
      ${isJoinableTarget && !inCooldown ? `<button class="btn btn-primary btn-sm group-join-btn" onclick="joinGroup(${g.groupId});event.stopPropagation()">Tham gia</button>` : ''}
      ${isJoinableTarget && inCooldown ? `<button class="btn btn-secondary btn-sm group-join-btn" disabled onclick="event.stopPropagation()">⏳ Đợi ${cdRemaining}s</button>` : ''}
      ${isMyGroup ? `<div style="margin-top:8px;font-size:11px;color:var(--green);font-weight:700;">✓ Nhóm của bạn</div>` : ''}
    </div>`;
  }).join('');
}

// ─── Join / Leave Group ───────────────────────────────────────────────
let isJoiningGroup = false;
let cooldownInterval = null;
window.startCooldownTimer = function () {
  if (cooldownInterval) return;
  cooldownInterval = setInterval(() => {
    const end = parseInt(localStorage.getItem('groupJoinCooldown') || '0');
    if (Date.now() >= end) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
    if (state.session && state.session.active !== false && state.session.mode === 'manual') {
      renderGroupsGrid(state.session, state.myGroup, state.isFixed, state.session.mode);
    }
  }, 1000);
};

async function joinGroup(groupId) {
  if (isJoiningGroup) return;
  const cooldownEnd = parseInt(localStorage.getItem('groupJoinCooldown') || '0');
  if (Date.now() < cooldownEnd) {
    toast(`Vui lòng đợi ${Math.ceil((cooldownEnd - Date.now()) / 1000)}s để đổi nhóm`, 'warning');
    return;
  }
  isJoiningGroup = true;
  try {
    const data = await API.post('/api/session/join', { groupId });
    state.myGroup = data.myGroup;
    localStorage.setItem('groupJoinCooldown', Date.now() + 15000);
    window.startCooldownTimer();
    if (state.session && state.session.active !== false && state.session.mode === 'manual') {
      renderGroupsGrid(state.session, state.myGroup, state.isFixed, state.session.mode);
    }
    toast(`Đã tham gia Nhóm ${groupId}! 🎉`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    isJoiningGroup = false;
  }
}

// ─── Admin Stats ──────────────────────────────────────────────────────
function renderAdminStats(data) {
  // Stats cards removed per user request
}

// ─── Admin Session ────────────────────────────────────────────────────
async function loadAdminSession() {
  try {
    const data = await API.get('/api/session/status');
    state.session = data.active ? data.session : null;
    state.myGroup = data.myGroup || null;
    state.isFixed = data.isFixed || false;
    renderAdminStats(data);
    updateManageTab(data);
    const alert = document.getElementById('active-session-alert');
    if (data.active) {
      alert.classList.remove('hidden');
      alert.style.display = 'flex';
      document.getElementById('active-session-name').textContent =
        ` "${data.session.subject}" — ${data.session.mode === 'manual' ? 'Tự chọn' : 'Random'} — ${data.session.groups.length} nhóm`;
      document.getElementById('session-creator-box')?.classList.add('hidden');
    } else {
      alert.classList.add('hidden');
      document.getElementById('session-creator-box')?.classList.remove('hidden');
    }
  } catch (err) { toast(err.message, 'error'); }
}

function updateManageTab(data) {
  const noMsg = document.getElementById('no-active-session-msg');
  const content = document.getElementById('manage-content');
  if (!data.active || !data.session) {
    noMsg.classList.remove('hidden'); content.classList.add('hidden');
    return;
  }
  noMsg.classList.add('hidden'); content.classList.remove('hidden');
  document.getElementById('manage-session-title').textContent =
    `📋 ${data.session.subject} — ${data.session.mode === 'manual' ? 'Tự chọn' : 'Random'}`;
  renderAdminGroups(data.session);

  if (state.members.length > 0) {
    renderFixedAssignList(data.session);
  } else {
    API.get('/api/class/members').then(members => {
      state.members = members;
      renderFixedAssignList(data.session);
    }).catch(() => { });
  }
}

function renderAdminGroups(session) {
  const grid = document.getElementById('admin-groups-grid');
  if (!grid) return;
  const colors = ['var(--purple)', 'var(--cyan)', 'var(--rose)', 'var(--green)', 'var(--amber)', '#ec4899', '#f97316', '#84cc16'];

  grid.innerHTML = session.groups.map((g, idx) => {
    const color = colors[idx % colors.length];
    const membersHtml = g.members.map(m => {
      const isFixedMember = g.fixedMembers && g.fixedMembers.some(f => (f._id || f).toString() === (m._id || m).toString());
      const avatarHtml = m.avatar && m.avatar.startsWith('data:') ? `<img src="${m.avatar}" alt="" />` : (m.avatar || m.fullName.charAt(0));
      return `<div class="admin-member-item">
        <div class="member-avatar-sm">${avatarHtml}</div>
        <span class="admin-member-name">${escapeHTML(m.fullName)} ${isFixedMember ? lockIcon : ''}</span>
        <div class="admin-member-actions">
          <select class="input" style="padding:3px 6px;font-size:11px;height:26px;" onchange="moveMember('${m._id}', ${g.groupId}, this.value, this)">
            <option value="">Chuyển...</option>
            ${session.groups.filter(gg => gg.groupId !== g.groupId).map(gg =>
        `<option value="${gg.groupId}">${escapeHTML(gg.name)}</option>`
      ).join('')}
            <option value="remove">❌ Bỏ khỏi nhóm</option>
          </select>
        </div>
      </div>`;
    }).join('');
    return `<div class="card admin-group-card">
      <div class="admin-group-header">
        <span class="admin-group-name" style="color:${color}">${escapeHTML(g.name)}</span>
        <div class="capacity-editor">
          <button class="capacity-btn" onclick="changeCapacity(${g.groupId}, -1)">−</button>
          <span class="capacity-val">${g.members.length}/<strong>${g.capacity}</strong></span>
          <button class="capacity-btn" onclick="changeCapacity(${g.groupId}, 1)">+</button>
        </div>
      </div>
      <div class="group-progress-bar">
        <div class="group-progress-fill" style="width:${g.capacity > 0 ? (g.members.length / g.capacity * 100) : 0}%;background:${color};"></div>
      </div>
      <div>${membersHtml}</div>
      ${g.members.length === 0 ? '<div style="font-size:12px;color:var(--text-3);padding:6px 0;text-align:center">Chưa có thành viên</div>' : ''}
    </div>`;
  }).join('');

  // Unassigned
  const allMemberIds = new Set();
  session.groups.forEach(g => g.members.forEach(m => allMemberIds.add((m._id || m).toString())));
  const unassigned = state.members.filter(m => !allMemberIds.has(m._id.toString()));
  document.getElementById('unassigned-count').textContent = unassigned.length;
  document.getElementById('unassigned-list').innerHTML = unassigned.map(m =>
    `<span class="unassigned-chip">${escapeHTML(m.fullName)}</span>`
  ).join('');
}

function renderFixedAssignList(session) {
  const list = document.getElementById('fixed-assign-list');
  if (!list || !state.members.length) return;

  list.innerHTML = state.members.map(m => {
    let currentGroupId = null;
    let isFixed = false;
    for (const g of session.groups) {
      const fixedIds = g.fixedMembers.map(f => (f._id || f).toString());
      if (fixedIds.includes(m._id.toString())) { currentGroupId = g.groupId; isFixed = true; break; }
    }
    const options = session.groups.map(g => `<option value="${g.groupId}" ${currentGroupId === g.groupId ? 'selected' : ''}>${escapeHTML(g.name)}</option>`).join('');
    return `<div class="assign-item">
      <div class="member-avatar-sm">${m.avatar && m.avatar.startsWith('data:') ? `<img src="${m.avatar}" alt="" />` : (m.avatar || m.fullName.charAt(0))}</div>
      <span class="assign-item-name">${escapeHTML(m.fullName)} ${isFixed ? lockIcon : ''}</span>
      <div class="assign-item-group" style="display:flex;gap:5px;align-items:center;">
        <select class="input" style="padding:5px 8px;font-size:12px;" id="fixed-select-${m._id}">
          <option value="">Không cố định</option>
          ${options}
        </select>
        <button class="btn btn-primary btn-sm" onclick="applyFixed('${m._id}')">OK</button>
      </div>
    </div>`;
  }).join('');
}

async function applyFixed(userId) {
  const sel = document.getElementById(`fixed-select-${userId}`);
  const groupId = sel.value || null;
  try {
    const data = await API.post('/api/admin/session/assign-fixed', { userId, groupId });
    toast(groupId ? `${lockIcon} Đã xếp cố định!` : 'Đã bỏ xếp cố định', 'success');
    state.session = data;
    renderFixedAssignList(data);
    renderAdminGroups(data);
  } catch (err) { toast(err.message, 'error'); }
}

async function moveMember(userId, fromGroupId, toGroupIdStr, selectEl) {
  if (!toGroupIdStr) return;
  const toGroupId = toGroupIdStr === 'remove' ? null : toGroupIdStr;
  try {
    const data = await API.post('/api/admin/session/move-member', { userId, fromGroupId, toGroupId });
    state.session = data;
    renderAdminGroups(data);
    toast('Đã chuyển thành viên', 'success');
  } catch (err) {
    toast(err.message, 'error');
    selectEl.value = '';
  }
}

async function changeCapacity(groupId, delta) {
  if (!state.session) return;
  const grp = state.session.groups.find(g => g.groupId === groupId);
  if (!grp) return;
  const newCap = Math.max(grp.members.length, grp.capacity + delta);
  try {
    await API.post('/api/admin/session/update-capacity', { groupId, capacity: newCap });
    // Socket.io sẽ tự broadcast cập nhật
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Admin Actions ────────────────────────────────────────────────────
function updateGroupHint() {
  const count = parseInt(document.getElementById('f-group-count').value);
  const hint = document.getElementById('group-capacity-hint');
  if (!hint) return;
  if (!count || count <= 0) { hint.textContent = ''; return; }
  const base = Math.floor(25 / count);
  const rem = 25 % count;
  if (rem === 0) hint.textContent = `Khoảng ${base} người/nhóm`;
  else hint.textContent = `Khoảng ${base} - ${base + 1} người/nhóm`;
}

async function createSession() {
  const subject = document.getElementById('f-subject').value.trim() || 'Môn học';
  const mode = document.querySelector('input[name="f-mode"]:checked')?.value || 'manual';
  const groupCount = parseInt(document.getElementById('f-group-count').value) || 0;
  if (!groupCount) { toast('Vui lòng nhập số lượng nhóm', 'warning'); return; }
  try {
    const btn = document.getElementById('btn-create-session');
    btn.disabled = true; btn.textContent = 'Đang tạo...';
    await API.post('/api/admin/session/create', { subject, mode, groupCount });
    toast(`Đã tạo phiên "${subject}" thành công!`, 'success');
    await loadAdminSession();
    switchTab('tab-manage', document.querySelector('[data-tab="tab-manage"]'));
  } catch (err) { toast(err.message, 'error'); }
  finally {
    const btn = document.getElementById('btn-create-session');
    btn.disabled = false; btn.textContent = '🚀 Tạo phiên chia nhóm';
  }
}

async function stopSession() {
  if (!confirm('Bạn có chắc muốn kết thúc phiên này?')) return;
  try {
    await API.post('/api/admin/session/stop');
    state.session = null;
    toast('Đã kết thúc phiên', 'info');
    await loadAdminSession();
  } catch (err) { toast(err.message, 'error'); }
}

async function resetSession() {
  if (!confirm('Reset sẽ xóa toàn bộ phân chia nhóm (trừ cố định). Bạn có chắc?')) return;
  try {
    const data = await API.post('/api/admin/session/reset');
    state.session = data;
    renderAdminGroups(data);
    toast('Đã reset nhóm', 'info');
  } catch (err) { toast(err.message, 'error'); }
}

async function autoAssignRemaining() {
  try {
    const data = await API.post('/api/admin/session/auto-assign');
    state.session = data;
    renderAdminGroups(data);
    toast('🎲 Đã chia ngẫu nhiên người còn lại!', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ─── PDF Export (Client-side) ─────────────────────────────────────────
async function exportSessionPDF(sessionId) {
  try {
    toast('⏳ Đang tạo PDF...', 'info');
    const res = await API.get(`/api/admin/sessions`);
    const session = res.find(s => s._id === sessionId);
    if (!session) throw new Error('Không tìm thấy dữ liệu phiên');

    // Tạo HTML tạm thời để xuất PDF bằng font tiếng Việt hiện tại
    const container = document.createElement('div');
    container.style.padding = '30px';
    container.style.fontFamily = "'Be Vietnam Pro', sans-serif";
    container.style.color = '#000';
    container.style.background = '#fff';
    container.style.width = '800px';

    let html = `
      <div style="text-align:center; font-family: 'Times New Roman', serif; margin-bottom: 30px;">
      <div style="margin-bottom:16px;">
      <div class="session-subject" style="font-size:18px;font-weight:700;color:var(--text-1);">${escapeHTML(session.subject) || 'Phiên chia nhóm'}</div>
        <div style="font-size: 20px; font-weight: bold;">Ngày: ${new Date(session.createdAt).toLocaleDateString('vi-VN')}</div>
      </div>
      </div>
    `;

    session.groups.forEach((g) => {
      html += `
        <div style="margin-bottom: 20px; page-break-inside: avoid; font-family: 'Times New Roman', serif;">
          <div style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">
            ${escapeHTML(g.name)}:
          </div>
      `;
      g.members.forEach((m) => {
        html += `
          <div style="font-size: 16px; margin-bottom: 8px; margin-left: 0px;">
            - ${escapeHTML(m.fullName || m.username || '?')}
          </div>
        `;
      });
      html += `</div>`;
    });

    container.innerHTML = html;

    // Tùy chọn cấu hình html2pdf
    const opt = {
      margin: 10,
      filename: `nhom-${session.subject ? session.subject.replace(/\s+/g, '-') : 'lop'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Xuất PDF
    await html2pdf().set(opt).from(container).save();
    toast('Đã xuất PDF thành công!', 'success');
  } catch (err) {
    console.error('Lỗi xuất PDF:', err);
    toast(err.message || 'Lỗi khi xuất PDF', 'error');
  }
}

async function loadHistory(btn) {
  let originalHtml = '';
  if (btn) {
    originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    btn.disabled = true;
  }
  try {
    const sessions = await API.get('/api/admin/sessions');
    const list = document.getElementById('history-list');
    if (sessions.length === 0) {
      list.innerHTML = '<div class="no-session-placeholder"><div class="no-session-icon">📜</div><div class="no-session-title">Chưa có lịch sử</div></div>';
      return;
    }
    const colors = ['var(--purple)', 'var(--cyan)', 'var(--rose)', 'var(--green)', 'var(--amber)', '#ec4899', '#f97316', '#84cc16'];
    list.innerHTML = sessions.map(s => {
      const date = new Date(s.createdAt).toLocaleString('vi-VN');
      const status = s.active
        ? '<span class="badge badge-green pulse">🟢 Đang hoạt động</span>'
        : '<span class="badge badge-amber">⏹ Đã kết thúc</span>';
      const groupsHtml = s.groups.map((g, idx) => {
        const color = colors[idx % colors.length];
        const memberChips = (g.members || []).map(m =>
          `<span class="history-member-chip" style="cursor:pointer;" onclick="showUserProfileModal('${m._id}')">${escapeHTML(m.fullName || m.username || '?')}</span>`
        ).join('');
        return `<div class="history-group-section">
          <div class="history-group-name" style="color:${color}">${escapeHTML(g.name)} <span style="font-size:11px;color:var(--text-2);font-weight:400;">(${g.members.length} người)</span></div>
          <div class="history-member-list">${memberChips || '<span style="font-size:11px;color:var(--text-3);">Chưa có thành viên</span>'}</div>
        </div>`;
      }).join('');
      return `<div class="card history-card">
        <div class="history-header" style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="history-subject">${escapeHTML(s.subject)} ${status}</div>
            <div class="history-date">🕐 ${date} | ${s.mode === 'manual' ? '🖱️ Tự chọn' : '🎰 Random'}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="exportSessionPDF('${s._id}')" style="padding: 4px 8px; font-size: 11px;">📄 Xuất PDF</button>
        </div>
        <div class="history-groups">${groupsHtml}</div>
      </div>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
  finally {
    if (btn) {
      btn.innerHTML = originalHtml || '🔄 Làm mới';
      btn.disabled = false;
    }
  }
}

// ─── Tab Switching ────────────────────────────────────────────────────
function switchTab(tabId, btn) {
  document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  if (btn) btn.classList.add('active');
  if (tabId === 'tab-history') loadHistory();
  if (tabId === 'tab-manage') loadAdminSession();
}

// ─── Random Slider (Slot Machine) ─────────────────────────────────────
let sliderState = {
  spinning: false,
  groups: [],
};

const SLOT_COLORS = [
  '#8b5cf6', '#06b6d4', '#f43f5e', '#10b981', '#f59e0b',
  '#ec4899', '#f97316', '#84cc16', '#6366f1', '#14b8a6',
];

function openSlider() {
  if (!state.session) return;
  const available = state.session.groups.filter(g => g.members.length < g.capacity);
  if (available.length === 0) { toast('Tất cả các nhóm đã đầy!', 'warning'); return; }
  sliderState.groups = state.session.groups;
  sliderState.spinning = false;

  document.getElementById('slider-result').classList.add('hidden');
  document.getElementById('slider-spin-btn').disabled = false;
  document.getElementById('slider-spin-btn').textContent = '🎰 Bốc thăm!';
  document.getElementById('slider-sub-text').textContent = 'Nhấn nút để hệ thống chọn nhóm cho bạn!';

  buildSlotTrack(sliderState.groups, -1);
  document.getElementById('slider-overlay').classList.remove('hidden');
}

function closeSlider() {
  document.getElementById('slider-overlay').classList.add('hidden');
  sliderState.spinning = false;
}

function buildSlotTrack(groups, winnerGroupId) {
  const track = document.getElementById('slot-track');
  const colors = SLOT_COLORS;
  const REPEATS = 25;
  const items = [];
  for (let r = 0; r < REPEATS; r++) {
    groups.forEach((g, i) => {
      items.push({ group: g, color: colors[i % colors.length] });
    });
  }

  track.innerHTML = items.map(({ group, color }, idx) => {
    const isWinner = winnerGroupId > 0 && group.groupId === winnerGroupId;
    return `<div class="slot-item ${isWinner && idx >= items.length - groups.length ? 'winner' : ''}"
      style="background:${color}22;border-color:${color}44;">
      <span style="font-size:20px;">📋</span>
      <span style="color:${color}">${escapeHTML(group.name)}</span>
    </div>`;
  }).join('');

  track.style.transition = 'none';
  track.style.transform = 'translateX(0)';
}

async function spinSlider() {
  if (sliderState.spinning) return;
  sliderState.spinning = true;

  const btn = document.getElementById('slider-spin-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Đang quay...';
  document.getElementById('slider-result').classList.add('hidden');

  try {
    const data = await API.post('/api/session/spin', {});
    const winnerGroupId = data.groupId;
    const winnerGroupName = data.groupName;
    const groups = sliderState.groups;

    sliderState.shuffledGroups = [...groups].sort(() => 0.5 - Math.random());
    buildSlotTrack(sliderState.shuffledGroups, winnerGroupId);

    const track = document.getElementById('slot-track');
    const itemWidth = 110;
    const totalGroups = groups.length;
    const REPEATS = 25;

    const lastRepeatStart = (REPEATS - 1) * totalGroups;
    let winnerIdxInLastRepeat = 0;
    sliderState.shuffledGroups.forEach((g, i) => {
      if (g.groupId === winnerGroupId) winnerIdxInLastRepeat = i;
    });
    const winnerAbsoluteIdx = lastRepeatStart + winnerIdxInLastRepeat;

    const windowCenterOffset = 120;
    const finalTranslate = -(winnerAbsoluteIdx * itemWidth - windowCenterOffset);

    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';

    await new Promise(r => setTimeout(r, 50));

    track.style.transition = 'transform 5s cubic-bezier(0.05, 0.9, 0.1, 1)';
    track.style.transform = `translateX(${finalTranslate}px)`;

    await new Promise(r => setTimeout(r, 5200));

    const allItems = track.querySelectorAll('.slot-item');
    allItems.forEach(el => el.classList.remove('winner'));
    if (allItems[winnerAbsoluteIdx]) allItems[winnerAbsoluteIdx].classList.add('winner');

    const resultEl = document.getElementById('slider-result');
    document.getElementById('slider-result-name').textContent = winnerGroupName;
    resultEl.classList.remove('hidden');
    document.getElementById('slider-sub-text').textContent = '🎉 Bốc thăm hoàn tất!';

    launchConfetti();
    toast(`🎉 Chúc mừng! Bạn vào ${winnerGroupName}!`, 'success');
    state.myGroup = winnerGroupId;
    // Socket.io sẽ tự cập nhật state.session qua sự kiện 'sessionUpdated'

    setTimeout(() => closeSlider(), 4000);

  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = '🎰 Bốc thăm!';
    sliderState.spinning = false;
  }
}

// ─── Confetti ─────────────────────────────────────────────────────────
function launchConfetti() {
  const colors = ['#8b5cf6', '#06b6d4', '#f43f5e', '#10b981', '#f59e0b', '#ec4899'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left:${Math.random() * 100}vw;
      top:${-10 + Math.random() * -20}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      width:${6 + Math.random() * 7}px;
      height:${6 + Math.random() * 7}px;
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration:${2 + Math.random() * 2}s;
      animation-delay:${Math.random() * 0.4}s;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}


// ─── Profile Modal ──────────────────────────────────────────────────
// ─── Settings (Cài đặt Tab) ───────────────────────────────────────────
function toggleSettingsCard(bodyId, arrowId) {
  const body = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  if (body && arrow) {
    if (body.classList.contains('hidden')) {
      body.classList.remove('hidden');
      arrow.style.transform = 'rotate(-180deg)';
    } else {
      body.classList.add('hidden');
      arrow.style.transform = 'rotate(0deg)';
    }
  }
}
function initSettingsTab() {
  const grid = document.getElementById('avatar-grid');
  if (grid && grid.children.length === 0) {
    grid.innerHTML = '';
    const emojis = ['👤', '👨', '👩', '👦', '👧', '👨‍🎓', '👩‍🎓', '🕵️', '👮', '👽', '👻', '🤖', '👾', '🦊', '🐱', '🐻', '🐼', '🐯', '🦁', '🐮', '🐸', '🦉', '🐺', '🦄'];
    emojis.forEach(e => {
      const el = document.createElement('div');
      el.className = 'avatar-option';
      if (state.user.avatar === e) el.classList.add('selected');
      el.textContent = e;
      el.onclick = () => selectAvatar(e, el);
      grid.appendChild(el);
    });
  }
  // Check push subscription status (fix iOS re-display issue)
  checkPushSubscriptionStatus();
  // Highlight current theme
  updateThemeButtons();
}

async function checkPushSubscriptionStatus() {
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const btn = document.getElementById('btn-subscribe-push');
      if (sub && btn) {
        btn.innerHTML = 'Đã bật thông báo';
        btn.disabled = true;
        btn.style.opacity = '0.7';
      }
    }
  } catch (e) { console.log('Push check error:', e); }
}

function updateThemeButtons() {
  const current = localStorage.getItem('app-theme') || '';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.style.borderColor = '';
    btn.style.background = '';
  });
  const activeBtn = document.querySelector(`.theme-btn[onclick="setTheme('${current}')"]`);
  if (activeBtn) {
    activeBtn.style.borderColor = 'var(--purple)';
    activeBtn.style.background = 'rgba(139,92,246,0.15)';
  }
}

function setTheme(theme) {
  localStorage.setItem('app-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeButtons();
  toast(theme === 'dark' ? '🌙 Dark Mode' : theme === 'lgbt' ? '🌈 LGBT Mode' : '☀️ Light Mode', 'success');
}

function selectAvatar(emoji, el) {
  document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedAvatarEmoji = emoji;
  checkSettingsChanges();
}

function handleAvatarFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('File quá lớn (tối đa 2MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const b64 = e.target.result;
    state.selectedAvatarEmoji = b64;
    document.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
    checkSettingsChanges();
    toast('Đã chọn ảnh. Bấm "Lưu thay đổi" để cập nhật.', 'info');
  };
  reader.readAsDataURL(file);
}

function checkSettingsChanges() {
  const btn = document.getElementById('btn-save-avatar');
  if (btn) btn.disabled = (state.selectedAvatarEmoji === null);
}

function checkPasswordChanges() {
  const oldPw = document.getElementById('old-password').value;
  const newPw = document.getElementById('new-password').value;
  const confirmPw = document.getElementById('confirm-password').value;
  const btn = document.getElementById('btn-change-password');
  if (btn) {
    btn.disabled = !(oldPw.length > 0 && newPw.length > 0 && confirmPw.length > 0);
  }
}

async function saveAvatar() {
  if (state.selectedAvatarEmoji === null) { toast('Chưa chọn avatar nào', 'info'); return; }
  try {
    const updated = await API.patch('/api/user/profile', { avatar: state.selectedAvatarEmoji });
    state.user = { ...state.user, ...updated };
    localStorage.setItem('user', JSON.stringify(state.user));
    updateNavbar();
    state.selectedAvatarEmoji = null;
    checkSettingsChanges();
    toast('Đã lưu thành công avatar!', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function changePassword() {
  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  if (!oldPassword || !newPassword) { toast('Vui lòng nhập đầy đủ mật khẩu', 'warning'); return; }
  if (newPassword !== confirmPassword) { toast('Mật khẩu xác nhận không khớp!', 'error'); return; }
  if (newPassword.length < 6) { toast('Mật khẩu mới phải có ít nhất 6 ký tự', 'warning'); return; }
  try {
    await API.patch('/api/user/profile', { oldPassword, newPassword });
    toast('Đổi mật khẩu thành công!', 'success');
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
    checkPasswordChanges();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── App Tabs Logic ───────────────────────────────────────────────────
function switchAppTab(tabId, btn) {
  // Update sidebar active state
  document.querySelectorAll('.side-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Close mobile sidebar if open
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  if (sidebar && sidebar.classList.contains('show')) {
    sidebar.classList.remove('show');
    overlay.classList.remove('show');
  }

  // Show correct content
  document.querySelectorAll('.app-tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');

  // Update header title
  const titleEl = document.getElementById('current-tab-title');
  if (tabId === 'tab-chia-nhom') titleEl.textContent = 'PHÂN CHIA NHÓM';
  if (tabId === 'tab-danh-sach-loi') {
    titleEl.textContent = 'DANH SÁCH VI PHẠM';
    loadViolations();
    if (state.user?.role === 'admin') {
      document.getElementById('violation-admin-box').classList.remove('hidden');
    } else {
      document.getElementById('violation-admin-box').classList.add('hidden');
    }
  }
  if (tabId === 'tab-cai-dat') {
    titleEl.textContent = 'CÀI ĐẶT';
    initSettingsTab();
  }
}

// ─── Notifications Logic ──────────────────────────────────────────────
let unreadNotifs = 0;
let isNotifDragging = false;

function toggleNotifDropdown(e) {
  if (isNotifDragging) return;
  if (e) e.stopPropagation();
  const drop = document.getElementById('notif-dropdown');
  drop.classList.toggle('hidden');
  if (!drop.classList.contains('hidden')) {
    unreadNotifs = 0;
    updateNotifBadge();
  }
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-count');
  if (unreadNotifs > 0) {
    badge.textContent = unreadNotifs;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function fetchNotifications() {
  try {
    const list = await API.get('/api/notifications');
    const container = document.getElementById('notif-list');
    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px;">Không có thông báo nào</div>';
      return;
    }
    list.reverse().forEach(n => appendNotificationHTML(n, false));
  } catch (err) {
    console.error('Failed to load notifications', err);
  }
}

function appendNotificationHTML(n, highlight = false) {
  const container = document.getElementById('notif-list');
  const el = document.createElement('div');
  el.className = 'notif-item';
  if (highlight) el.style.background = 'rgba(139,92,246,0.1)';
  el.style.cursor = 'pointer';
  el.onclick = () => handleNotificationClick(n);

  let icon = '💬';
  if (n.type === 'warning') icon = '⚠️';
  if (n.type === 'success') icon = '🎉';
  if (n.message.includes('sinh nhật')) icon = '🎂';

  const dateStr = new Date(n.createdAt).toLocaleString('vi-VN');

  el.innerHTML = `
    <div style="display:flex; gap:12px;">
      <div class="notif-icon">${icon}</div>
      <div style="flex:1;">
        <div style="color:var(--text-1); font-size:13px; margin-bottom:4px; line-height:1.4;">${escapeHTML(n.message)}</div>
        <div class="notif-time">${dateStr}</div>
      </div>
    </div>
  `;
  container.prepend(el);
}

function handleNotificationClick(n) {
  const notifDropdown = document.getElementById('notif-dropdown');
  if (notifDropdown) notifDropdown.classList.add('hidden');

  if (n.type === 'warning' || n.message.includes('lỗi')) {
    const tabBtn = document.querySelector('[data-tab="tab-danh-sach-loi"]');
    if (tabBtn) switchAppTab('tab-danh-sach-loi', tabBtn);
  } else if (n._id && String(n._id).startsWith('bday-')) {
    const userId = String(n._id).replace('bday-', '');
    showUserProfileModal(userId);
  } else if ((n.type === 'success' && n.targetGroup) || n.message.includes('nhóm') || n.message.includes('bốc thăm')) {
    // Hiển thị profile của người vừa vào nhóm thay vì chuyển tab
    if (n.triggeredBy) {
      showUserProfileModal(n.triggeredBy);
    } else {
      const tabBtn = document.querySelector('[data-tab="tab-chia-nhom"]');
      if (tabBtn) switchAppTab('tab-chia-nhom', tabBtn);
    }
  }
}

function showUserProfileModal(userId) {
  let user = null;
  // Fallback to state.user if viewing own profile
  if (userId === state.user._id || userId === state.user.id) {
    user = state.user;
  } else if (state.members && state.members.length > 0) {
    user = state.members.find(m => (m._id || m.id) === userId);
  }

  if (!user) {
    toast('Không tìm thấy thông tin người dùng', 'warning');
    return;
  }

  const overlay = document.getElementById('user-profile-overlay');
  if (!overlay) return;

  const avatarEl = document.getElementById('modal-user-avatar');
  setAvatarEl(avatarEl, user.avatar, user.fullName);
  if (!user.avatar || !user.avatar.startsWith('data:')) {
    avatarEl.style.fontSize = '40px';
  }

  document.getElementById('modal-user-name').textContent = user.fullName;
  document.getElementById('modal-user-role').textContent = user.role === 'admin' ? 'Quản trị viên' : 'Học viên';
  document.getElementById('modal-user-dob').textContent = user.dob || '—';
  document.getElementById('modal-user-gender').textContent = user.gender || '—';
  document.getElementById('modal-user-hometown').textContent = user.hometown || '—';
  document.getElementById('modal-user-phone').textContent = user.phone || '—';

  overlay.classList.remove('hidden');
}

socket.on('newNotification', (notif) => {
  if (notif.targetUser && state.user && state.user.id !== notif.targetUser) return;
  if (notif.targetGroup && state.myGroup !== notif.targetGroup) return;

  appendNotificationHTML(notif, true);
  if (document.getElementById('notif-dropdown').classList.contains('hidden')) {
    unreadNotifs++;
    updateNotifBadge();

    // Auto show a transient toast ONLY if the user is not the one who triggered it
    if (notif.triggeredBy && state.user && notif.triggeredBy === state.user.id) {
      // Do not show toast for self-triggered actions
    } else {
      const shortMsg = notif.message.length > 50 ? notif.message.substring(0, 50) + '...' : notif.message;
      toast('🔔 ' + shortMsg, notif.type || 'info');
    }
  }
});

// ─── Violations Logic ─────────────────────────────────────────────────
async function loadViolations(btn) {
  let originalHtml = '';
  if (btn) {
    originalHtml = btn.innerHTML;
    btn.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    btn.disabled = true;
  }
  try {
    const tbody = document.getElementById('violation-list');
    const isAdmin = state.user && state.user.role === 'admin';
    const COLS = isAdmin ? 5 : 4;

    // Show/hide role-specific UI
    const userPointsBar = document.getElementById('user-points-bar');
    if (userPointsBar) userPointsBar.style.display = 'flex';

    const pointsBox = document.getElementById('points-box');
    if (pointsBox) pointsBox.style.display = isAdmin ? 'none' : 'flex';

    const adminLbBar = document.getElementById('admin-leaderboard-bar');
    if (adminLbBar) adminLbBar.style.display = 'flex';
    const colStudent = document.getElementById('col-student-name');
    if (colStudent) colStudent.style.display = isAdmin ? '' : 'none';

    // Load user points
    if (!isAdmin) {
      try {
        const pts = await API.get('/api/violations/my-points');
        const el = document.getElementById('user-total-points');
        if (el) el.textContent = pts.totalDeducted > 0 ? `-${pts.totalDeducted}` : '0';
      } catch (e) { }
    }

    tbody.innerHTML = `<tr><td colspan="${COLS}" style="text-align:center;padding:30px;">
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </td></tr>`;
    const list = await API.get('/api/violations');
    tbody.innerHTML = '';
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${COLS}" style="text-align:center;color:var(--text-3);padding:20px;font-size:13px;">Chưa có dữ liệu vi phạm.</td></tr>`;
      return;
    }

    list.forEach(v => {
      const tr = document.createElement('tr');
      const d = new Date(v.createdAt);
      const dateStr = d.toLocaleDateString('vi-VN') + '<br><span style="font-size:11px;color:var(--text-3);">' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</span>';
      const uname = escapeHTML(v.user?.fullName || '?');
      const violationLabel = escapeHTML((v.type === 'Khác' && v.note) ? v.note : v.type);

      const studentColHtml = isAdmin ? `<td style="font-size:13px;color:var(--text-1);text-align:center;">${uname}</td>` : '';
      const actionBtn = isAdmin
        ? `<button class="btn btn-ghost" style="padding:3px;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;background:rgba(255,255,255,0.05);" title="Xóa lỗi" onclick="deleteViolation('${v._id}');event.stopPropagation();">🗑️</button>`
        : `<button class="btn btn-ghost" style="padding:3px;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;background:rgba(255,255,255,0.05);" title="Khiếu nại" onclick="appealViolation('${v._id}');event.stopPropagation();">💬</button>`;

      tr.innerHTML = `
        <td style="color:var(--text-2);font-size:13px;text-align:center;">${dateStr}</td>
        ${studentColHtml}
        <td style="color:var(--amber);font-size:13px;text-align:left;">${violationLabel}</td>
        <td style="text-align:center;color:var(--rose);font-size:13px;font-weight:700;">-${v.points}</td>
        <td style="text-align:center;">${actionBtn}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    toast('Lỗi khi tải danh sách vi phạm', 'error');
  } finally {
    if (btn) {
      btn.innerHTML = originalHtml || '🔄 Làm mới';
      btn.disabled = false;
    }
  }
}

function onViolationTypeChange() {
  const type = document.getElementById('v-type').value;
  const noteGroup = document.getElementById('v-note-group');
  if (noteGroup) noteGroup.classList.toggle('hidden', type !== 'Khác');
  if (type !== 'Khác') { const ni = document.getElementById('v-note'); if (ni) ni.value = ''; }
}

async function addViolation() {
  const userId = document.getElementById('v-user').value;
  const type = document.getElementById('v-type').value;
  const points = document.getElementById('v-points').value;
  const note = document.getElementById('v-note')?.value?.trim() || '';

  if (!userId) { toast('Chưa chọn học viên', 'error'); return; }
  if (!type) { toast('Chưa chọn loại lỗi', 'error'); return; }
  if (type === 'Khác' && !note) { toast('Vui lòng ghi chú nội dung lỗi', 'error'); return; }

  try {
    await API.post('/api/violations', { userId, type, note, points });
    toast('Đã ghi lỗi thành công!', 'success');
    loadViolations();
  } catch (err) {
    toast(err.message, 'error');
  }
}

let currentLeaderboardData = [];

async function showLeaderboard() {
  const overlay = document.getElementById('leaderboard-overlay');
  const body = document.getElementById('leaderboard-body');
  if (!overlay || !body) return;

  switchLbTabStyles('all');
  overlay.classList.remove('hidden');
  body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2);font-size:13px;">Đang tải...</div>';
  try {
    const list = await API.get('/api/violations/leaderboard');
    currentLeaderboardData = list;
    renderLeaderboard('all');
  } catch (err) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--rose);font-size:13px;">Lỗi tải dữ liệu</div>';
  }
}

function switchLbTabStyles(tabId) {
  ['all', 'sq1', 'sq2'].forEach(id => {
    const btn = document.getElementById('lb-tab-' + id);
    if (!btn) return;
    if (id === tabId) {
      btn.style.color = 'var(--cyan)';
      btn.style.borderBottom = '2px solid var(--cyan)';
    } else {
      btn.style.color = 'var(--text-2)';
      btn.style.borderBottom = '2px solid transparent';
    }
  });
}

function switchLbTab(tabId) {
  switchLbTabStyles(tabId);
  renderLeaderboard(tabId);
}

function renderLeaderboard(tabId) {
  const body = document.getElementById('leaderboard-body');
  if (!body) return;

  let list = currentLeaderboardData;
  if (tabId === 'sq2') {
    list = list.filter(u => u.squad === 2);
  } else if (tabId === 'sq1') {
    list = list.filter(u => u.squad === 1);
  }

  if (!list.length) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px;">Không có dữ liệu</div>';
    return;
  }

  body.innerHTML = list.map((u, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="font-size:13px;color:var(--text-3);min-width:20px;display:inline-block;text-align:center;">${i + 1}</span>`;
    const pts = u.totalDeducted;
    const color = pts === 0 ? 'var(--green)' : pts <= 10 ? 'var(--amber)' : 'var(--rose)';
    const roleTag = u.role === 'admin' ? '<span style="font-size:10px;background:rgba(139,92,246,0.2);color:var(--purple);border-radius:4px;padding:1px 5px;margin-left:6px;">Admin</span>' : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid rgba(255,255,255,0.03);">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:16px;min-width:24px;text-align:center;">${medal}</span>
        <span style="font-size:13px;color:var(--text-1);">${u.fullName}${roleTag}</span>
      </div>
      <span style="font-size:13px;color:${color};">${pts > 0 ? `-${pts}` : '0'}</span>
    </div>`;
  }).join('');
}

async function appealViolation(violationId) {
  if (!confirm('Bạn có chắc chắn muốn gửi khiếu nại về lỗi này?')) return;
  try {
    await API.post(`/api/violations/${violationId}/appeal`);
    toast('Đã gửi khiếu nại thành công, Admin sẽ xem xét.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteViolation(violationId) {
  if (!confirm('Bạn có chắc chắn muốn xóa lỗi này?')) return;
  try {
    await API.delete(`/api/violations/${violationId}`);
    toast('Đã xóa lỗi thành công.', 'success');
    loadViolations();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Populate violation user dropdown when members are loaded
const originalLoadMembers = loadClassMembersBackground;
loadClassMembersBackground = async function (isAdmin) {
  await originalLoadMembers(isAdmin);
  // populate #v-user select
  const sel = document.getElementById('v-user');
  if (sel && state.members) {
    sel.innerHTML = '<option value="">-- Chọn học viên --</option>';
    state.members.forEach(m => {
      sel.innerHTML += `<option value="${m._id}">${m.stt}. ${m.fullName}</option>`;
    });
  }
}

// Removed makeDraggableNotif function

function init() {
  // Dismiss loading overlay
  setTimeout(() => {
    const overlay = document.getElementById('app-loading');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 500);
    }
  }, 800);

  if (state.token && state.user) {
    if (state.user.role === 'admin') showAdminView();
    else showUserView();

    // Tự động chọn tab danh sách vi phạm khi load trang
    const violationTab = document.querySelector('[data-tab="tab-danh-sach-loi"]');
    if (violationTab) switchAppTab('tab-danh-sach-loi', violationTab);
  } else {
    showLoginView();
  }
}

// Close modals on backdrop click
document.getElementById('profile-modal')?.addEventListener('click', function (e) {
  if (e.target === this) closeProfileModal();
});
document.getElementById('slider-overlay')?.addEventListener('click', function (e) {
  if (e.target === this && !sliderState.spinning) closeSlider();
});
document.getElementById('user-profile-overlay')?.addEventListener('click', function (e) {
  if (e.target === this) this.classList.add('hidden');
});

// Close notification dropdown when clicking outside
document.addEventListener('click', function (e) {
  const notifDropdown = document.getElementById('notif-dropdown');
  const notifBtn = document.querySelector('.notif-btn');
  if (notifDropdown && !notifDropdown.classList.contains('hidden')) {
    if (!notifDropdown.contains(e.target) && (!notifBtn || !notifBtn.contains(e.target))) {
      notifDropdown.classList.add('hidden');
    }
  }
});

init();


// ─── Anti-Inspect Troll ───────────────────────────────────────────────
let warned = false;

function playSiren() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);

    const modulator = audioCtx.createOscillator();
    const modGain = audioCtx.createGain();

    modulator.frequency.value = 2;
    modGain.gain.value = 400;

    modulator.connect(modGain);
    modGain.connect(osc.frequency);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    gain.gain.value = 1;

    osc.start();
    modulator.start();

    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(3000, audioCtx.currentTime);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    gain2.gain.value = 1;
    osc2.start();

    const lfo = audioCtx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 20;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 1;
    lfo.connect(lfoGain);
    lfoGain.connect(gain2.gain);
    lfo.start();

  } catch (err) {
    console.error("Audio failed to play", err);
  }
}

function antiInspectAlert(e) {
  if (e) e.preventDefault();
  if (window.matchMedia("(max-width: 768px)").matches || /Mobi|Android|iPhone/i.test(navigator.userAgent)) return;
  if (warned) return;
  warned = true;

  const fullName = (state.user && state.user.fullName) ? state.user.fullName : "Bạn";
  const nameParts = fullName.trim().split(' ');
  const name = nameParts[nameParts.length - 1];
  let os = "thiết bị không xác định";
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac/.test(ua)) os = "MacOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iOS|iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let msg = `CẢNH BÁO: ${name} lại dùng ${os} để tinh nghịch rồi! Hệ thống đang truy xuất vị trí...`;

  // Lấy IP nếu có thể
  fetch('https://ipapi.co/json/')
    .then(r => r.json())
    .then(d => {
      msg = `CẢNH BÁO: ${name} lại dùng ${os} để tinh nghịch rồi! IP: ${d.ip} tại ${d.city}, ${d.region} đã bị ghi nhận rồi nhé.`;
      const msgEl = document.getElementById('anti-inspect-msg');
      if (msgEl) msgEl.textContent = msg;
    }).catch(e => {
      fetch('https://api.ipify.org?format=json')
        .then(r => r.json())
        .then(d => {
          msg = `CẢNH BÁO: ${name} lại dùng ${os} để tinh nghịch rồi! IP: ${d.ip} đã bị ghi nhận rồi nhé.`;
          const msgEl = document.getElementById('anti-inspect-msg');
          if (msgEl) msgEl.textContent = msg;
        }).catch(e => { });
    });

  // Phát tiếng còi hú báo động
  playSiren();

  // Đổi giao diện màn hình khóa với hiệu ứng cực kỳ chuyên nghiệp và sống động (di chuyển, chớp nháy, glitch)
  document.body.innerHTML = `
    <style>
      @keyframes blink {
        0%, 49% { background-color: #ff0000; filter: invert(0); }
        50%, 100% { background-color: #000000; filter: invert(100%); }
      }
      @keyframes scanline {
        0% { transform: translateY(-100%); }
        100% { transform: translateY(100%); }
      }
      @keyframes glitch {
        0% { transform: translate(0); text-shadow: 4px 4px #00ff00, -4px -4px #0000ff; }
        20% { transform: translate(-8px, 8px); text-shadow: -6px 2px #00ff00, 4px -4px #0000ff; }
        40% { transform: translate(-8px, -8px); text-shadow: 4px -6px #00ff00, -2px 6px #0000ff; }
        60% { transform: translate(8px, 8px); text-shadow: -4px 4px #00ff00, 6px -2px #0000ff; }
        80% { transform: translate(8px, -8px); text-shadow: 6px -4px #00ff00, -6px 4px #0000ff; }
        100% { transform: translate(0); text-shadow: 4px 4px #00ff00, -4px -4px #0000ff; }
      }
      @keyframes slideTrackLeft {
        0% { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      @keyframes slideTrackRight {
        0% { transform: translateX(-50%); }
        100% { transform: translateX(0); }
      }
      @keyframes modalShake {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        15% { transform: translate(-3px, -3px) rotate(-0.5deg); }
        30% { transform: translate(3px, 3px) rotate(0.5deg); }
        45% { transform: translate(-3px, 3px) rotate(-0.5deg); }
        60% { transform: translate(3px, -3px) rotate(0.5deg); }
        75% { transform: translate(-1px, 2px) rotate(-0.5deg); }
        90% { transform: translate(2px, -1px) rotate(0.5deg); }
      }
      @keyframes scaleUp {
        from { transform: scale(0.95); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }

      .troll-screen {
        display: flex;
        height: 100vh;
        width: 100vw;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        box-sizing: border-box;
        animation: blink 0.1s infinite;
        font-family: 'Courier New', Courier, monospace;
        position: fixed;
        top: 0; left: 0;
        z-index: 999999;
        overflow: hidden;
        color: #ffffff;
        background-color: #ff0000;
      }

      /* CRT Scanline & Laser scanner */
      .scanline-overlay {
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        background: linear-gradient(
          rgba(18, 16, 16, 0) 50%, 
          rgba(0, 0, 0, 0.4) 50%
        );
        background-size: 100% 4px;
        z-index: 10;
        pointer-events: none;
      }
      .laser-scanner {
        position: absolute;
        top: 0; left: 0; width: 100%; height: 20px;
        background: #00ff00;
        box-shadow: 0 0 30px #00ff00, 0 0 60px #00ff00;
        animation: scanline 1.5s linear infinite;
        z-index: 11;
        pointer-events: none;
      }

      /* Băng chữ chạy (Marquee) */
      .ticker-strip {
        position: absolute;
        width: 200%;
        overflow: hidden;
        display: flex;
        font-size: 22px;
        background: rgba(255, 0, 0, 0.2);
        border-top: 3px solid #ff3333;
        border-bottom: 3px solid #ff3333;
        padding: 8px 0;
        font-weight: 900;
        z-index: 5;
        text-transform: uppercase;
        letter-spacing: 3px;
      }
      .ticker-top {
        top: 12%;
        transform: rotate(-3deg);
      }
      .ticker-bottom {
        bottom: 12%;
        transform: rotate(3deg);
      }
      .ticker-track-left {
        display: flex;
        width: 100%;
        animation: slideTrackLeft 20s linear infinite;
      }
      .ticker-track-right {
        display: flex;
        width: 100%;
        animation: slideTrackRight 20s linear infinite;
      }
      .ticker-item {
        padding: 0 30px;
        flex-shrink: 0;
      }

      /* Tiêu đề Glitch */
      .glitch-title {
        font-size: 120px;
        font-weight: 900;
        text-transform: uppercase;
        animation: glitch 0.3s linear infinite;
        z-index: 20;
        margin-bottom: 15px;
        letter-spacing: 5px;
        color: #ffff00;
      }
      .glitch-subtitle {
        font-size: 50px;
        font-weight: 900;
        letter-spacing: 8px;
        animation: glitch 0.5s linear infinite;
        z-index: 20;
        color: #00ff00;
      }

      /* Hộp thoại Custom Alert giả lập rung lắc */
      .custom-alert-overlay {
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, 0.85);
        z-index: 999999;
      }
      .custom-alert-box {
        background: #111111;
        color: #ff3333;
        border-radius: 8px;
        width: 500px;
        max-width: 90%;
        box-shadow: 0 0 40px rgba(255, 0, 0, 0.6);
        font-family: 'Courier New', Courier, monospace;
        overflow: hidden;
        border: 2px solid #ff3333;
        text-align: left;
        animation: scaleUp 0.15s ease-out, modalShake 0.5s infinite alternate;
      }
      .custom-alert-header {
        padding: 18px 24px;
        font-size: 16px;
        font-weight: 900;
        border-bottom: 2px solid #ff3333;
        color: #ffffff;
        background: #220000;
        letter-spacing: 1px;
      }
      .custom-alert-body {
        padding: 24px;
        font-size: 15px;
        line-height: 1.6;
        color: #ff9999;
        font-weight: bold;
      }
      .custom-alert-footer {
        padding: 14px 24px;
        display: flex;
        justify-content: flex-end;
        border-top: 2px solid #ff3333;
        background: #1a0505;
      }
      .custom-alert-btn {
        background: #ff3333;
        color: #ffffff;
        border: none;
        padding: 8px 30px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 900;
        cursor: pointer;
        outline: none;
        transition: all 0.2s;
        box-shadow: 0 0 10px #ff3333;
        font-family: inherit;
      }
      .custom-alert-btn:hover {
        background: #ffffff;
        color: #ff3333;
        box-shadow: 0 0 15px #ffffff;
      }
    </style>
    
    <div class="troll-screen">
      <div class="scanline-overlay"></div>
      <div class="laser-scanner"></div>

      <!-- Băng rôn chạy phía trên -->
      <div class="ticker-strip ticker-top">
        <div class="ticker-track-left">
          ${Array(8).fill('<span class="ticker-item">⚠️ WARNING: DEVTOOLS DETECTED ⚠️</span>').join('')}
          ${Array(8).fill('<span class="ticker-item">⚠️ WARNING: DEVTOOLS DETECTED ⚠️</span>').join('')}
        </div>
      </div>

      <div class="glitch-title">🚨 WARNING 🚨</div>
      <div class="glitch-subtitle">ACCESS DENIED</div>

      <!-- Băng rôn chạy phía dưới -->
      <div class="ticker-strip ticker-bottom">
        <div class="ticker-track-right">
          ${Array(8).fill('<span class="ticker-item">🚨 SYSTEM LOCKED 🚨 UNAUTHORIZED ACCESS</span>').join('')}
          ${Array(8).fill('<span class="ticker-item">🚨 SYSTEM LOCKED 🚨 UNAUTHORIZED ACCESS</span>').join('')}
        </div>
      </div>

      <div class="custom-alert-overlay" id="custom-alert">
        <div class="custom-alert-box">
          <div class="custom-alert-header">Cảnh báo phát hiện thao tác lạ:</div>
          <div class="custom-alert-body" id="anti-inspect-msg">${msg}</div>
          <div class="custom-alert-footer">
            <button class="custom-alert-btn" onclick="document.getElementById('custom-alert').style.display='none'">OK</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Spam log console làm đơ trình duyệt nếu cố tình mở DevTools
  setInterval(() => {
    console.log("%c" + msg, "color: red; font-size: 30px; font-weight: bold; background: black; padding: 10px; border-radius: 5px;");
  }, 100);
}

// Chặn DevTools bằng debugger
setInterval(() => {
  const before = new Date().getTime();
  debugger;
  const after = new Date().getTime();
  if (after - before > 100) {
    antiInspectAlert();
  }
}, 1000);

// Chặn phím tắt xem nguồn trang và mở DevTools
document.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) ||
    (e.ctrlKey && ['u', 's', 'p'].includes(key))
  ) {
    antiInspectAlert(e);
  }
});

// Chặn click chuột phải để không thể "Xem nguồn trang"
document.addEventListener('contextmenu', e => {
  antiInspectAlert(e);
});



// ════════════════════════════════════════════════════════════════
// WEB PUSH NOTIFICATIONS (PWA)
// ════════════════════════════════════════════════════════════════

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registered', reg))
      .catch(err => console.error('Service Worker registration failed', err));
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Trình duyệt của bạn không hỗ trợ nhận thông báo (Push Notifications). Vui lòng thử trên Safari (từ iOS 16.4+) hoặc Chrome/Edge trên máy tính.');
    return;
  }

  try {
    const btn = document.getElementById('btn-subscribe-push');
    if (btn) btn.innerHTML = '⏳ Đang thiết lập...';

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Bạn đã từ chối cấp quyền thông báo. Vui lòng mở Cài đặt trình duyệt để cho phép.');
      if (btn) btn.innerHTML = '🔔 Bật thông báo';
      return;
    }

    const reg = await navigator.serviceWorker.ready;

    // Get VAPID public key from backend
    const vapidRes = await fetch('/api/notifications/vapid-key');
    const vapidData = await vapidRes.json();
    const publicVapidKey = vapidData.publicKey;

    // Subscribe
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
    });

    // Send to backend
    const res = await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify(subscription)
    });

    if (res.ok) {
      alert('🎉 Đăng ký thành công! Bạn sẽ nhận được thông báo của web. 🎉');
      if (btn) {
        btn.innerHTML = 'Đã bật thông báo';
        btn.disabled = true;
      }
    } else {
      const errData = await res.json();
      alert('Lỗi đăng ký: ' + (errData.error || 'Unknown error'));
      if (btn) btn.innerHTML = '🔔 Bật thông báo';
    }

  } catch (error) {
    console.error('Lỗi khi đăng ký push:', error);
    alert('Có lỗi xảy ra: ' + error.message);
    const btn = document.getElementById('btn-subscribe-push');
    if (btn) btn.innerHTML = '🔔 Bật thông báo';
  }
}

function openAvatarZoom() {
  const overlay = document.getElementById('avatar-zoom-overlay');
  const imgEl = document.getElementById('avatar-zoom-img');
  const textEl = document.getElementById('avatar-zoom-text');
  const avatarHtml = document.getElementById('modal-user-avatar').innerHTML;
  if (avatarHtml.includes('<img')) {
    imgEl.src = document.getElementById('modal-user-avatar').querySelector('img').src;
    imgEl.style.display = 'block';
    textEl.style.display = 'none';
  } else {
    textEl.innerHTML = avatarHtml;
    imgEl.style.display = 'none';
    textEl.style.display = 'block';
  }
  overlay.classList.remove('hidden');
}
