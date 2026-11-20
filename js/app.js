
/* =========================================================
   HOTEL BOOKING APP - COMPLETE SUPABASE VERSION
   ========================================================= */

(async function () {
  'use strict';

  /* ---------- SUPABASE ---------- */

  const SUPABASE_URL = 'https://abrfitfcfgtcmuplwenl.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_9cKAWzanSjSKeYY108j9rw_PZJeTG6U';

  const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

  // Client riêng để xác minh mật khẩu cũ, không thay phiên đăng nhập chính
  const verifyClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );

  /* ---------- CONSTANTS ---------- */

  const HW = 64;
  const ROOMW = 124;
  const SNAP = 30;

  const HOUR = 3600000;
  const MIN = 60000;
  const DAY = 86400000;

  const LS = {
    rooms: 'hp_rooms',
    bookings: 'hp_bookings'
  };

  const STATUS = {
    wait: 'Giữ chỗ (chưa cọc)',
    dep: 'Đã cọc',
    in: 'Đang ở',
    out: 'Đã trả phòng',
    cancel: 'Đã hủy'
  };

  /* ---------- HELPERS ---------- */

  const $ = (s, r = document) => r.querySelector(s);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

  const pad = n => String(n).padStart(2, '0');

  const money = n => (Number(n) || 0).toLocaleString('vi-VN');

  const sv = (k, v) =>
    localStorage.setItem(k, JSON.stringify(v));

  const sod = d => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const toInput = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const fromInput = value => {
    const m = String(value || '').trim().match(
      /^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/
    );

    if (!m) return NaN;

    const dd = +m[1];
    const mm = +m[2];
    const yy = 2000 + (+m[3]);
    const hh = +m[4];
    const mi = +m[5];

    const d = new Date(yy, mm - 1, dd, hh, mi);

    return d.getFullYear() === yy &&
      d.getMonth() === mm - 1 &&
      d.getDate() === dd &&
      hh >= 0 && hh < 24 &&
      mi >= 0 && mi < 60
      ? d.getTime()
      : NaN;
  };

  const dateStr = d =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;

  const parseDateInput = value => {
    const m = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (!m) return null;

    const yy = 2000 + (+m[3]);
    const mm = +m[2];
    const dd = +m[1];
    const d = new Date(yy, mm - 1, dd);

    return d.getFullYear() === yy &&
      d.getMonth() === mm - 1 &&
      d.getDate() === dd ? d : null;
  };

  const fmtT = ts => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const fmtDT = ts => {
    const d = new Date(ts);
    return `${fmtT(ts)} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  };

  const WD = [
    'Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư',
    'Thứ năm', 'Thứ sáu', 'Thứ bảy'
  ];

  const norm = s =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');

  /* ---------- STATE ---------- */

  const state = {
    users: [],
    rooms: [],
    bookings: [],
    me: null,
    date: sod(new Date())
  };

  const isMgr = () =>
    state.me?.role === 'manager';

  /* ---------- TOAST ---------- */

  let toastT;

  function toast(message, bad = false) {
    const el = $('#toast');
    if (!el) return;

    el.textContent = message;
    el.className = 'show' + (bad ? ' bad' : '');

    clearTimeout(toastT);
    toastT = setTimeout(() => {
      el.className = '';
    }, 3500);
  }

  /* ---------- BOOKING TIME ---------- */

  function effectiveTimes(b) {
    const now = Date.now();

    let start = Number(b.start);
    let end = Number(b.end);

    if (b.status === 'cancel') {
      end = Number(b.cancelledAt || b.end);
    } else if (b.status === 'out') {
      end = Number(b.actualEnd || b.end);
    } else if (b.status === 'in') {
      start = Number(b.actualStart || b.start);
      if (now > end) end = now;
    }

    return {
      start,
      end,
      now,
      lateCheckin:
        ['wait', 'dep'].includes(b.status) &&
        !b.actualStart &&
        now > b.start,
      overtime: b.status === 'in' && now > b.end
    };
  }

  function fmtLate(ms) {
    const m = Math.max(0, Math.floor(ms / MIN));
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? `${h} giờ ${r} phút` : `${r} phút`;
  }

  /* ---------- SUPABASE DATA ---------- */

  let syncQueue = Promise.resolve();

  async function loadUserData(user) {
    const { data: profile, error: profileError } = await db
      .from('hp_profiles')
      .select('id,email,role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error(
        'Không tải được hồ sơ tài khoản: ' +
        (profileError?.message || 'Không tìm thấy hồ sơ')
      );
    }

    if (!['manager', 'staff'].includes(profile.role)) {
      throw new Error('Tài khoản chưa được cấp quyền hợp lệ.');
    }

    const { data: roomRows, error: roomsError } = await db
      .from('hp_rooms')
      .select('id,data');

    if (roomsError) throw roomsError;

    const { data: bookingRows, error: bookingsError } = await db
      .from('hp_bookings')
      .select('id,data');

    if (bookingsError) throw bookingsError;

    state.rooms = (roomRows || []).map(x => x.data);
    state.bookings = (bookingRows || []).map(x => x.data);

    // Chỉ tạo phòng mặc định khi quản lý đăng nhập lần đầu
    if (state.rooms.length === 0 && profile.role === 'manager') {
      state.rooms = ['101', '102', '103', '104', '105'].map(n => ({
        id: uid(),
        name: 'Phòng ' + n,
        type: ''
      }));

      const { error } = await db
        .from('hp_rooms')
        .insert(state.rooms.map(room => ({
          id: room.id,
          data: room
        })));

      if (error) throw error;
    }

    sv(LS.rooms, state.rooms);
    sv(LS.bookings, state.bookings);

    return {
      id: profile.id,
      email: profile.email,
      username: profile.email,
      role: profile.role
    };
  }

  async function saveAll() {
    sv(LS.rooms, state.rooms);
    sv(LS.bookings, state.bookings);

    if (!state.me) return false;

    const roomsSnapshot = state.rooms.map(room => ({
      id: room.id,
      data: room
    }));

    const bookingsSnapshot = state.bookings.map(booking => ({
      id: booking.id,
      data: booking
    }));

    syncQueue = syncQueue.then(async () => {
      if (isMgr()) {
        const { error } = await db
          .from('hp_rooms')
          .upsert(roomsSnapshot);

        if (error) throw error;
      }

      const { error } = await db
        .from('hp_bookings')
        .upsert(bookingsSnapshot);

      if (error) throw error;

      return true;
    }).catch(error => {
      console.error('Supabase sync error:', error);
      toast('Lỗi đồng bộ dữ liệu: ' + error.message, true);
      return false;
    });

    return syncQueue;
  }

  async function deleteRoomFromDatabase(roomId, bookingIds) {
    if (bookingIds.length) {
      const { error } = await db
        .from('hp_bookings')
        .delete()
        .in('id', bookingIds);

      if (error) throw error;
    }

    const { error } = await db
      .from('hp_rooms')
      .delete()
      .eq('id', roomId);

    if (error) throw error;
  }

  /* ---------- LOGIN ---------- */

  async function showLogin() {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#le').textContent = '';
    $('#lp').value = '';
    $('#lu').focus();
  }

  function enterApp(user) {
    state.me = user;

    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');

    $('#umBtn').textContent = '👤 ' + user.email + ' ▾';

    state.date = sod(new Date());
    $('#dpick').value = dateStr(state.date);

    renderGrid();
    scrollDefault();
  }

  async function logout() {
    await db.auth.signOut();

    state.me = null;
    state.rooms = [];
    state.bookings = [];

    showLogin();
  }

  $('#lf').addEventListener('submit', async e => {
    e.preventDefault();

    const email = $('#lu').value.trim();
    const password = $('#lp').value;

    $('#le').textContent = 'Đang đăng nhập...';

    try {
      const { data, error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      const user = await loadUserData(data.user);

      $('#le').textContent = '';
      $('#lp').value = '';

      enterApp(user);

    } catch (error) {
      console.error('Login error:', error);
      $('#le').textContent =
        error.message || 'Đăng nhập thất bại. Vui lòng thử lại.';

      await db.auth.signOut();
    }
  });

  /* ---------- FORGOT PASSWORD ---------- */

  $('#forgotPassword').onclick = async () => {
    const email = $('#lu').value.trim();

    if (!email) {
      $('#le').textContent = 'Vui lòng nhập email trước.';
      $('#lu').focus();
      return;
    }

    $('#le').textContent = 'Đang gửi email khôi phục...';

    try {
      const redirectTo =
        window.location.origin + window.location.pathname;

      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo
      });

      if (error) throw error;

      $('#le').textContent =
        'Nếu email hợp lệ, hệ thống sẽ gửi hướng dẫn đặt lại mật khẩu. Hãy kiểm tra hộp thư.';

    } catch (error) {
      console.error('Forgot password error:', error);
      $('#le').textContent =
        error.message || 'Không gửi được email khôi phục.';
    }
  };

  function recoveryModal() {
    $('#login').classList.remove('hidden');
    $('#app').classList.add('hidden');

    openModal(`<h3>Tạo mật khẩu mới</h3>
      <form id="recoveryForm">
        <div class="f">
          <label>Mật khẩu mới (ít nhất 8 ký tự)</label>
          <input id="recoveryPassword" type="password" minlength="8" required>
        </div>

        <div class="f">
          <label>Nhập lại mật khẩu</label>
          <input id="recoveryConfirm" type="password" required>
        </div>

        <div class="err" id="recoveryError"></div>

        <div class="mfoot">
          <button class="primary">Lưu mật khẩu mới</button>
        </div>
      </form>`);

    $('#recoveryForm').onsubmit = async e => {
      e.preventDefault();

      const password = $('#recoveryPassword').value;
      const confirmPassword = $('#recoveryConfirm').value;
      const errorBox = $('#recoveryError');
      const submit = $('#recoveryForm').querySelector('button');

      if (password.length < 8) {
        errorBox.textContent = 'Mật khẩu cần ít nhất 8 ký tự.';
        return;
      }

      if (password !== confirmPassword) {
        errorBox.textContent = 'Hai mật khẩu không khớp.';
        return;
      }

      submit.disabled = true;
      errorBox.textContent = 'Đang cập nhật mật khẩu...';

      try {
        const { error } = await db.auth.updateUser({ password });
        if (error) throw error;

        closeModal();
        await db.auth.signOut();

        showLogin();
        $('#le').textContent =
          'Đã đổi mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.';

      } catch (error) {
        errorBox.textContent =
          error.message || 'Không thể cập nhật mật khẩu.';
        submit.disabled = false;
      }
    };
  }

  db.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') {
      setTimeout(recoveryModal, 0);
    }
  });

  /* ---------- GRID ---------- */

  function barHtml(b, ds, de) {
    const t = effectiveTimes(b);
    const s = Math.max(t.start, ds);
    const e = Math.min(t.end, de);

    if (e <= s) return '';

    const left = (s - ds) / HOUR * HW;
    const width = Math.max((e - s) / HOUR * HW, 18);

    const cls =
      (t.start < ds ? ' cl' : '') +
      (t.end > de ? ' cr' : '');

    const actual =
      `\nThực tế: ${b.actualStart ? fmtDT(b.actualStart) : 'Chưa nhận'} → ${b.actualEnd ? fmtDT(b.actualEnd) : 'Chưa trả'}`;

    const statusText = t.lateCheckin
      ? `⚠ TRỄ HẸN ${fmtLate(t.now - b.start)}`
      : t.overtime
        ? `⚠ QUÁ GIỜ TRẢ ${fmtLate(t.now - b.end)}`
        : STATUS[b.status] || '';

    const tip =
      `${b.name} ${b.phone || ''}\n` +
      `${fmtDT(b.start)} → ${fmtDT(b.end)}` +
      `${actual}\nTrạng thái: ${statusText}\n` +
      `Cọc: ${money(b.deposit)}đ` +
      `${b.note ? '\n' + b.note : ''}`;

    return `<div class="bk s-${esc(b.status)}${t.lateCheckin ? ' late' : ''}${t.overtime ? ' overtime' : ''}${cls}"
      data-id="${esc(b.id)}"
      style="left:${left}px;width:${width}px"
      title="${esc(tip)}">
      <i class="rh rl"></i>
      <div><b>${esc(b.name)}</b> ${esc(b.phone || '')}</div>
      <div class="bs">${fmtT(t.start)}–${fmtT(t.end)}${b.deposit ? ' · cọc ' + money(b.deposit) : ''}</div>
      ${(t.lateCheckin || t.overtime) ? `<div class="alerttxt">${esc(statusText)}</div>` : ''}
      <i class="rh rr"></i>
    </div>`;
  }

  function renderGrid() {
    const gw = $('#gw');
    const sl = gw.scrollLeft;
    const st = gw.scrollTop;

    const ds = state.date.getTime();
    const de = ds + DAY;

    let html = `<div class="grid" style="width:${ROOMW + 24 * HW}px">
      <div class="hdr">
        <div class="corner">
          <span class="ct">Giờ</span>
          <span class="cb">Phòng</span>
        </div>`;

    for (let i = 0; i < 24; i++) {
      html += `<div class="hh" style="width:${HW}px">${i}h</div>`;
    }

    html += '</div>';

    if (!state.rooms.length) {
      html += `<div class="empty">Chưa có phòng nào. ${
        isMgr()
          ? 'Vào menu → Quản lý phòng để thêm.'
          : 'Hãy nhờ quản lý thêm phòng.'
      }</div>`;
    }

    state.rooms.forEach((room, ri) => {
      html += `<div class="row">
        <div class="rc">
          <b>${esc(room.name)}</b>
          <small>${esc(room.type || '')}</small>
        </div>
        <div class="track" data-ri="${ri}" style="width:${24 * HW}px">`;

      state.bookings
        .filter(b =>
          b.roomId === room.id &&
          effectiveTimes(b).start < de &&
          effectiveTimes(b).end > ds
        )
        .forEach(b => {
          html += barHtml(b, ds, de);
        });

      html += '</div></div>';
    });

    html += '<div class="nowline hidden" id="nowl"></div></div>';

    gw.innerHTML = html;
    gw.scrollLeft = sl;
    gw.scrollTop = st;

    updateNow();
    updateSummary();
  }

  function updateNow() {
    const el = $('#nowl');
    if (!el) return;

    const ds = state.date.getTime();
    const now = Date.now();

    if (now < ds || now >= ds + DAY) {
      el.classList.add('hidden');
      return;
    }

    el.classList.remove('hidden');
    el.style.left = (ROOMW + (now - ds) / HOUR * HW) + 'px';
    el.innerHTML = `<span class="nowlabel">${fmtT(now)}</span>`;
  }

  function updateSummary() {
    const ds = state.date.getTime();
    const de = ds + DAY;

    const list = state.bookings.filter(b =>
      b.status !== 'cancel' &&
      effectiveTimes(b).start < de &&
      effectiveTimes(b).end > ds
    );

    const deposit = list.reduce((sum, b) => sum + (+b.deposit || 0), 0);

    $('#sum').innerHTML =
      `📅 <b>${WD[state.date.getDay()]}, ${pad(state.date.getDate())}/${pad(state.date.getMonth() + 1)}/${state.date.getFullYear()}</b> · ${list.length} lượt khách · Tổng cọc: ${money(deposit)}đ`;
  }

  function scrollDefault() {
    const gw = $('#gw');
    const isToday = state.date.getTime() === sod(new Date()).getTime();
    const hour = isToday ? Math.max(0, new Date().getHours() - 2) : 6;
    gw.scrollLeft = hour * HW;
  }

  function setDate(d) {
    state.date = sod(d);
    $('#dpick').value = dateStr(d);
    renderGrid();
    scrollDefault();
  }

  $('#prev').onclick = () =>
    setDate(new Date(state.date.getTime() - DAY));

  $('#next').onclick = () =>
    setDate(new Date(state.date.getTime() + DAY));

  $('#today').onclick = () => setDate(new Date());

  $('#dpick').onchange = e => {
    const d = parseDateInput(e.target.value);

    if (!d) {
      toast('Ngày không hợp lệ. Nhập DD/MM/YY', true);
      e.target.value = dateStr(state.date);
      return;
    }

    setDate(d);
  };

  setInterval(() => {
    if (state.me) {
      renderGrid();
    }
  }, 60000);

  /* ---------- CONFLICT ---------- */

  function findConflict(booking) {
    if (booking.status === 'cancel') return null;

    const bt = effectiveTimes(booking);

    return state.bookings.find(other => {
      if (
        other.id === booking.id ||
        other.status === 'cancel' ||
        other.roomId !== booking.roomId
      ) return false;

      const ot = effectiveTimes(other);
      return bt.start < ot.end && bt.end > ot.start;
    });
  }

  const roomName = id =>
    (state.rooms.find(r => r.id === id) || {}).name || '?';

  /* ---------- DRAG / RESIZE ---------- */

  let act = null;

  $('#gw').addEventListener('pointerdown', e => {
    if (e.button !== 0 || act) return;

    const gw = $('#gw');
    const el = e.target.closest('.bk');
    const track = e.target.closest('.track');

    if (el) {
      const booking = state.bookings.find(x => x.id === el.dataset.id);
      if (!booking) return;

      const mode = e.target.classList.contains('rl')
        ? 'rl'
        : e.target.classList.contains('rr')
          ? 'rr'
          : 'mv';

      const roomIndex = state.rooms.findIndex(r => r.id === booking.roomId);

      act = {
        type: 'bk',
        b: booking,
        el,
        mode,
        x0: e.clientX,
        y0: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        sl0: gw.scrollLeft,
        moved: false,
        dm: 0,
        ri0: roomIndex,
        ri: roomIndex
      };

    } else if (track) {
      const rect = track.getBoundingClientRect();

      act = {
        type: 'sel',
        tr: track,
        ri: +track.dataset.ri,
        x0: e.clientX,
        y0: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        sl0: gw.scrollLeft,
        moved: false,
        xr0: e.clientX - rect.left,
        xr: e.clientX - rect.left
      };

    } else {
      return;
    }

    act.timer = setInterval(autoScroll, 30);

    window.addEventListener('pointermove', onMoveA);
    window.addEventListener('pointerup', onUpA);
    window.addEventListener('pointercancel', onCancelA);

    if (e.pointerType === 'mouse') e.preventDefault();
  });

  function autoScroll() {
    if (!act || !act.moved) return;

    const gw = $('#gw');
    const rect = gw.getBoundingClientRect();

    if (act.lx > rect.right - 40) {
      gw.scrollLeft += 14;
    } else if (act.lx < rect.left + ROOMW + 30) {
      gw.scrollLeft -= 14;
    } else {
      return;
    }

    applyAct();
  }

  function onMoveA(e) {
    if (!act) return;

    act.lx = e.clientX;
    act.ly = e.clientY;

    if (!act.moved) {
      if (Math.hypot(e.clientX - act.x0, e.clientY - act.y0) < 5) {
        return;
      }

      act.moved = true;

      if (act.type === 'bk') {
        act.el.classList.add('dragging');
      } else {
        act.sb = document.createElement('div');
        act.sb.className = 'selbox';
        act.tr.appendChild(act.sb);
      }
    }

    applyAct();
  }

  function applyAct() {
    const gw = $('#gw');
    const dx = act.lx - act.x0 + (gw.scrollLeft - act.sl0);

    if (act.type === 'bk') {
      const dm = Math.round(dx / HW * 60 / SNAP) * SNAP;
      act.dm = dm;

      const booking = act.b;
      const el = act.el;
      const ds = state.date.getTime();

      if (act.mode === 'mv') {
        const tracks = gw.querySelectorAll('.track');
        if (!tracks.length) return;

        const first = tracks[0].getBoundingClientRect();
        const rowHeight = tracks[0].offsetHeight;

        let ri = Math.floor((act.ly - first.top) / rowHeight);
        ri = Math.max(0, Math.min(tracks.length - 1, ri));

        act.ri = ri;

        el.style.transform =
          `translate(${dm / 60 * HW}px,${(ri - act.ri0) * rowHeight}px)`;

      } else {
        let start = booking.start;
        let end = booking.end;

        if (act.mode === 'rl') {
          start = Math.min(
            booking.start + dm * MIN,
            booking.end - SNAP * MIN
          );
        } else {
          end = Math.max(
            booking.end + dm * MIN,
            booking.start + SNAP * MIN
          );
        }

        act.ns = start;
        act.ne = end;

        const visibleStart = Math.max(start, ds);
        const visibleEnd = Math.min(end, ds + DAY);

        el.style.left =
          (visibleStart - ds) / HOUR * HW + 'px';

        el.style.width =
          Math.max((visibleEnd - visibleStart) / HOUR * HW, 18) + 'px';
      }

    } else {
      const rect = act.tr.getBoundingClientRect();
      act.xr = act.lx - rect.left;

      const px = SNAP / 60 * HW;

      let a = Math.min(act.xr0, act.xr);
      let b = Math.max(act.xr0, act.xr);

      a = Math.max(0, Math.floor(a / px) * px);
      b = Math.min(
        24 * HW,
        Math.max(Math.ceil(b / px) * px, a + px)
      );

      act.sb.style.left = a + 'px';
      act.sb.style.width = (b - a) + 'px';
    }
  }

  function cleanupAct() {
    if (!act) return;

    clearInterval(act.timer);

    window.removeEventListener('pointermove', onMoveA);
    window.removeEventListener('pointerup', onUpA);
    window.removeEventListener('pointercancel', onCancelA);
  }

  function onCancelA() {
    if (!act) return;

    cleanupAct();
    act = null;
    renderGrid();
  }

  function onUpA() {
    if (!act) return;

    cleanupAct();

    const a = act;
    act = null;

    const ds = state.date.getTime();

    if (a.type === 'bk') {
      if (!a.moved) {
        openBooking(a.b.id);
        return;
      }

      const booking = a.b;

      let start = booking.start;
      let end = booking.end;
      let roomId = booking.roomId;

      if (a.mode === 'mv') {
        start += a.dm * MIN;
        end += a.dm * MIN;

        if (!state.rooms[a.ri]) {
          renderGrid();
          return;
        }

        roomId = state.rooms[a.ri].id;

      } else {
        start = a.ns ?? start;
        end = a.ne ?? end;
      }

      if (
        start === booking.start &&
        end === booking.end &&
        roomId === booking.roomId
      ) {
        renderGrid();
        return;
      }

      const conflict = findConflict({
        ...booking,
        start,
        end,
        roomId
      });

      if (conflict) {
        toast(
          `Trùng lịch với ${conflict.name} (${roomName(conflict.roomId)}, ${fmtDT(conflict.start)} → ${fmtDT(conflict.end)})`,
          true
        );
        renderGrid();
        return;
      }

      booking.start = start;
      booking.end = end;
      booking.roomId = roomId;
      booking.updatedBy = state.me.username;

      renderGrid();

      saveAll().then(ok => {
        if (ok) toast('Đã cập nhật lịch: ' + booking.name);
      });

    } else {
      if (a.sb) a.sb.remove();

      const pxPerMinute = HW / 60;

      let startMinute;
      let endMinute;

      if (!a.moved) {
        startMinute =
          Math.floor(a.xr0 / HW * 60 / SNAP) * SNAP;

        endMinute = startMinute + 120;

      } else {
        const lo = Math.min(a.xr0, a.xr);
        const hi = Math.max(a.xr0, a.xr);

        startMinute =
          Math.floor(lo / pxPerMinute / SNAP) * SNAP;

        endMinute =
          Math.max(
            Math.ceil(hi / pxPerMinute / SNAP) * SNAP,
            startMinute + SNAP
          );
      }

      startMinute = Math.max(0, startMinute);
      endMinute = Math.min(1440, endMinute);

      if (endMinute <= startMinute) {
        endMinute = Math.min(1440, startMinute + SNAP);
      }

      if (!state.rooms[a.ri]) return;

      openBooking(null, {
        roomId: state.rooms[a.ri].id,
        start: ds + startMinute * MIN,
        end: ds + endMinute * MIN
      });
    }
  }

  /* ---------- MODAL HELPERS ---------- */

  const modal = $('#modal');
  const mbox = $('#mbox');

  function openModal(html) {
    mbox.onclick = null;
    mbox.onchange = null;
    mbox.innerHTML = html;
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
    mbox.innerHTML = '';
    mbox.onclick = null;
    mbox.onchange = null;
  }

  modal.addEventListener('mousedown', e => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  /* ---------- BOOKING MODAL ---------- */

  function openBooking(id, pre) {
    if (!state.rooms.length) {
      toast(
        'Chưa có phòng. ' +
        (isMgr() ? 'Hãy thêm phòng trước.' : 'Hãy nhờ quản lý thêm phòng.'),
        true
      );
      return;
    }

    const booking = id
      ? state.bookings.find(x => x.id === id)
      : null;

    if (id && !booking) {
      toast('Không tìm thấy booking này.', true);
      return;
    }

    const ds = state.date.getTime();

    let defaultStart = ds + 14 * HOUR;

    if (ds === sod(new Date()).getTime()) {
      const now = new Date();
      now.setMinutes(0, 0, 0);
      defaultStart = now.getTime() + HOUR;
    }

    const d = booking || {
      roomId: pre?.roomId || state.rooms[0].id,
      start: pre?.start ?? defaultStart,
      end: pre?.end ?? ((pre?.start ?? defaultStart) + 2 * HOUR),
      name: '',
      phone: '',
      guests: 1,
      total: 0,
      deposit: 0,
      source: '',
      note: '',
      status: 'wait'
    };

    openModal(`<h3>${booking ? 'Sửa thông tin khách' : 'Thêm khách đặt phòng'}</h3>
      <form id="bf">
        <div class="g2">
          <div>
            <label>Phòng</label>
            <select id="f_room">
              ${state.rooms.map(r =>
                `<option value="${esc(r.id)}" ${r.id === d.roomId ? 'selected' : ''}>${esc(r.name)}</option>`
              ).join('')}
            </select>
          </div>

          <div>
            <label>Trạng thái</label>
            <select id="f_status">
              ${Object.entries(STATUS).map(([key, value]) =>
                `<option value="${key}" ${key === d.status ? 'selected' : ''}>${value}</option>`
              ).join('')}
            </select>
          </div>

          <div>
            <label>Giờ nhận phòng dự kiến</label>
            <input type="text" id="f_start"
              value="${toInput(d.start)}"
              placeholder="DD/MM/YY HH:mm" required>
          </div>

          <div>
            <label>Giờ trả phòng dự kiến</label>
            <input type="text" id="f_end"
              value="${toInput(d.end)}"
              placeholder="DD/MM/YY HH:mm" required>
          </div>

          <div>
            <label>Giờ nhận phòng thực tế</label>
            <input type="text" id="f_actual_start"
              value="${booking?.actualStart ? toInput(booking.actualStart) : ''}"
              placeholder="DD/MM/YY HH:mm">
          </div>

          <div>
            <label>Giờ trả phòng thực tế</label>
            <input type="text" id="f_actual_end"
              value="${booking?.actualEnd ? toInput(booking.actualEnd) : ''}"
              placeholder="DD/MM/YY HH:mm">
          </div>

          <div>
            <label>Tên khách *</label>
            <input id="f_name" value="${esc(d.name)}" required>
          </div>

          <div>
            <label>Số điện thoại</label>
            <input id="f_phone" type="tel" value="${esc(d.phone)}">
          </div>

          <div>
            <label>Số khách</label>
            <input id="f_guests" type="number" min="1" value="${d.guests || 1}">
          </div>

          <div>
            <label>Nguồn khách</label>
            <input id="f_source"
              placeholder="Zalo, Facebook, Booking..."
              value="${esc(d.source)}">
          </div>

          <div>
            <label>Tổng tiền (đ)</label>
            <input id="f_total" type="number" min="0" step="1000" value="${d.total || 0}">
          </div>

          <div>
            <label>Tiền cọc (đ)</label>
            <input id="f_dep" type="number" min="0" step="1000" value="${d.deposit || 0}">
          </div>

          <div class="full rest">
            Còn lại phải thu: <span id="rest"></span>đ
          </div>

          <div class="full">
            <small style="color:var(--muted)">
              Định dạng ngày DD/MM/YY · Giờ 24h HH:mm.
              Giờ đặt và giờ thực tế được lưu riêng.
            </small>
          </div>

          <div class="full">
            <label>Ghi chú</label>
            <textarea id="f_note" rows="2">${esc(d.note)}</textarea>
          </div>
        </div>

        <div class="err" id="f_err"></div>

        ${booking ? `<div style="font-size:12px;color:var(--muted)">
          Tạo bởi ${esc(booking.createdBy || '?')}
          ${booking.updatedBy ? ' · sửa bởi ' + esc(booking.updatedBy) : ''}
        </div>` : ''}

        <div class="mfoot">
          ${booking && booking.status !== 'cancel'
            ? '<button type="button" class="danger l" id="f_del">Hủy booking</button>'
            : ''}

          ${booking && !['cancel', 'out'].includes(booking.status)
            ? '<button type="button" id="f_checkin">Nhận phòng ngay</button>'
            : ''}

          ${booking && booking.status === 'in'
            ? '<button type="button" class="primary" id="f_checkout">Trả phòng ngay</button>'
            : ''}

          <button type="button" id="f_cancel">Đóng</button>
          <button class="primary">Lưu</button>
        </div>
      </form>`);

    const updateRest = () => {
      $('#rest').textContent = money(
        (+$('#f_total').value || 0) -
        (+$('#f_dep').value || 0)
      );
    };

    updateRest();

    $('#f_total').oninput = updateRest;
    $('#f_dep').oninput = updateRest;
    $('#f_cancel').onclick = closeModal;

    if (booking && booking.status !== 'cancel') {
      $('#f_del').onclick = async () => {
        if (!confirm(
          `Hủy booking của khách "${booking.name}"? Lịch sử sẽ được giữ lại.`
        )) return;

        booking.status = 'cancel';
        booking.cancelledAt = Date.now();
        booking.cancelledBy = state.me.username;
        booking.updatedBy = state.me.username;

        closeModal();
        renderGrid();

        const ok = await saveAll();
        if (ok) toast('Đã hủy booking');
      };
    }

    if (booking && !['cancel', 'out'].includes(booking.status)) {
      $('#f_checkin').onclick = async () => {
        if (!confirm('Xác nhận khách nhận phòng ngay?')) return;

        booking.actualStart = Date.now();
        booking.status = 'in';
        booking.updatedBy = state.me.username;

        closeModal();
        renderGrid();

        const ok = await saveAll();
        if (ok) toast('Đã ghi nhận giờ nhận phòng thực tế');
      };
    }

    if (booking && booking.status === 'in') {
      $('#f_checkout').onclick = async () => {
        if (!confirm('Xác nhận khách trả phòng ngay?')) return;

        const now = Date.now();

        booking.actualEnd = now;
        booking.status = 'out';
        booking.updatedBy = state.me.username;

        closeModal();
        renderGrid();

        const ok = await saveAll();
        if (ok) toast('Đã trả phòng lúc ' + fmtDT(now));
      };
    }

    $('#bf').onsubmit = async e => {
      e.preventDefault();

      const nb = {
        id: booking ? booking.id : uid(),
        roomId: $('#f_room').value,
        status: $('#f_status').value,
        start: fromInput($('#f_start').value),
        end: fromInput($('#f_end').value),
        name: $('#f_name').value.trim(),
        phone: $('#f_phone').value.trim(),
        guests: Math.max(1, +$('#f_guests').value || 1),
        source: $('#f_source').value.trim(),
        total: Math.max(0, +$('#f_total').value || 0),
        deposit: Math.max(0, +$('#f_dep').value || 0),
        note: $('#f_note').value.trim(),
        actualStart: $('#f_actual_start').value.trim()
          ? fromInput($('#f_actual_start').value)
          : null,
        actualEnd: $('#f_actual_end').value.trim()
          ? fromInput($('#f_actual_end').value)
          : null
      };

      const showError = message => {
        $('#f_err').textContent = message;
      };

      if (!nb.name) {
        showError('Vui lòng nhập tên khách.');
        return;
      }

      if (!Number.isFinite(nb.start) || !Number.isFinite(nb.end)) {
        showError('Ngày giờ dự kiến không hợp lệ. Dùng DD/MM/YY HH:mm.');
        return;
      }

      if (nb.end <= nb.start) {
        showError('Giờ trả dự kiến phải sau giờ nhận dự kiến.');
        return;
      }

      if (nb.actualStart !== null && !Number.isFinite(nb.actualStart)) {
        showError('Giờ nhận thực tế không hợp lệ.');
        return;
      }

      if (nb.actualEnd !== null && !Number.isFinite(nb.actualEnd)) {
        showError('Giờ trả thực tế không hợp lệ.');
        return;
      }

      if (
        nb.actualStart !== null &&
        nb.actualEnd !== null &&
        nb.actualEnd <= nb.actualStart
      ) {
        showError('Giờ trả thực tế phải sau giờ nhận thực tế.');
        return;
      }

      if (nb.actualStart !== null && nb.actualEnd !== null &&
          nb.actualEnd <= nb.actualStart) {
        showError('Khoảng thời gian thực tế không hợp lệ.');
        return;
      }

      if (nb.deposit > nb.total && nb.total > 0) {
        showError('Tiền cọc không thể lớn hơn tổng tiền.');
        return;
      }

      const conflict = findConflict(nb);

      if (conflict) {
        showError(
          `Trùng lịch phòng ${roomName(conflict.roomId)}: ${conflict.name} (${fmtDT(conflict.start)} → ${fmtDT(conflict.end)})`
        );
        return;
      }

      if (booking) {
        Object.assign(booking, nb, {
          createdBy: booking.createdBy,
          createdAt: booking.createdAt,
          updatedBy: state.me.username
        });
      } else {
        nb.createdBy = state.me.username;
        nb.createdAt = Date.now();
        state.bookings.push(nb);
      }

      const submit = $('#bf').querySelector('button.primary');
      submit.disabled = true;

      const oldDate = state.date.getTime();
      closeModal();

      if (nb.start < oldDate || nb.start >= oldDate + DAY) {
        state.date = sod(new Date(nb.start));
        $('#dpick').value = dateStr(state.date);
      }

      renderGrid();

      const ok = await saveAll();

      if (ok) {
        toast('Đã lưu booking thành công');
      } else {
        toast('Chưa đồng bộ được booking lên máy chủ. Vui lòng kiểm tra kết nối.', true);
      }
    };

    setTimeout(() => $('#f_name')?.focus(), 30);
  }

  $('#addBk').onclick = () => openBooking();

  /* ---------- SEARCH ---------- */

  $('#q').addEventListener('input', e => {
    const query = norm(e.target.value.trim());
    const box = $('#qres');

    if (!query) {
      box.classList.add('hidden');
      return;
    }

    const results = state.bookings
      .filter(b =>
        norm(b.name).includes(query) ||
        norm(b.phone).includes(query)
      )
      .sort((a, b) =>
        Math.abs(a.start - Date.now()) -
        Math.abs(b.start - Date.now())
      )
      .slice(0, 8);

    box.innerHTML = results.length
      ? results.map(b => `<div data-id="${esc(b.id)}">
          <b>${esc(b.name)}</b> ${esc(b.phone || '')}
          <small>${esc(roomName(b.roomId))} · ${fmtDT(b.start)} → ${fmtDT(b.end)}${b.status === 'cancel' ? ' · ĐÃ HỦY' : ''}</small>
        </div>`).join('')
      : '<div style="cursor:default">Không tìm thấy</div>';

    box.classList.remove('hidden');
  });

  $('#qres').addEventListener('click', e => {
    const item = e.target.closest('[data-id]');
    if (!item) return;

    const booking = state.bookings.find(x => x.id === item.dataset.id);
    if (!booking) return;

    $('#qres').classList.add('hidden');
    $('#q').value = '';

    setDate(new Date(booking.start));
    openBooking(booking.id);
  });

  /* ---------- USER MENU ---------- */

  $('#umBtn').onclick = e => {
    e.stopPropagation();

    const menu = $('#um');

    if (!menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
      return;
    }

    menu.innerHTML = `<div class="who">
        ${esc(state.me.username)} · ${isMgr() ? 'Quản lý' : 'Nhân viên'}
      </div>

      ${isMgr() ? `
        <button data-a="rooms">🛏 Quản lý phòng</button>
        <button data-a="users">👥 Quản lý tài khoản</button>
        <button data-a="export">⬇ Sao lưu dữ liệu</button>
        <button data-a="import">⬆ Khôi phục dữ liệu</button>
      ` : ''}

      <button data-a="pw">🔑 Đổi mật khẩu</button>
      <button data-a="out">🚪 Đăng xuất</button>`;

    menu.classList.remove('hidden');
  };

  $('#um').onclick = e => {
    const button = e.target.closest('[data-a]');
    if (!button) return;

    const action = button.dataset.a;
    $('#um').classList.add('hidden');

    const actions = {
      rooms: roomsModal,
      users: usersModal,
      export: exportData,
      import: () => $('#importFile').click(),
      pw: pwModal,
      out: logout
    };

    actions[action]?.();
  };

  document.addEventListener('click', e => {
    if (!e.target.closest('.usermenu')) {
      $('#um').classList.add('hidden');
    }

    if (!e.target.closest('.search')) {
      $('#qres').classList.add('hidden');
    }
  });

  /* ---------- ROOMS ---------- */

  function roomsModal() {
    if (!isMgr()) {
      toast('Bạn không có quyền quản lý phòng.', true);
      return;
    }

    const draw = () => {
      mbox.innerHTML = `<h3>Quản lý phòng</h3>

        <div class="list">
          ${state.rooms.map((room, i) => `
            <div class="rrow">
              <input
                data-f="name"
                data-i="${i}"
                value="${esc(room.name)}"
                placeholder="Tên phòng">

              <input
                data-f="type"
                data-i="${i}"
                value="${esc(room.type || '')}"
                placeholder="Loại / ghi chú">

              <button data-up="${i}" title="Lên">↑</button>
              <button data-dn="${i}" title="Xuống">↓</button>
              <button class="danger" data-del="${i}" title="Xóa phòng">🗑</button>
            </div>
          `).join('') || '<div class="empty">Chưa có phòng</div>'}
        </div>

        <div class="rrow">
          <input id="nrn" placeholder="Tên phòng mới (vd: Phòng 106)">
          <input id="nrt" placeholder="Loại phòng">
          <button class="primary" data-add="1">+ Thêm</button>
        </div>

        <div class="mfoot">
          <button class="primary" data-done="1">Xong</button>
        </div>`;
    };

    openModal('');
    draw();

    mbox.onchange = async e => {
      const target = e.target;

      if (!target.dataset.f) return;

      const index = Number(target.dataset.i);
      const field = target.dataset.f;

      if (!state.rooms[index]) return;

      const oldValue = state.rooms[index][field];
      const newValue = target.value.trim();

      if (field === 'name' && !newValue) {
        target.value = oldValue;
        toast('Tên phòng không được để trống.', true);
        return;
      }

      if (
        field === 'name' &&
        state.rooms.some((room, i) =>
          i !== index && norm(room.name) === norm(newValue)
        )
      ) {
        target.value = oldValue;
        toast('Tên phòng đã tồn tại.', true);
        return;
      }

      state.rooms[index][field] = newValue;

      const ok = await saveAll();

      if (!ok) {
        state.rooms[index][field] = oldValue;
        target.value = oldValue;
        toast('Không lưu được thông tin phòng.', true);
      }

      renderGrid();
    };

    mbox.onclick = async e => {
      const button = e.target.closest('button');
      if (!button) return;

      const d = button.dataset;

      if (d.done) {
        closeModal();
        return;
      }

      if (d.add) {
        const name = $('#nrn').value.trim();
        const type = $('#nrt').value.trim();

        if (!name) {
          toast('Vui lòng nhập tên phòng.', true);
          return;
        }

        if (state.rooms.some(r => norm(r.name) === norm(name))) {
          toast('Tên phòng đã tồn tại.', true);
          return;
        }

        const room = {
          id: uid(),
          name,
          type
        };

        state.rooms.push(room);

        const ok = await saveAll();

        if (!ok) {
          state.rooms = state.rooms.filter(r => r.id !== room.id);
          toast('Không lưu được phòng mới.', true);
          return;
        }

      } else if (d.up !== undefined) {
        const i = Number(d.up);

        if (i > 0) {
          [state.rooms[i - 1], state.rooms[i]] =
            [state.rooms[i], state.rooms[i - 1]];
        }

        const ok = await saveAll();
        if (!ok) toast('Không lưu được thứ tự phòng.', true);

      } else if (d.dn !== undefined) {
        const i = Number(d.dn);

        if (i < state.rooms.length - 1) {
          [state.rooms[i + 1], state.rooms[i]] =
            [state.rooms[i], state.rooms[i + 1]];
        }

        const ok = await saveAll();
        if (!ok) toast('Không lưu được thứ tự phòng.', true);

      } else if (d.del !== undefined) {
        const index = Number(d.del);
        const room = state.rooms[index];

        if (!room) return;

        const related = state.bookings.filter(b => b.roomId === room.id);
        const bookingIds = related.map(b => b.id);

        if (!confirm(
          `Xóa ${room.name}?` +
          (related.length
            ? `\nPhòng này có ${related.length} lượt đặt. Tất cả booking của phòng cũng sẽ bị xóa.`
            : '')
        )) return;

        try {
          await deleteRoomFromDatabase(room.id, bookingIds);

          state.bookings = state.bookings.filter(b => b.roomId !== room.id);
          state.rooms.splice(index, 1);

          sv(LS.rooms, state.rooms);
          sv(LS.bookings, state.bookings);

          toast('Đã xóa phòng.');

        } catch (error) {
          console.error('Delete room error:', error);
          toast('Không xóa được phòng: ' + error.message, true);
          return;
        }

      } else {
        return;
      }

      renderGrid();
      draw();
    };
  }

  /* ---------- USERS ---------- */

  async function usersModal() {
    if (!isMgr()) {
      toast('Bạn không có quyền quản lý tài khoản.', true);
      return;
    }

    const callAdmin = async (action, extra = {}) => {
      const { data, error } = await db.functions.invoke(
        'dynamic-processor',
        { body: { action, ...extra } }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data;
    };

    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h3>Quản lý tài khoản</h3>
        <button type="button" id="closeUsers">Đóng</button>
      </div>

      <div id="usersError" class="err"></div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0">
        <strong>Danh sách tài khoản</strong>
        <button type="button" class="primary" id="showCreateUser">
          + Tạo tài khoản
        </button>
      </div>

      <div id="usersList">Đang tải danh sách...</div>

      <div id="createUserArea" class="hidden">
        <hr>
        <h3>Tạo tài khoản mới</h3>

        <form id="newUserForm">
          <div class="g2">
            <div class="full">
              <label>Email đăng nhập</label>
              <input id="newEmail" type="email" required>
            </div>

            <div class="full">
              <label>Mật khẩu (ít nhất 8 ký tự)</label>
              <input id="newPassword" type="password" minlength="8" required>
            </div>

            <div class="full">
              <label>Quyền</label>
              <select id="newRole">
                <option value="staff">Nhân viên</option>
                <option value="manager">Quản lý</option>
              </select>
            </div>
          </div>

          <div class="err" id="newUserError"></div>

          <div class="mfoot">
            <button type="button" id="cancelCreateUser">Hủy</button>
            <button class="primary">Tạo tài khoản</button>
          </div>
        </form>
      </div>
    `);

    const errorBox = $('#usersError');
    const listBox = $('#usersList');
    const createArea = $('#createUserArea');

    $('#closeUsers').onclick = closeModal;

    $('#showCreateUser').onclick = () => {
      createArea.classList.toggle('hidden');
    };

    $('#cancelCreateUser').onclick = () => {
      createArea.classList.add('hidden');
    };

    async function loadUsers() {
      listBox.innerHTML = 'Đang tải danh sách...';
      errorBox.textContent = '';

      try {
        const result = await callAdmin('list');
        const users = result.users || [];

        if (!users.length) {
          listBox.innerHTML = '<p>Chưa có tài khoản nào.</p>';
          return;
        }

        listBox.innerHTML = users.map(user => {
          const isMe = user.id === state.me?.id;
          const roleName =
            user.role === 'manager' ? 'Quản lý' : 'Nhân viên';

          return `
            <div style="
              border:1px solid var(--border,#ddd);
              border-radius:8px;
              padding:12px;
              margin-bottom:10px;
            ">
              <div style="font-weight:600;overflow-wrap:anywhere">
                ${esc(user.email)}
                ${isMe ? '<small>(Bạn)</small>' : ''}
              </div>

              <div style="margin:6px 0">
                Quyền: <strong>${roleName}</strong>
              </div>

              ${!isMe ? `
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
                  <button type="button"
                    data-action="role"
                    data-id="${esc(user.id)}"
                    data-role="${esc(user.role)}">
                    Đổi quyền
                  </button>

                  <button type="button"
                    data-action="password"
                    data-id="${esc(user.id)}">
                    Đặt lại mật khẩu
                  </button>

                  <button type="button"
                    data-action="delete"
                    data-id="${esc(user.id)}"
                    style="color:#dc2626">
                    Xóa tài khoản
                  </button>
                </div>
              ` : ''}
            </div>
          `;
        }).join('');

      } catch (error) {
        console.error('Load users error:', error);
        listBox.innerHTML = '';
        errorBox.textContent =
          error.message || 'Không tải được danh sách tài khoản.';
      }
    }

    $('#newUserForm').onsubmit = async e => {
      e.preventDefault();

      const email = $('#newEmail').value.trim();
      const password = $('#newPassword').value;
      const role = $('#newRole').value;
      const formError = $('#newUserError');
      const submit = $('#newUserForm').querySelector('button.primary');

      if (password.length < 8) {
        formError.textContent = 'Mật khẩu cần ít nhất 8 ký tự.';
        return;
      }

      submit.disabled = true;
      formError.textContent = 'Đang tạo tài khoản...';

      try {
        await callAdmin('create', { email, password, role });

        toast('Đã tạo tài khoản thành công.');

        $('#newUserForm').reset();
        createArea.classList.add('hidden');

        await loadUsers();

      } catch (error) {
        console.error('Create user error:', error);
        formError.textContent =
          error.message || 'Không tạo được tài khoản.';
      } finally {
        submit.disabled = false;
      }
    };

    listBox.addEventListener('click', async e => {
      const button = e.target.closest('button[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const id = button.dataset.id;

      button.disabled = true;

      try {
        if (action === 'role') {
          const currentRole = button.dataset.role;
          const newRole =
            currentRole === 'manager' ? 'staff' : 'manager';

          const roleName =
            newRole === 'manager' ? 'Quản lý' : 'Nhân viên';

          if (!confirm(
            `Bạn muốn đổi quyền tài khoản này thành ${roleName}?`
          )) return;

          await callAdmin('update_role', {
            id,
            role: newRole
          });

          toast('Đã cập nhật quyền tài khoản.');
          await loadUsers();

        } else if (action === 'password') {
          const password = prompt(
            'Nhập mật khẩu mới (ít nhất 8 ký tự):'
          );

          if (password === null) return;

          if (password.length < 8) {
            alert('Mật khẩu cần ít nhất 8 ký tự.');
            return;
          }

          await callAdmin('reset_password', {
            id,
            password
          });

          toast('Đã đặt lại mật khẩu.');

        } else if (action === 'delete') {
          if (!confirm(
            'Bạn chắc chắn muốn xóa tài khoản này? Người dùng sẽ không thể đăng nhập nữa.'
          )) return;

          await callAdmin('delete', { id });

          toast('Đã xóa tài khoản.');
          await loadUsers();
        }

      } catch (error) {
        console.error('Manage user error:', error);
        alert(error.message || 'Không thực hiện được thao tác.');
      } finally {
        button.disabled = false;
      }
    });

    await loadUsers();
  }

 
/* ---------- CHANGE PASSWORD ---------- */

function pwModal() {
  openModal(`<h3>Đổi mật khẩu</h3>
    <form id="pf">
      <div class="g2">
        <div class="full">
          <label>Mật khẩu hiện tại</label>
          <input id="p0" type="password" required>
        </div>

        <div>
          <label>Mật khẩu mới</label>
          <input id="p1" type="password" minlength="8" required>
        </div>

        <div>
          <label>Nhập lại</label>
          <input id="p2" type="password" required>
        </div>
      </div>

      <div class="err" id="pe"></div>

      <div class="mfoot">
        <button type="button" id="pc">Hủy</button>
        <button class="primary">Đổi mật khẩu</button>
      </div>
    </form>`);

  $('#pc').onclick = closeModal;

  $('#pf').onsubmit = async e => {
    e.preventDefault();

    const oldPassword = $('#p0').value;
    const newPassword = $('#p1').value;
    const errorBox = $('#pe');
    const submit = $('#pf').querySelector('button.primary');

    if (newPassword.length < 8) {
      errorBox.textContent = 'Mật khẩu mới tối thiểu 8 ký tự.';
      return;
    }

    if (newPassword !== $('#p2').value) {
      errorBox.textContent = 'Nhập lại mật khẩu không khớp.';
      return;
    }

    if (oldPassword === newPassword) {
      errorBox.textContent = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
      return;
    }

    submit.disabled = true;

    try {
      errorBox.textContent = 'Đang kiểm tra phiên đăng nhập...';

      // Kiểm tra phiên đăng nhập chính
      const { data: sessionData, error: sessionError } =
        await db.auth.getSession();

      if (sessionError) throw sessionError;

      if (!sessionData.session) {
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }

      // Kiểm tra mật khẩu hiện tại bằng client riêng
      errorBox.textContent = 'Đang xác minh mật khẩu hiện tại...';

      const { error: verifyError } =
        await verifyClient.auth.signInWithPassword({
          email: state.me.email,
          password: oldPassword
        });

      if (verifyError) {
        throw new Error('Mật khẩu hiện tại không đúng.');
      }

      await verifyClient.auth.signOut();

      // Đổi mật khẩu bằng phiên đăng nhập chính
      errorBox.textContent = 'Đang đổi mật khẩu...';

      const { error } = await db.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      closeModal();
      toast('Đã đổi mật khẩu thành công.');

    } catch (error) {
      console.error('Change password error:', error);
      errorBox.textContent = error.message || 'Không đổi được mật khẩu.';
    } finally {
      submit.disabled = false;
    }
  };
}


  /* ---------- BACKUP / EXPORT ---------- */

  function exportData() {
    if (!isMgr()) {
      toast('Bạn không có quyền sao lưu dữ liệu.', true);
      return;
    }

    const backup = {
      app: 'hotel-booking',
      version: 1,
      exportedAt: new Date().toISOString(),
      rooms: state.rooms,
      bookings: state.bookings
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download =
      'lich-dat-phong-' +
      new Date().toISOString().slice(0, 10) +
      '.json';

    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Đã tạo file sao lưu.');
  }

  /* ---------- IMPORT / RESTORE ---------- */

  $('#importFile').onchange = e => {
    const file = e.target.files[0];
    e.target.value = '';

    if (!file) return;

    if (!isMgr()) {
      toast('Bạn không có quyền khôi phục dữ liệu.', true);
      return;
    }

    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const json = JSON.parse(reader.result);

        if (
          !Array.isArray(json.rooms) ||
          !Array.isArray(json.bookings)
        ) {
          throw new Error('File không đúng định dạng.');
        }

        const roomIds = new Set();

        for (const room of json.rooms) {
          if (!room.id || !room.name) {
            throw new Error('Dữ liệu phòng trong file không hợp lệ.');
          }

          if (roomIds.has(room.id)) {
            throw new Error('File có mã phòng bị trùng.');
          }

          roomIds.add(room.id);
        }

        const bookingIds = new Set();

        for (const booking of json.bookings) {
          if (
            !booking.id ||
            !booking.roomId ||
            !Number.isFinite(Number(booking.start)) ||
            !Number.isFinite(Number(booking.end)) ||
            Number(booking.end) <= Number(booking.start)
          ) {
            throw new Error('Dữ liệu booking trong file không hợp lệ.');
          }

          if (!roomIds.has(booking.roomId)) {
            throw new Error(
              `Booking ${booking.name || booking.id} đang tham chiếu đến phòng không tồn tại trong file.`
            );
          }

          if (bookingIds.has(booking.id)) {
            throw new Error('File có mã booking bị trùng.');
          }

          bookingIds.add(booking.id);
        }

        if (!confirm(
          `Khôi phục ${json.rooms.length} phòng và ${json.bookings.length} booking?\n\nDữ liệu hiện tại sẽ được thay thế trên máy chủ. Bạn nên sao lưu trước khi tiếp tục.`
        )) return;

        const oldRooms = state.rooms;
        const oldBookings = state.bookings;

        state.rooms = json.rooms;
        state.bookings = json.bookings;

        // Ghi các dữ liệu trong bản sao lưu lên Supabase.
        const roomRows = state.rooms.map(room => ({
          id: room.id,
          data: room
        }));

        const bookingRows = state.bookings.map(booking => ({
          id: booking.id,
          data: booking
        }));

        try {
          // Xóa dữ liệu cũ trước khi thay thế.
          const { error: deleteBookingsError } = await db
            .from('hp_bookings')
            .delete()
            .neq('id', '');

          if (deleteBookingsError) throw deleteBookingsError;

          const { error: deleteRoomsError } = await db
            .from('hp_rooms')
            .delete()
            .neq('id', '');

          if (deleteRoomsError) throw deleteRoomsError;

          if (roomRows.length) {
            const { error } = await db
              .from('hp_rooms')
              .insert(roomRows);

            if (error) throw error;
          }

          if (bookingRows.length) {
            const { error } = await db
              .from('hp_bookings')
              .insert(bookingRows);

            if (error) throw error;
          }

          sv(LS.rooms, state.rooms);
          sv(LS.bookings, state.bookings);

          renderGrid();
          toast('Đã khôi phục dữ liệu thành công.');

        } catch (error) {
          console.error('Restore error:', error);

          // Khôi phục dữ liệu đang có trên giao diện.
          state.rooms = oldRooms;
          state.bookings = oldBookings;

          renderGrid();

          toast(
            'Khôi phục thất bại: ' + error.message +
            '. Hãy kiểm tra dữ liệu Supabase trước khi thử lại.',
            true
          );
        }

      } catch (error) {
        console.error('Import error:', error);
        toast(error.message || 'File sao lưu không hợp lệ.', true);
      }
    };

    reader.readAsText(file);
  };

  /* ---------- AUTH STATE ---------- */

  db.auth.onAuthStateChange(async (event) => {
    if (event === 'PASSWORD_RECOVERY') {
      setTimeout(recoveryModal, 0);
    }
  });

  /* ---------- START ---------- */

  try {
    const { data, error } = await db.auth.getSession();

    if (error) throw error;

    if (data.session?.user) {
      const user = await loadUserData(data.session.user);
      enterApp(user);
    } else {
      showLogin();
    }

  } catch (error) {
    console.error('App startup error:', error);
    await db.auth.signOut();
    showLogin();
    $('#le').textContent =
      error.message || 'Không khởi động được ứng dụng.';
  }

})();
