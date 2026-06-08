/* ════════════════════════════════════════════════════════════════════
   app.js — Ứng dụng Quản lý Nhóm Lớp Học
   - JWT auth (bền vững qua restart Render)
   - Socket.io realtime (không cần polling)
   - Admin có thể chuyển sang chế độ học sinh để chọn nhóm/quay random
   ════════════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────────
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

// ─── Socket.io ────────────────────────────────────────────────────────
const socket = io();

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
  get:    (path)        => API.req('GET',   path),
  post:   (path, body)  => API.req('POST',  path, body),
  patch:  (path, body)  => API.req('PATCH', path, body),
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
  document.getElementById('navbar').classList.add('hidden');
  showView('view-login');
}

function showUserView() {
  document.getElementById('navbar').classList.remove('hidden');
  updateNavbar();
  showView('view-user');
  loadClassMembersBackground();
  fetchSessionStatus();
}

function showAdminView() {
  document.getElementById('navbar').classList.remove('hidden');
  state.isAdminInUserMode = false;
  updateNavbar();
  showView('view-admin');
  loadClassMembersBackground(true);
  loadAdminSession();
}

// ─── Navbar ───────────────────────────────────────────────────────────
function updateNavbar() {
  if (!state.user) return;
  const avatarEl = document.getElementById('nav-avatar-el');
  setAvatarEl(avatarEl, state.user.avatar, state.user.fullName);
  document.getElementById('nav-username-el').textContent = state.user.fullName;
  const roleEl = document.getElementById('nav-role-el');
  roleEl.innerHTML = state.user.role === 'admin'
    ? '<span class="badge badge-amber">👑 Admin</span>'
    : '<span class="badge badge-cyan">🎓 Học viên</span>';

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
    el.innerHTML = `<img src="${avatar}" alt="${fullName}" />`;
  } else if (avatar) {
    el.textContent = avatar;
    el.style.background = 'none';
    el.style.fontSize = '16px';
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
    toast('🛠️ Quay lại trang Quản trị', 'info');
  } else {
    // Chuyển sang chế độ học sinh
    state.isAdminInUserMode = true;
    updateNavbar();
    showView('view-user');
    fetchSessionStatus();
    toast('🎓 Đã chuyển sang chế độ Học viên', 'info');
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
    state.user  = data.user;
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    toast(`Chào mừng, ${data.user.fullName}! 👋`, 'success');
    if (data.user.role === 'admin') showAdminView();
    else showUserView();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btnText.textContent = 'Đăng nhập';
    spinner.classList.add('hidden');
    document.getElementById('login-btn').disabled = false;
  }
}

async function logout() {
  try { await API.post('/api/auth/logout'); } catch {}
  state.token = null;
  state.user  = null;
  state.isAdminInUserMode = false;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showLoginView();
  toast('Đã đăng xuất', 'info');
}

// ─── Fetch session on load (initial state) ────────────────────────────
async function fetchSessionStatus() {
  try {
    const data = await API.get('/api/session/status');
    state.session = data.active ? data.session : null;
    state.myGroup = data.myGroup || null;
    state.isFixed = data.isFixed || false;
    renderUserSession(data);
  } catch {}
}

// ─── Class Members (background load) ─────────────────────────────────
async function loadClassMembersBackground(isAdmin = false) {
  try {
    const members = await API.get('/api/class/members');
    state.members = members;
  } catch {}
}

// ─── User Session Rendering ───────────────────────────────────────────
function renderUserSession(data) {
  const banner        = document.getElementById('session-banner');
  const noSession     = document.getElementById('no-session-placeholder');
  const groupsSection = document.getElementById('groups-section');
  const myGroupCard   = document.getElementById('my-group-card');
  const sliderTrigger = document.getElementById('slider-trigger-section');

  if (!data.active || !data.session) {
    banner.classList.add('hidden');
    noSession.classList.remove('hidden');
    groupsSection.classList.add('hidden');
    myGroupCard.classList.add('hidden');
    sliderTrigger.classList.add('hidden');
    return;
  }

  const session = data.session;
  noSession.classList.add('hidden');
  banner.classList.remove('hidden');
  document.getElementById('sb-subject').textContent = session.subject;
  document.getElementById('sb-mode-badge').innerHTML =
    session.mode === 'manual' ? '🖱️ Tự chọn' : '🎰 Ngẫu nhiên';
  document.getElementById('sb-groups-badge').innerHTML = `${session.groups.length} nhóm`;

  if (data.myGroup) {
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
    if (session.mode === 'random') {
      sliderTrigger.classList.remove('hidden');
    } else {
      sliderTrigger.classList.add('hidden');
    }
  }

  renderGroupsGrid(session, data.myGroup, data.isFixed, session.mode);
}

function renderGroupsGrid(session, myGroupId, isFixed, mode) {
  const grid = document.getElementById('groups-grid');
  if (!grid) return;

  const colors = ['var(--purple)', 'var(--cyan)', 'var(--rose)', 'var(--green)', 'var(--amber)', '#ec4899', '#f97316', '#84cc16'];

  grid.innerHTML = session.groups.map((g, idx) => {
    const pct = g.capacity > 0 ? (g.members.length / g.capacity) * 100 : 0;
    const isFull = g.members.length >= g.capacity;
    const isMyGroup = myGroupId === g.groupId;
    const canJoin = !isMyGroup && !isFull && !isFixed && mode === 'manual';
    const color = colors[idx % colors.length];
    const emptySlots = g.capacity - g.members.length;

    const membersHtml = g.members.map(m => {
      const isFixedMember = g.fixedMembers && g.fixedMembers.some(f => (f._id || f) === (m._id || m));
      const avatarHtml = m.avatar && m.avatar.startsWith('data:')
        ? `<img src="${m.avatar}" alt="" />`
        : (m.avatar || m.fullName.charAt(0));
      return `<div class="member-item">
        <div class="member-avatar-sm">${avatarHtml}</div>
        <span class="member-name">${m.fullName}</span>
        ${isFixedMember ? '<span class="member-fixed">🔒</span>' : ''}
      </div>`;
    }).join('');

    return `<div class="group-card ${canJoin ? 'joinable' : ''} ${isFull ? 'full' : ''} ${isMyGroup ? 'my-group' : ''}"
      onclick="${canJoin ? `joinGroup(${g.groupId})` : ''}" >
      <div class="group-header">
        <span class="group-name" style="color:${color}">${g.name}</span>
        <span class="group-count">${g.members.length}/${g.capacity}</span>
      </div>
      <div class="group-progress-bar">
        <div class="group-progress-fill" style="width:${pct}%;background:${color};"></div>
      </div>
      <div class="group-members">${membersHtml}</div>
      ${emptySlots > 0 ? `<div class="group-empty-slots">+${emptySlots} chỗ trống</div>` : ''}
      ${canJoin ? `<button class="btn btn-primary btn-sm group-join-btn" onclick="joinGroup(${g.groupId});event.stopPropagation()">Tham gia</button>` : ''}
      ${isMyGroup ? `<div style="margin-top:8px;font-size:11px;color:var(--green);font-weight:700;">✓ Nhóm của bạn</div>` : ''}
    </div>`;
  }).join('');
}

// ─── Join / Leave Group ───────────────────────────────────────────────
let isJoiningGroup = false;
async function joinGroup(groupId) {
  if (isJoiningGroup) return;
  isJoiningGroup = true;
  try {
    const data = await API.post('/api/session/join', { groupId });
    state.myGroup = data.myGroup;
    toast(`Đã tham gia Nhóm ${groupId}! 🎉`, 'success');
    // Socket.io sẽ tự cập nhật giao diện qua sự kiện 'sessionUpdated'
  } catch (err) { 
    toast(err.message, 'error'); 
  } finally {
    isJoiningGroup = false;
  }
}

// ─── Admin Stats ──────────────────────────────────────────────────────
function renderAdminStats(data) {
  if (data.active && data.session) {
    const session = data.session;
    const assigned = session.groups.reduce((s, g) => s + g.members.length, 0);
    document.getElementById('stat-groups').textContent = session.groups.length;
    document.getElementById('stat-assigned').textContent = assigned;
    document.getElementById('stat-unassigned').textContent = 25 - assigned;
  } else {
    document.getElementById('stat-groups').textContent = '0';
    document.getElementById('stat-assigned').textContent = '0';
    document.getElementById('stat-unassigned').textContent = '25';
  }
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
    }).catch(() => {});
  }
}

function renderAdminGroups(session) {
  const grid = document.getElementById('admin-groups-grid');
  if (!grid) return;
  const colors = ['var(--purple)', 'var(--cyan)', 'var(--rose)', 'var(--green)', 'var(--amber)', '#ec4899', '#f97316', '#84cc16'];

  grid.innerHTML = session.groups.map((g, idx) => {
    const color = colors[idx % colors.length];
    const membersHtml = g.members.map(m => {
      const isFixedMember = g.fixedMembers && g.fixedMembers.some(f => (f._id||f).toString() === (m._id||m).toString());
      const avatarHtml = m.avatar && m.avatar.startsWith('data:') ? `<img src="${m.avatar}" alt="" />` : (m.avatar || m.fullName.charAt(0));
      return `<div class="admin-member-item">
        <div class="member-avatar-sm">${avatarHtml}</div>
        <span class="admin-member-name">${m.fullName} ${isFixedMember ? '🔒' : ''}</span>
        <div class="admin-member-actions">
          <select class="input" style="padding:3px 6px;font-size:11px;height:26px;" onchange="moveMember('${m._id}', ${g.groupId}, this.value, this)">
            <option value="">Chuyển...</option>
            ${session.groups.filter(gg => gg.groupId !== g.groupId).map(gg =>
              `<option value="${gg.groupId}">${gg.name}</option>`
            ).join('')}
            <option value="remove">❌ Bỏ khỏi nhóm</option>
          </select>
        </div>
      </div>`;
    }).join('');
    return `<div class="card admin-group-card">
      <div class="admin-group-header">
        <span class="admin-group-name" style="color:${color}">${g.name}</span>
        <div class="capacity-editor">
          <button class="capacity-btn" onclick="changeCapacity(${g.groupId}, -1)">−</button>
          <span class="capacity-val">${g.members.length}/<strong>${g.capacity}</strong></span>
          <button class="capacity-btn" onclick="changeCapacity(${g.groupId}, 1)">+</button>
        </div>
      </div>
      <div class="group-progress-bar">
        <div class="group-progress-fill" style="width:${g.capacity>0?(g.members.length/g.capacity*100):0}%;background:${color};"></div>
      </div>
      <div>${membersHtml}</div>
      ${g.members.length === 0 ? '<div style="font-size:12px;color:var(--text-3);padding:6px 0;text-align:center">Chưa có thành viên</div>' : ''}
    </div>`;
  }).join('');

  // Unassigned
  const allMemberIds = new Set();
  session.groups.forEach(g => g.members.forEach(m => allMemberIds.add((m._id||m).toString())));
  const unassigned = state.members.filter(m => !allMemberIds.has(m._id.toString()));
  document.getElementById('unassigned-count').textContent = unassigned.length;
  document.getElementById('unassigned-list').innerHTML = unassigned.map(m =>
    `<span class="unassigned-chip">${m.fullName}</span>`
  ).join('');
}

function renderFixedAssignList(session) {
  const list = document.getElementById('fixed-assign-list');
  if (!list || !state.members.length) return;

  list.innerHTML = state.members.map(m => {
    let currentGroupId = null;
    let isFixed = false;
    for (const g of session.groups) {
      const fixedIds = g.fixedMembers.map(f => (f._id||f).toString());
      if (fixedIds.includes(m._id.toString())) { currentGroupId = g.groupId; isFixed = true; break; }
    }
    const options = session.groups.map(g => `<option value="${g.groupId}" ${currentGroupId===g.groupId?'selected':''}>${g.name}</option>`).join('');
    return `<div class="assign-item">
      <div class="member-avatar-sm">${m.avatar && m.avatar.startsWith('data:') ? `<img src="${m.avatar}" alt="" />` : (m.avatar || m.fullName.charAt(0))}</div>
      <span class="assign-item-name">${m.fullName} ${isFixed ? '🔒' : ''}</span>
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
    toast(groupId ? '🔒 Đã xếp cố định!' : 'Đã bỏ xếp cố định', 'success');
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
  else hint.textContent = `Khoảng ${base} - ${base+1} người/nhóm`;
}

async function createSession() {
  const subject    = document.getElementById('f-subject').value.trim() || 'Môn học';
  const mode       = document.querySelector('input[name="f-mode"]:checked')?.value || 'manual';
  const groupCount = parseInt(document.getElementById('f-group-count').value) || 0;
  if (!groupCount) { toast('Vui lòng nhập số lượng nhóm', 'warning'); return; }
  try {
    const btn = document.getElementById('btn-create-session');
    btn.disabled = true; btn.textContent = 'Đang tạo...';
    await API.post('/api/admin/session/create', { subject, mode, groupCount });
    toast(`✅ Đã tạo phiên "${subject}" thành công!`, 'success');
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

async function loadHistory() {
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
          `<span class="history-member-chip">${m.fullName || m.username || '?'}</span>`
        ).join('');
        return `<div class="history-group-section">
          <div class="history-group-name" style="color:${color}">${g.name} <span style="font-size:11px;color:var(--text-2);font-weight:400;">(${g.members.length} người)</span></div>
          <div class="history-member-list">${memberChips || '<span style="font-size:11px;color:var(--text-3);">Chưa có thành viên</span>'}</div>
        </div>`;
      }).join('');
      return `<div class="card history-card">
        <div class="history-header">
          <div class="history-subject">${s.subject} ${status}</div>
          <div class="history-date">🕐 ${date} | ${s.mode === 'manual' ? '🖱️ Tự chọn' : '🎰 Random'}</div>
        </div>
        <div class="history-groups">${groupsHtml}</div>
      </div>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
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
  '#8b5cf6','#06b6d4','#f43f5e','#10b981','#f59e0b',
  '#ec4899','#f97316','#84cc16','#6366f1','#14b8a6',
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
      <span style="color:${color}">${group.name}</span>
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
  const colors = ['#8b5cf6','#06b6d4','#f43f5e','#10b981','#f59e0b','#ec4899'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left:${Math.random() * 100}vw;
      top:${-10 + Math.random() * -20}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      width:${6+Math.random()*7}px;
      height:${6+Math.random()*7}px;
      border-radius:${Math.random()>0.5?'50%':'2px'};
      animation-duration:${2 + Math.random() * 2}s;
      animation-delay:${Math.random() * 0.4}s;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

// ─── Profile Modal ────────────────────────────────────────────────────
const AVATARS = ['😀','😎','🤩','🦸','🧑‍💻','👨‍🎓','👩‍🎓','🦊','🐱','🐶','🐸','🐼','🦁','🐯','🐻','🦋','🌈','⭐','🔥','💎','🚀','🎮','🏆','🎯','🎨','🎸','⚽','🏀'];

function openProfileModal() {
  if (!state.user) return;
  document.getElementById('profile-fullname').textContent = state.user.fullName;
  document.getElementById('btn-save-profile').disabled = true;
  API.get('/api/user/me').then(user => {
    document.getElementById('profile-dob').textContent = `📅 ${user.dob}`;
    document.getElementById('profile-hometown').textContent = `📍 ${user.hometown}`;
    const bigAvatar = document.getElementById('profile-big-avatar');
    setAvatarEl(bigAvatar, user.avatar, user.fullName);
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
  }).catch(() => {});
  const grid = document.getElementById('avatar-grid');
  const current = state.user.avatar;
  grid.innerHTML = AVATARS.map(a =>
    `<div class="avatar-option ${current === a ? 'selected' : ''}" onclick="selectAvatar('${a}', this)">${a}</div>`
  ).join('');
  state.selectedAvatarEmoji = null;
  document.getElementById('profile-modal').classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.add('hidden');
}

function selectAvatar(emoji, el) {
  document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedAvatarEmoji = emoji;
  const bigAvatar = document.getElementById('profile-big-avatar');
  bigAvatar.textContent = emoji;
  bigAvatar.style.background = 'none';
  bigAvatar.style.fontSize = '26px';
  checkProfileChanges();
}

function handleAvatarFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('File quá lớn (tối đa 2MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const b64 = e.target.result;
    state.selectedAvatarEmoji = b64;
    const bigAvatar = document.getElementById('profile-big-avatar');
    bigAvatar.innerHTML = `<img src="${b64}" alt="avatar" />`;
    document.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
    checkProfileChanges();
  };
  reader.readAsDataURL(file);
}

function checkProfileChanges() {
  const oldP = document.getElementById('old-password').value;
  const newP = document.getElementById('new-password').value;
  const cfmP = document.getElementById('confirm-password').value;
  
  const hasChanges = (oldP || newP || cfmP) || (state.selectedAvatarEmoji !== null);
  document.getElementById('btn-save-profile').disabled = !hasChanges;
}

async function saveProfile() {
  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  const btn = document.getElementById('btn-save-profile');

  if (newPassword && newPassword !== confirmPassword) {
    toast('Mật khẩu xác nhận không khớp!', 'error'); return;
  }
  if (newPassword && newPassword.length < 6) {
    toast('Mật khẩu mới phải có ít nhất 6 ký tự', 'warning'); return;
  }

  const body = {};
  if (newPassword) { body.oldPassword = oldPassword; body.newPassword = newPassword; }
  if (state.selectedAvatarEmoji !== null) body.avatar = state.selectedAvatarEmoji;

  if (!Object.keys(body).length) { toast('Không có thay đổi nào', 'info'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ Đang lưu...';

  try {
    const updated = await API.patch('/api/user/profile', body);
    state.user = { ...state.user, ...updated };
    localStorage.setItem('user', JSON.stringify(state.user));
    updateNavbar();
    toast('✅ Đã lưu thay đổi thành công!', 'success');
    closeProfileModal();
  } catch (err) { 
    toast(err.message, 'error');
  } finally {
    btn.textContent = '💾 Lưu thay đổi';
    checkProfileChanges();
  }
}

// ─── Init ─────────────────────────────────────────────────────────────
function init() {
  if (state.token && state.user) {
    if (state.user.role === 'admin') showAdminView();
    else showUserView();
  } else {
    showLoginView();
  }
}

// Close modals on backdrop click
document.getElementById('profile-modal').addEventListener('click', function(e) {
  if (e.target === this) closeProfileModal();
});
document.getElementById('slider-overlay').addEventListener('click', function(e) {
  if (e.target === this && !sliderState.spinning) closeSlider();
});

init();


// ─── Anti-Inspect Troll ───────────────────────────────────────────────
let warned = false;

function playSiren() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    
    // Tạo oscillator chính phát tiếng còi
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    
    // Tần số dao động wailing (tiếng còi cảnh sát hú lên hú xuống)
    const modulator = audioCtx.createOscillator();
    const modGain = audioCtx.createGain();
    modulator.frequency.value = 2.5; // Tần số hú 2.5 lần/giây
    modGain.gain.value = 200; // Dao động +/- 200Hz xung quanh 300Hz (100Hz - 500Hz)
    
    modulator.connect(modGain);
    modGain.connect(osc.frequency);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    modulator.start();
  } catch (err) {
    console.error("Audio failed to play", err);
  }
}

function antiInspectAlert(e) {
  if (e) e.preventDefault();
  if (warned) return;
  warned = true;

  const title = "Anh Hoàng yêu quý của em cho biết:";
  const msg = "Đm Hải Long ơi anh biết em đang định làm gì đấy, đừng có mà táy máy!!";

  // Phát tiếng còi hú báo động
  playSiren();

  // Đổi giao diện màn hình nhấp nháy liên tục đỏ/đen cực căng
  document.body.innerHTML = `
    <style>
      @keyframes blink {
        0% { background-color: #ff0000; color: #ffffff; }
        50% { background-color: #000000; color: #ff0000; }
        100% { background-color: #ff0000; color: #ffffff; }
      }
      .troll-screen {
        display: flex;
        height: 100vh;
        width: 100vw;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        font-size: 32px;
        font-weight: bold;
        text-align: center;
        padding: 20px;
        box-sizing: border-box;
        animation: blink 0.4s infinite;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .troll-title {
        font-size: 46px;
        margin-bottom: 24px;
        text-transform: uppercase;
        border: 6px solid currentColor;
        padding: 15px 30px;
        border-radius: 10px;
      }
    </style>
    <div class="troll-screen">
      <div style="font-size: 120px; margin-bottom: 20px;">🚨</div>
      <div class="troll-title">${title}</div>
      <div style="font-size: 28px; max-width: 800px; line-height: 1.5;">${msg}</div>
    </div>
  `;

  // Spam log console làm đơ trình duyệt nếu cố tình mở DevTools
  setInterval(() => {
    console.log("%c" + msg, "color: red; font-size: 30px; font-weight: bold; background: black; padding: 10px; border-radius: 5px;");
  }, 100);

  // Hiển thị hộp thoại cảnh báo (trì hoãn 100ms để DOM kịp đổi)
  setTimeout(() => {
    alert(`${title}\n\n${msg}`);
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

