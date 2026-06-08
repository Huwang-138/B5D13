/* ════════════════════════════════════════════════════════════════════
   app.js — Ứng dụng Quản lý Nhóm Lớp Học
   ════════════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────────────
let state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  session: null,
  myGroup: null,
  isFixed: false,
  members: [],
  pollingTimer: null,
  selectedAvatarEmoji: null,
};

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
  }, 3500);
}

// ─── Views ────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showLoginView() {
  document.getElementById('navbar').classList.add('hidden');
  showView('view-login');
  stopPolling();
}

function showUserView() {
  document.getElementById('navbar').classList.remove('hidden');
  updateNavbar();
  showView('view-user');
  loadClassMembers();
  startPolling();
}

function showAdminView() {
  document.getElementById('navbar').classList.remove('hidden');
  updateNavbar();
  showView('view-admin');
  loadClassMembers(true);
  loadAdminSession();
  startPolling();
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
    : '<span class="badge badge-cyan">🎓 Học sinh</span>';
}

function setAvatarEl(el, avatar, fullName) {
  if (avatar && avatar.startsWith('data:')) {
    el.innerHTML = `<img src="${avatar}" alt="${fullName}" />`;
  } else if (avatar) {
    el.textContent = avatar;
    el.style.background = 'none';
    el.style.fontSize = '22px';
  } else {
    el.textContent = (fullName || '?').charAt(0).toUpperCase();
    el.style.background = '';
    el.style.fontSize = '';
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
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showLoginView();
  toast('Đã đăng xuất', 'info');
}

// ─── Class Members ────────────────────────────────────────────────────
async function loadClassMembers(isAdmin = false) {
  try {
    const members = await API.get('/api/class/members');
    state.members = members;
    renderClassTable(members, isAdmin);
  } catch (err) { toast(err.message, 'error'); }
}

function renderClassTable(members, isAdmin = false) {
  const tbodyId = isAdmin ? 'admin-class-tbody' : 'class-tbody';
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = members.map(m => {
    const avatarHtml = m.avatar && m.avatar.startsWith('data:')
      ? `<img src="${m.avatar}" alt="" />`
      : (m.avatar || m.fullName.charAt(0));
    const roleBadge = m.role === 'admin'
      ? '<span class="badge badge-amber">👑 Admin</span>'
      : '<span class="badge badge-cyan">🎓 HS</span>';
    const adminExtra = isAdmin
      ? `<td>${m.phone || '—'}</td><td style="font-family:monospace;font-size:12px">${m.username}</td><td>${roleBadge}</td>`
      : `<td>${roleBadge}</td>`;
    return `<tr>
      <td style="color:var(--text-2);font-weight:700;">${m.stt}</td>
      <td><div class="td-avatar">
        <div class="td-avatar-img">${avatarHtml}</div>
        <span style="font-weight:600;">${m.fullName}</span>
      </div></td>
      <td>${m.dob}</td>
      <td><span class="badge ${m.gender==='Nữ'?'badge-rose':'badge-cyan'}">${m.gender}</span></td>
      <td>${m.hometown}</td>
      ${adminExtra}
    </tr>`;
  }).join('');
}

// ─── Polling ──────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  state.pollingTimer = setInterval(pollSessionStatus, 2000);
  pollSessionStatus();
}

function stopPolling() {
  if (state.pollingTimer) { clearInterval(state.pollingTimer); state.pollingTimer = null; }
}

async function pollSessionStatus() {
  try {
    const data = await API.get('/api/session/status');
    if (document.getElementById('view-user').classList.contains('active')) {
      renderUserSession(data);
    }
    if (document.getElementById('view-admin').classList.contains('active')) {
      renderAdminStats(data);
      // Refresh manage tab if active
      const manageTab = document.getElementById('tab-manage');
      if (manageTab && manageTab.classList.contains('active') && data.active) {
        renderAdminGroups(data.session);
      }
      // Update active session alert
      const alert = document.getElementById('active-session-alert');
      if (data.active) {
        alert.classList.remove('hidden');
        alert.style.display = 'flex';
        document.getElementById('active-session-name').textContent = `"${data.session.subject}" — ${data.session.mode === 'manual' ? 'Tự chọn' : 'Random'} — ${data.session.groups.length} nhóm`;
      } else {
        alert.classList.add('hidden');
      }
    }
    state.session = data.active ? data.session : null;
    state.myGroup = data.myGroup || null;
    state.isFixed = data.isFixed || false;
  } catch {}
}

// ─── User Session Rendering ───────────────────────────────────────────
function renderUserSession(data) {
  const banner = document.getElementById('session-banner');
  const noSession = document.getElementById('no-session-placeholder');
  const groupsSection = document.getElementById('groups-section');
  const myGroupCard = document.getElementById('my-group-card');
  const wheelTrigger = document.getElementById('wheel-trigger-section');

  if (!data.active) {
    banner.classList.add('hidden');
    noSession.classList.remove('hidden');
    groupsSection.classList.add('hidden');
    myGroupCard.classList.add('hidden');
    wheelTrigger.classList.add('hidden');
    return;
  }

  const session = data.session;
  noSession.classList.add('hidden');

  // Update banner
  banner.classList.remove('hidden');
  document.getElementById('sb-subject').textContent = session.subject;
  document.getElementById('sb-mode-badge').innerHTML =
    session.mode === 'manual' ? '🖱️ Tự chọn' : '🎡 Ngẫu nhiên';
  document.getElementById('sb-groups-badge').innerHTML = `${session.groups.length} nhóm`;

  // My group card
  if (data.myGroup) {
    myGroupCard.classList.remove('hidden');
    const grp = session.groups.find(g => g.groupId === data.myGroup);
    document.getElementById('my-group-name').textContent = grp ? grp.name : `Nhóm ${data.myGroup}`;
    const fixedMsg = document.getElementById('my-group-fixed-msg');
    if (data.isFixed) fixedMsg.classList.remove('hidden'); else fixedMsg.classList.add('hidden');
    const leaveBtn = document.getElementById('btn-leave-group');
    leaveBtn.style.display = data.isFixed ? 'none' : '';
    wheelTrigger.classList.add('hidden');
    groupsSection.classList.remove('hidden');
  } else {
    myGroupCard.classList.add('hidden');
    if (session.mode === 'random') {
      wheelTrigger.classList.remove('hidden');
      groupsSection.classList.remove('hidden');
    } else {
      wheelTrigger.classList.add('hidden');
      groupsSection.classList.remove('hidden');
    }
  }

  // Render groups grid
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
      ${canJoin ? `<button class="btn btn-primary btn-sm group-join-btn" onclick="joinGroup(${g.groupId});event.stopPropagation()">Tham gia nhóm này</button>` : ''}
      ${isMyGroup ? `<div style="margin-top:10px;font-size:12px;color:var(--green);font-weight:700;">✓ Nhóm của bạn</div>` : ''}
    </div>`;
  }).join('');
}

// ─── Join / Leave Group ───────────────────────────────────────────────
async function joinGroup(groupId) {
  try {
    const data = await API.post('/api/session/join', { groupId });
    state.myGroup = data.myGroup;
    toast(`Đã tham gia Nhóm ${groupId}! 🎉`, 'success');
    await pollSessionStatus();
  } catch (err) { toast(err.message, 'error'); }
}

async function leaveGroup() {
  try {
    await API.post('/api/session/leave');
    state.myGroup = null;
    toast('Đã rời nhóm', 'info');
    await pollSessionStatus();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Admin Stats ──────────────────────────────────────────────────────
function renderAdminStats(data) {
  if (data.active) {
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
    updateManageTab(data);
    updateFixedTab(data);
  } catch (err) { toast(err.message, 'error'); }
}

function updateManageTab(data) {
  const noMsg = document.getElementById('no-active-session-msg');
  const content = document.getElementById('manage-content');
  if (!data.active) {
    noMsg.classList.remove('hidden'); content.classList.add('hidden');
    return;
  }
  noMsg.classList.add('hidden'); content.classList.remove('hidden');
  document.getElementById('manage-session-title').textContent =
    `📋 ${data.session.subject} — ${data.session.mode === 'manual' ? 'Tự chọn' : 'Random'}`;
  renderAdminGroups(data.session);
}

function updateFixedTab(data) {
  const noMsg = document.getElementById('no-active-session-fixed-msg');
  const content = document.getElementById('fixed-content');
  if (!data.active) { noMsg.classList.remove('hidden'); content.classList.add('hidden'); return; }
  noMsg.classList.add('hidden'); content.classList.remove('hidden');
  renderFixedAssignList(data.session);
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
          <select class="input" style="padding:4px 8px;font-size:11px;height:28px;" onchange="moveMember('${m._id}', ${g.groupId}, this.value, this)">
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
      ${g.members.length === 0 ? '<div style="font-size:13px;color:var(--text-3);padding:8px 0;text-align:center">Chưa có thành viên</div>' : ''}
    </div>`;
  }).join('');

  // Unassigned
  const allMemberIds = new Set();
  session.groups.forEach(g => g.members.forEach(m => allMemberIds.add((m._id||m).toString())));
  const unassigned = state.members.filter(m => !allMemberIds.has(m._id.toString()));
  document.getElementById('unassigned-count').textContent = unassigned.length;
  document.getElementById('unassigned-list').innerHTML = unassigned.map(m =>
    `<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:20px;font-size:13px;">
      ${m.fullName}
    </span>`
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
      const memberIds = g.members.map(mem => (mem._id||mem).toString());
      if (fixedIds.includes(m._id.toString())) { currentGroupId = g.groupId; isFixed = true; break; }
    }
    const options = session.groups.map(g => `<option value="${g.groupId}" ${currentGroupId===g.groupId?'selected':''}>${g.name}</option>`).join('');
    return `<div class="assign-item">
      <div class="member-avatar-sm">${m.avatar && m.avatar.startsWith('data:') ? `<img src="${m.avatar}" alt="" />` : (m.avatar || m.fullName.charAt(0))}</div>
      <span class="assign-item-name">${m.fullName} ${isFixed ? '🔒' : ''}</span>
      <div class="assign-item-group" style="display:flex;gap:6px;align-items:center;">
        <select class="input" style="padding:6px 10px;font-size:12px;" id="fixed-select-${m._id}">
          <option value="">Không cố định</option>
          ${options}
        </select>
        <button class="btn btn-primary btn-sm" onclick="applyFixed('${m._id}')">Xác nhận</button>
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
    await pollSessionStatus();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Admin Actions ────────────────────────────────────────────────────
function updatePreview() {
  const groupCount = parseInt(document.getElementById('f-group-count').value) || 0;
  const memberCount = parseInt(document.getElementById('f-member-count').value) || 0;
  const preview = document.getElementById('group-preview');
  let numGroups = groupCount;
  if (!numGroups && memberCount) numGroups = Math.ceil(25 / memberCount);
  if (numGroups < 1) { preview.classList.add('hidden'); return; }
  const base = Math.floor(25 / numGroups);
  const extra = 25 % numGroups;
  let desc = `<strong>${numGroups} nhóm</strong> với phân bổ:<br>`;
  if (extra > 0) desc += `• ${extra} nhóm có <strong>${base + 1} người</strong><br>`;
  desc += `• ${numGroups - extra} nhóm có <strong>${base} người</strong>`;
  preview.innerHTML = desc;
  preview.classList.remove('hidden');
}

async function createSession() {
  const subject    = document.getElementById('f-subject').value.trim() || 'Môn học';
  const mode       = document.querySelector('input[name="f-mode"]:checked')?.value || 'manual';
  const groupCount = parseInt(document.getElementById('f-group-count').value) || 0;
  const memberPerGroup = parseInt(document.getElementById('f-member-count').value) || 0;
  if (!groupCount && !memberPerGroup) { toast('Vui lòng nhập số nhóm hoặc số thành viên mỗi nhóm', 'warning'); return; }
  try {
    const btn = document.getElementById('btn-create-session');
    btn.disabled = true; btn.textContent = 'Đang tạo...';
    await API.post('/api/admin/session/create', { subject, mode, groupCount, memberPerGroup });
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
  if (!confirm('Bạn có chắc muốn kết thúc phiên này? Dữ liệu nhóm sẽ được lưu lại.')) return;
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

async function exportCSV() {
  window.location.href = '/api/admin/export';
}

async function loadHistory() {
  try {
    const sessions = await API.get('/api/admin/sessions');
    const list = document.getElementById('history-list');
    if (sessions.length === 0) {
      list.innerHTML = '<div class="no-session-placeholder"><div class="no-session-icon">📜</div><div class="no-session-title">Chưa có lịch sử</div></div>';
      return;
    }
    list.innerHTML = sessions.map(s => {
      const date = new Date(s.createdAt).toLocaleString('vi-VN');
      const status = s.active
        ? '<span class="badge badge-green pulse">🟢 Đang hoạt động</span>'
        : '<span class="badge badge-amber">⏹ Đã kết thúc</span>';
      const groupsHtml = s.groups.map(g => `<span class="history-group-pill">${g.name}: ${g.members.length} người</span>`).join('');
      return `<div class="card history-card">
        <div class="history-header">
          <div>
            <div class="history-subject">${s.subject} ${status}</div>
            <div class="history-date">🕐 ${date} | ${s.mode === 'manual' ? '🖱️ Tự chọn' : '🎡 Random'}</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="exportCSVById('${s._id}')">📥 Xuất CSV</button>
        </div>
        <div class="history-groups">${groupsHtml}</div>
      </div>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

async function exportCSVById(sessionId) {
  window.location.href = `/api/admin/export?sessionId=${sessionId}`;
}

// ─── Tab Switching ────────────────────────────────────────────────────
function switchTab(tabId, btn) {
  document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  if (btn) btn.classList.add('active');
  // Lazy-load
  if (tabId === 'tab-history') loadHistory();
  if (tabId === 'tab-manage' || tabId === 'tab-fixed') loadAdminSession();
}

// ─── Wheel / Canvas ───────────────────────────────────────────────────
let wheelState = {
  spinning: false,
  currentAngle: 0,
  segments: [],
  audioCtx: null,
};

function openWheel() {
  if (!state.session) return;
  const available = state.session.groups.filter(g => g.members.length < g.capacity);
  if (available.length === 0) { toast('Tất cả các nhóm đã đầy!', 'warning'); return; }
  wheelState.segments = available;
  document.getElementById('wheel-overlay').classList.remove('hidden');
  document.getElementById('wheel-result').style.display = 'none';
  document.getElementById('wheel-spin-btn').disabled = false;
  document.getElementById('wheel-spin-btn').textContent = '🎡 Quay ngẫu nhiên';
  drawWheel(wheelState.currentAngle);
}

function closeWheel() {
  document.getElementById('wheel-overlay').classList.add('hidden');
}

const WHEEL_COLORS = [
  '#8b5cf6','#06b6d4','#f43f5e','#10b981','#f59e0b',
  '#ec4899','#f97316','#84cc16','#6366f1','#14b8a6',
];

function drawWheel(rotation) {
  const canvas = document.getElementById('wheel-canvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8;
  const segs = wheelState.segments;
  const arc = (2 * Math.PI) / segs.length;
  ctx.clearRect(0, 0, w, h);

  segs.forEach((seg, i) => {
    const start = rotation + i * arc;
    const end   = start + arc;
    // Slice
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Text
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + arc / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${segs.length > 6 ? 12 : 14}px Outfit, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(seg.name, r - 12, 5);
    ctx.restore();
  });

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, 28, 0, 2 * Math.PI);
  ctx.fillStyle = '#0d1220';
  ctx.fill();
  ctx.strokeStyle = 'rgba(139,92,246,0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GO', cx, cy);
}

function spinWheel() {
  if (wheelState.spinning) return;
  const segs = wheelState.segments;
  if (!segs.length) return;

  wheelState.spinning = true;
  document.getElementById('wheel-spin-btn').disabled = true;
  document.getElementById('wheel-spin-btn').textContent = '⏳ Đang quay...';

  // Pick a winner
  const winnerIdx = Math.floor(Math.random() * segs.length);
  const arc = (2 * Math.PI) / segs.length;

  // Target angle: land on winnerIdx segment's center
  const targetOffset = -(winnerIdx * arc + arc / 2); // center of winner segment points to top
  const extraSpins = (5 + Math.floor(Math.random() * 4)) * 2 * Math.PI;
  const targetAngle = -Math.PI / 2 + targetOffset + extraSpins; // top = -PI/2

  const startAngle = wheelState.currentAngle;
  const totalDelta = targetAngle - startAngle;
  const duration = 4000 + Math.random() * 1000;
  const startTime = performance.now();

  // Click sound via Web Audio
  try {
    if (!wheelState.audioCtx) wheelState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {}

  let lastClickAngle = startAngle;

  function animate(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    const currentAngle = startAngle + totalDelta * eased;
    wheelState.currentAngle = currentAngle;
    drawWheel(currentAngle);

    // Click sound every segment
    const currentSeg = Math.floor(((currentAngle % (2*Math.PI)) / arc + segs.length) % segs.length);
    const lastSeg    = Math.floor(((lastClickAngle % (2*Math.PI)) / arc + segs.length) % segs.length);
    if (currentSeg !== lastSeg && wheelState.audioCtx) {
      playClick(wheelState.audioCtx);
    }
    lastClickAngle = currentAngle;

    if (t < 1) { requestAnimationFrame(animate); }
    else {
      wheelState.spinning = false;
      onWheelStopped(winnerIdx);
    }
  }
  requestAnimationFrame(animate);
}

function playClick(ctx) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.06);
  } catch {}
}

async function onWheelStopped(winnerIdx) {
  const winner = wheelState.segments[winnerIdx];
  document.getElementById('wheel-spin-btn').textContent = '🎡 Quay ngẫu nhiên';
  try {
    // Submit to server
    const data = await API.post('/api/session/spin', {});
    const actualGroupId = data.groupId;
    const actualGroupName = data.groupName;
    // Show result
    const resultEl = document.getElementById('wheel-result');
    resultEl.style.display = 'block';
    document.getElementById('wheel-result-name').textContent = actualGroupName;
    // Confetti!
    launchConfetti();
    toast(`🎉 Chúc mừng! Bạn vào ${actualGroupName}!`, 'success');
    state.myGroup = actualGroupId;
    await pollSessionStatus();
    // Auto-close after 3s
    setTimeout(() => { closeWheel(); }, 4000);
  } catch (err) {
    toast(err.message, 'error');
    document.getElementById('wheel-spin-btn').disabled = false;
  }
}

// ─── Confetti ─────────────────────────────────────────────────────────
function launchConfetti() {
  const colors = ['#8b5cf6','#06b6d4','#f43f5e','#10b981','#f59e0b','#ec4899'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left:${Math.random() * 100}vw;
      top:${-10 + Math.random() * -20}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      width:${6+Math.random()*8}px;
      height:${6+Math.random()*8}px;
      border-radius:${Math.random()>0.5?'50%':'2px'};
      animation-duration:${2 + Math.random() * 2}s;
      animation-delay:${Math.random() * 0.5}s;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

// ─── Profile Modal ────────────────────────────────────────────────────
const AVATARS = ['😀','😎','🤩','🦸','🧑‍💻','👨‍🎓','👩‍🎓','🦊','🐱','🐶','🐸','🐼','🦁','🐯','🐻','🦋','🌈','⭐','🔥','💎','🚀','🎮','🏆','🎯','🎨','🎸','⚽','🏀'];

function openProfileModal() {
  if (!state.user) return;
  // Fill info
  document.getElementById('profile-fullname').textContent = state.user.fullName;
  // Fetch full profile
  API.get('/api/user/me').then(user => {
    document.getElementById('profile-dob').textContent = `📅 ${user.dob}`;
    document.getElementById('profile-hometown').textContent = `📍 ${user.hometown}`;
    const bigAvatar = document.getElementById('profile-big-avatar');
    setAvatarEl(bigAvatar, user.avatar, user.fullName);
    document.getElementById('new-username').value = user.username;
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
  }).catch(() => {});
  // Avatar grid
  const grid = document.getElementById('avatar-grid');
  const current = state.user.avatar;
  grid.innerHTML = AVATARS.map(a =>
    `<div class="avatar-option ${current === a ? 'selected' : ''}" onclick="selectAvatar('${a}', this)">${a}</div>`
  ).join('');
  document.getElementById('profile-modal').classList.remove('hidden');
  wheelState.selectedAvatarEmoji = null;
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
  bigAvatar.style.fontSize = '36px';
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
  };
  reader.readAsDataURL(file);
}

async function saveProfile() {
  const newUsername = document.getElementById('new-username').value.trim();
  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (newPassword && newPassword !== confirmPassword) {
    toast('Mật khẩu xác nhận không khớp!', 'error'); return;
  }
  if (newPassword && newPassword.length < 6) {
    toast('Mật khẩu mới phải có ít nhất 6 ký tự', 'warning'); return;
  }

  const body = {};
  if (newUsername && newUsername !== state.user.username) body.username = newUsername;
  if (newPassword) { body.oldPassword = oldPassword; body.newPassword = newPassword; }
  if (state.selectedAvatarEmoji !== null) body.avatar = state.selectedAvatarEmoji;

  if (!Object.keys(body).length) { toast('Không có thay đổi nào', 'info'); return; }

  try {
    const updated = await API.patch('/api/user/profile', body);
    state.user = { ...state.user, ...updated };
    localStorage.setItem('user', JSON.stringify(state.user));
    updateNavbar();
    toast('✅ Đã lưu thay đổi thành công!', 'success');
    closeProfileModal();
  } catch (err) { toast(err.message, 'error'); }
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

init();
