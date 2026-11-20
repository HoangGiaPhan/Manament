
/* =========================================================
   HOTEL BOOKING APP - SUPABASE VERSION
   ========================================================= */

(async function () {
  'use strict';

  /* ---------- SUPABASE ---------- */

  const SUPABASE_URL = 'https://abrfitfcfgtcmuplwenl.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_9cKAWzanSjSKeYY108j9rw_PZJeTG6U';

  const db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );

  /* ---------- CONSTANTS ---------- */

  const HW = 64;
  const ROOMW = 124;
  const SNAP = 30;

  const HOUR = 36e5;
  const MIN = 6e4;
  const DAY = 864e5;

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
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const pad = n => String(n).padStart(2, '0');

  const money = n => (Number(n) || 0).toLocaleString('vi-VN');

  const ld = (k, d) => {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v ?? d;
    } catch (e) {
      return d;
    }
  };

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

  const fromInput = v => {
    const m = String(v || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
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
      hh < 24 &&
      mi < 60
      ? d.getTime()
      : NaN;
  };

  const dateStr = d =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;

  const dateInput = d => dateStr(d);

  const parseDateInput = v => {
    const m = String(v || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (!m) return null;

    const yy = 2000 + (+m[3]);
    const mm = +m[2];
    const dd = +m[1];

    const d = new Date(yy, mm - 1, dd);

    return d.getFullYear() === yy &&
      d.getMonth() === mm - 1 &&
      d.getDate() === dd
      ? d
      : null;
  };

  const fmtT = ts => {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  const fmtDT = ts => {
    const d = new Date(ts);
    return fmtT(ts) + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
  };

  const WD = [
    'Chủ nhật',
    'Thứ hai',
    'Thứ ba',
    'Thứ tư',
    'Thứ năm',
    'Thứ sáu',
    'Thứ bảy'
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
    state.me && state.me.role === 'manager';

  /* ---------- TOAST ---------- */

  let toastT;

  function toast(msg, bad) {
    const t = $('#toast');
    if (!t) return;

    t.textContent = msg;
    t.className = 'show' + (bad ? ' bad' : '');

    clearTimeout(toastT);
    toastT = setTimeout(() => t.className = '', 3000);
  }

  /* ---------- BOOKING TIME ---------- */

  const effectiveTimes = b => {
    const now = Date.now();

    let start = b.start;
    let end = b.end;

    if (b.status === 'cancel') {
      end = b.cancelledAt || b.end;
    } else if (b.status === 'out') {
      end = b.actualEnd || b.end;
    } else if (b.status === 'in') {
      start = b.actualStart || b.start;
      if (now > end) end = now;
    }

    return {
      start,
      end,
      now,
      lateCheckin:
        (b.status === 'wait' || b.status === 'dep') &&
        !b.actualStart &&
        now > b.start,
      overtime: b.status === 'in' && now > b.end
    };
  };

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
  console.error('Profile query failed:', profileError);

  throw new Error(
    'Lỗi hồ sơ: ' +
    (profileError?.message || 'Không có dữ liệu') +
    ' | Code: ' +
    (profileError?.code || 'N/A')
  );
}

    if (!['manager', 'staff'].includes(profile.role)) {
      throw new Error('Tài khoản chưa được cấp quyền hợp lệ.');
    }

    const { data: rooms, error: roomsError } = await db
      .from('hp_rooms')
      .select('id,data');

    if (roomsError) throw roomsError;

    const { data: bookings, error: bookingsError } = await db
      .from('hp_bookings')
      .select('id,data');

    if (bookingsError) throw bookingsError;

    state.rooms = (rooms || []).map(x => x.data);
    state.bookings = (bookings || []).map(x => x.data);

    // Tạo phòng mặc định nếu database chưa có phòng
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

    if (!state.me) return;

    const roomsSnapshot = state.rooms.map(room => ({
      id: room.id,
      data: room
    }));

    const bookingsSnapshot = state.bookings.map(booking => ({
      id: booking.id,
      data: booking
    }));

    syncQueue = syncQueue.then(async () => {
      // Chỉ quản lý được ghi danh sách phòng
      if (isMgr() && roomsSnapshot.length) {
        const { error } = await db
          .from('hp_rooms')
          .upsert(roomsSnapshot);

        if (error) throw error;
      }

      // Nhân viên và quản lý đều được thêm/sửa booking
      if (bookingsSnapshot.length) {
        const { error } = await db
          .from('hp_bookings')
          .upsert(bookingsSnapshot);

        if (error) throw error;
      }
    }).catch(error => {
      console.error('Supabase sync error:', error);
      toast('Lỗi đồng bộ: ' + error.message, true);
    });

    return syncQueue;
  }

  async function deleteRoomFromDatabase(roomId, bookingIds) {
    const { error: bookingError } = await db
      .from('hp_bookings')
      .delete()
      .in('id', bookingIds);

    if (bookingError) throw bookingError;

    const { error: roomError } = await db
      .from('hp_rooms')
      .delete()
      .eq('id', roomId);

    if (roomError) throw roomError;
  }

  /* ---------- LOGIN ---------- */

  async function showLogin() {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');

    if ($('#lh')) $('#lh').classList.add('hidden');

    $('#le').textContent = '';
    $('#lp').value = '';
    $('#lu').focus();
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

  function enterApp(user) {
    state.me = user;

    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');

    $('#umBtn').textContent = '👤 ' + user.email + ' ▾';

    state.date = sod(new Date());
    $('#dpick').value = dateInput(state.date);

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

  /* ---------- GRID ---------- */

  function barHtml(b, ds, de) {
    const t = effectiveTimes(b);
    const s = Math.max(t.start, ds);
    const e = Math.min(t.end, de);

    if (e <= s) return '';

    const l = (s - ds) / HOUR * HW;
    const w = Math.max((e - s) / HOUR * HW, 18);

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

    return `<div class="bk s-${b.status}${t.lateCheckin ? ' late' : ''}${t.overtime ? ' overtime' : ''}${cls}" data-id="${esc(b.id)}" style="left:${l}px;width:${w}px" title="${esc(tip)}">
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

    let h = `<div class="grid" style="width:${ROOMW + 24 * HW}px"><div class="hdr"><div class="corner"><span class="ct">Giờ</span><span class="cb">Phòng</span></div>`;

    for (let i = 0; i < 24; i++) {
      h += `<div class="hh" style="width:${HW}px">${i}h</div>`;
    }

    h += '</div>';

    if (!state.rooms.length) {
      h += '<div class="empty">Chưa có phòng nào. ' +
        (isMgr()
          ? 'Vào menu → Quản lý phòng để thêm.'
          : 'Hãy nhờ quản lý thêm phòng.') +
        '</div>';
    }

    state.rooms.forEach((r, ri) => {
      h += `<div class="row">
        <div class="rc"><b>${esc(r.name)}</b><small>${esc(r.type || '')}</small></div>
        <div class="track" data-ri="${ri}" style="width:${24 * HW}px">`;

      state.bookings
        .filter(b =>
          b.roomId === r.id &&
          effectiveTimes(b).start < de &&
          effectiveTimes(b).end > ds
        )
        .forEach(b => h += barHtml(b, ds, de));

      h += '</div></div>';
    });

    h += '<div class="nowline hidden" id="nowl"></div></div>';

    gw.innerHTML = h;
    gw.scrollLeft = sl;
    gw.scrollTop = st;

    updateNow();
    updateSummary();
  }

  function updateNow() {
    const el = $('#nowl');
    if (!el) return;

    const ds = state.date.getTime();
    const n = Date.now();

    if (n < ds || n >= ds + DAY) {
      el.classList.add('hidden');
      return;
    }

    el.classList.remove('hidden');
    el.style.left = (ROOMW + (n - ds) / HOUR * HW) + 'px';
    el.innerHTML = `<span class="nowlabel">${fmtT(n)}</span>`;
  }

  setInterval(() => {
    if (state.me) {
      updateNow();
      renderGrid();
    }
  }, 60000);

  function updateSummary() {
    const ds = state.date.getTime();
    const de = ds + DAY;

    const list = state.bookings.filter(b =>
      b.status !== 'cancel' &&
      effectiveTimes(b).start < de &&
      effectiveTimes(b).end > ds
    );

    const dep = list.reduce((s, b) => s + (+b.deposit || 0), 0);

    $('#sum').innerHTML =
      `📅 <b>${WD[state.date.getDay()]}, ${pad(state.date.getDate())}/${pad(state.date.getMonth() + 1)}/${state.date.getFullYear()}</b> · ${list.length} lượt khách · Tổng cọc: ${money(dep)}đ`;
  }

  function scrollDefault() {
    const gw = $('#gw');
    const isToday = state.date.getTime() === sod(new Date()).getTime();
    const hr = isToday ? Math.max(0, new Date().getHours() - 2) : 6;

    gw.scrollLeft = hr * HW;
  }

  function setDate(d) {
    state.date = sod(d);
    $('#dpick').value = dateInput(d);
    renderGrid();
    scrollDefault();
  }

  $('#prev').onclick = () =>
    setDate(new Date(state.date.getTime() - DAY + 12 * HOUR));

  $('#next').onclick = () =>
    setDate(new Date(state.date.getTime() + DAY + 12 * HOUR));

  $('#today').onclick = () => setDate(new Date());

  $('#dpick').onchange = e => {
    const d = parseDateInput(e.target.value);

    if (!d) {
      toast('Ngày không hợp lệ. Nhập DD/MM/YY', true);
      e.target.value = dateInput(state.date);
      return;
    }

    setDate(d);
  };

  /* ---------- CONFLICT ---------- */

  function findConflict(b) {
    const bt = effectiveTimes(b);

    return state.bookings.find(o => {
      if (
        o.id === b.id ||
        o.status === 'cancel' ||
        b.status === 'cancel' ||
        o.roomId !== b.roomId
      ) return false;

      const ot = effectiveTimes(o);

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
    const tr = e.target.closest('.track');

    if (el) {
      const b = state.bookings.find(x => x.id === el.dataset.id);
      if (!b) return;

      const mode = e.target.classList.contains('rl')
        ? 'rl'
        : e.target.classList.contains('rr')
          ? 'rr'
          : 'mv';

      const ri0 = state.rooms.findIndex(r => r.id === b.roomId);

      act = {
        type: 'bk',
        b,
        el,
        mode,
        x0: e.clientX,
        y0: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        sl0: gw.scrollLeft,
        moved: false,
        dm: 0,
        ri0,
        ri: ri0
      };

    } else if (tr) {
      act = {
        type: 'sel',
        tr,
        ri: +tr.dataset.ri,
        x0: e.clientX,
        y0: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        sl0: gw.scrollLeft,
        moved: false,
        xr0: e.clientX - tr.getBoundingClientRect().left,
        xr: 0
      };

      act.xr = act.xr0;

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
    const r = gw.getBoundingClientRect();

    if (act.lx > r.right - 40) gw.scrollLeft += 14;
    else if (act.lx < r.left + ROOMW + 30) gw.scrollLeft -= 14;
    else return;

    applyAct();
  }

  function onMoveA(e) {
    if (!act) return;

    act.lx = e.clientX;
    act.ly = e.clientY;

    if (!act.moved) {
      if (Math.hypot(e.clientX - act.x0, e.clientY - act.y0) < 5) return;

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

      const b = act.b;
      const el = act.el;
      const ds = state.date.getTime();

      if (act.mode === 'mv') {
        const tracks = gw.querySelectorAll('.track');

        if (!tracks.length) return;

        const t0 = tracks[0].getBoundingClientRect();
        const rh = tracks[0].offsetHeight;

        let ri = Math.floor((act.ly - t0.top) / rh);
        ri = Math.max(0, Math.min(tracks.length - 1, ri));

        act.ri = ri;

        el.style.transform =
          `translate(${dm / 60 * HW}px,${(ri - act.ri0) * rh}px)`;

      } else {
        let s = b.start;
        let e = b.end;

        if (act.mode === 'rl') {
          s = Math.min(b.start + dm * MIN, b.end - SNAP * MIN);
        } else {
          e = Math.max(b.end + dm * MIN, b.start + SNAP * MIN);
        }

        act.ns = s;
        act.ne = e;

        const vs = Math.max(s, ds);
        const ve = Math.min(e, ds + DAY);

        el.style.left = (vs - ds) / HOUR * HW + 'px';
        el.style.width = Math.max((ve - vs) / HOUR * HW, 18) + 'px';
      }

    } else {
      const r = act.tr.getBoundingClientRect();
      act.xr = act.lx - r.left;

      const px = SNAP / 60 * HW;

      let a = Math.min(act.xr0, act.xr);
      let b = Math.max(act.xr0, act.xr);

      a = Math.max(0, Math.floor(a / px) * px);
      b = Math.min(24 * HW, Math.max(Math.ceil(b / px) * px, a + px));

      act.sb.style.left = a + 'px';
      act.sb.style.width = (b - a) + 'px';
    }
  }

  function cleanupAct() {
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

      const b = a.b;

      let s = b.start;
      let e = b.end;
      let room = b.roomId;

      if (a.mode === 'mv') {
        s += a.dm * MIN;
        e += a.dm * MIN;
        room = state.rooms[a.ri].id;
      } else {
        s = a.ns ?? s;
        e = a.ne ?? e;
      }

      if (s === b.start && e === b.end && room === b.roomId) {
        renderGrid();
        return;
      }

      const c = findConflict({
        ...b,
        start: s,
        end: e,
        roomId: room
      });

      if (c) {
        toast(
          `Trùng lịch với ${c.name} (${roomName(c.roomId)}, ${fmtDT(c.start)} → ${fmtDT(c.end)})`,
          true
        );

        renderGrid();
        return;
      }

      b.start = s;
      b.end = e;
      b.roomId = room;
      b.updatedBy = state.me.username;

      saveAll();
      toast('Đã cập nhật lịch: ' + b.name);
      renderGrid();

    } else {
      if (a.sb) a.sb.remove();

      const pm = HW / 60;

      let sm;
      let em;

      if (!a.moved) {
        sm = Math.floor(a.xr0 / HW * 60 / SNAP) * SNAP;
        em = sm + 120;
      } else {
        const lo = Math.min(a.xr0, a.xr);
        const hi = Math.max(a.xr0, a.xr);

        sm = Math.floor(lo / pm / SNAP) * SNAP;
        em = Math.max(Math.ceil(hi / pm / SNAP) * SNAP, sm + SNAP);
      }

      sm = Math.max(0, sm);
      em = Math.min(1440, em);

      if (em <= sm) em = sm + SNAP;

      openBooking(null, {
        roomId: state.rooms[a.ri].id,
        start: ds + sm * MIN,
        end: ds + em * MIN
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

    const b = id ? state.bookings.find(x => x.id === id) : null;

    const ds = state.date.getTime();

    let defS = ds + 14 * HOUR;

    if (ds === sod(new Date()).getTime()) {
      const n = new Date();
      n.setMinutes(0, 0, 0);
      defS = n.getTime() + HOUR;
    }

    const d = b || {
      roomId: pre?.roomId || state.rooms[0].id,
      start: pre?.start ?? defS,
      end: pre?.end ?? (pre?.start ?? defS) + 2 * HOUR,
      name: '',
      phone: '',
      guests: 1,
      total: 0,
      deposit: 0,
      source: '',
      note: '',
      status: 'wait'
    };

    openModal(`<h3>${b ? 'Sửa thông tin khách' : 'Thêm khách đặt phòng'}</h3>
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
              ${Object.entries(STATUS).map(([k, v]) =>
                `<option value="${k}" ${k === d.status ? 'selected' : ''}>${v}</option>`
              ).join('')}
            </select>
          </div>

          <div>
            <label>Giờ nhận phòng dự kiến</label>
            <input type="text" id="f_start" value="${toInput(d.start)}" placeholder="DD/MM/YY HH:mm" required>
          </div>

          <div>
            <label>Giờ trả phòng dự kiến</label>
            <input type="text" id="f_end" value="${toInput(d.end)}" placeholder="DD/MM/YY HH:mm" required>
          </div>

          <div>
            <label>Giờ nhận phòng thực tế</label>
            <input type="text" id="f_actual_start" value="${b?.actualStart ? toInput(b.actualStart) : ''}" placeholder="DD/MM/YY HH:mm">
          </div>

          <div>
            <label>Giờ trả phòng thực tế</label>
            <input type="text" id="f_actual_end" value="${b?.actualEnd ? toInput(b.actualEnd) : ''}" placeholder="DD/MM/YY HH:mm">
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
            <input id="f_source" placeholder="Zalo, Facebook, Booking..." value="${esc(d.source)}">
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

        ${b ? `<div style="font-size:12px;color:var(--muted)">
          Tạo bởi ${esc(b.createdBy || '?')}
          ${b.updatedBy ? ' · sửa bởi ' + esc(b.updatedBy) : ''}
        </div>` : ''}

        <div class="mfoot">
          ${b && b.status !== 'cancel'
            ? '<button type="button" class="danger l" id="f_del">Hủy booking</button>'
            : ''}

          ${b && b.status !== 'cancel' && b.status !== 'out'
            ? '<button type="button" id="f_checkin">Nhận phòng ngay</button>'
            : ''}

          ${b && b.status === 'in'
            ? '<button type="button" class="primary" id="f_checkout">Trả phòng ngay</button>'
            : ''}

          <button type="button" id="f_cancel">Đóng</button>
          <button class="primary">Lưu</button>
        </div>
      </form>
    `);

    const rest = () => {
      $('#rest').textContent = money(
        (+$('#f_total').value || 0) -
        (+$('#f_dep').value || 0)
      );
    };

    rest();

    $('#f_total').oninput = rest;
    $('#f_dep').oninput = rest;

    $('#f_cancel').onclick = closeModal;

    if (b && b.status !== 'cancel') {
      $('#f_del').onclick = () => {
        if (!confirm('Hủy booking của khách "' + b.name + '"? Lịch sử booking sẽ được giữ lại.')) {
          return;
        }

        b.status = 'cancel';
        b.cancelledAt = Date.now();
        b.cancelledBy = state.me.username;

        saveAll();
        closeModal();
        renderGrid();
        toast('Đã hủy booking');
      };
    }

    if (b && b.status !== 'cancel' && b.status !== 'out') {
      $('#f_checkin').onclick = () => {
        if (!confirm('Xác nhận khách nhận phòng ngay?')) return;

        b.actualStart = Date.now();
        b.status = 'in';
        b.updatedBy = state.me.username;

        saveAll();
        closeModal();
        renderGrid();
        toast('Đã ghi nhận giờ nhận phòng thực tế');
      };
    }

    if (b && b.status === 'in') {
      $('#f_checkout').onclick = () => {
        if (!confirm('Xác nhận khách trả phòng ngay?')) return;

        const now = Date.now();

        b.actualEnd = now;
        b.status = 'out';
        b.updatedBy = state.me.username;

        saveAll();
        closeModal();
        renderGrid();
        toast('Đã trả phòng lúc ' + fmtDT(now));
      };
    }

    $('#bf').onsubmit = e => {
      e.preventDefault();

      const nb = {
        id: b ? b.id : uid(),
        roomId: $('#f_room').value,
        status: $('#f_status').value,
        start: fromInput($('#f_start').value),
        end: fromInput($('#f_end').value),
        name: $('#f_name').value.trim(),
        phone: $('#f_phone').value.trim(),
        guests: +$('#f_guests').value || 1,
        source: $('#f_source').value.trim(),
        total: +$('#f_total').value || 0,
        deposit: +$('#f_dep').value || 0,
        note: $('#f_note').value.trim(),
        actualStart: $('#f_actual_start').value.trim()
          ? fromInput($('#f_actual_start').value)
          : null,
        actualEnd: $('#f_actual_end').value.trim()
          ? fromInput($('#f_actual_end').value)
          : null
      };

      const err = m => {
        $('#f_err').textContent = m;
      };

      if (!nb.name) return err('Vui lòng nhập tên khách');

      if (isNaN(nb.start) || isNaN(nb.end)) {
        return err('Ngày giờ dự kiến không hợp lệ. Dùng DD/MM/YY HH:mm');
      }

      if (nb.end <= nb.start) {
        return err('Giờ trả dự kiến phải sau giờ nhận dự kiến');
      }

      if (nb.actualStart !== null && isNaN(nb.actualStart)) {
        return err('Giờ nhận thực tế không hợp lệ. Dùng DD/MM/YY HH:mm');
      }

      if (nb.actualEnd !== null && isNaN(nb.actualEnd)) {
        return err('Giờ trả thực tế không hợp lệ. Dùng DD/MM/YY HH:mm');
      }

      if (
        nb.actualStart !== null &&
        nb.actualEnd !== null &&
        nb.actualEnd <= nb.actualStart
      ) {
        return err('Giờ trả thực tế phải sau giờ nhận thực tế');
      }

      const c = findConflict(nb);

      if (c) {
        return err(
          `Trùng lịch phòng ${roomName(c.roomId)}: ${c.name} (${fmtDT(c.start)} → ${fmtDT(c.end)})`
        );
      }

      if (b) {
        Object.assign(b, nb, {
          updatedBy: state.me.username
        });
      } else {
        nb.createdBy = state.me.username;
        nb.createdAt = Date.now();
        state.bookings.push(nb);
      }

      saveAll();
      closeModal();

      if (
        nb.end <= state.date.getTime() ||
        nb.start >= state.date.getTime() + DAY
      ) {
        setDate(new Date(nb.start));
      } else {
        renderGrid();
      }

      toast('Đã lưu');
    };

    setTimeout(() => $('#f_name').focus(), 30);
  }

  $('#addBk').onclick = () => openBooking();

  /* ---------- SEARCH ---------- */

  $('#q').addEventListener('input', e => {
    const q = norm(e.target.value.trim());
    const box = $('#qres');

    if (!q) {
      box.classList.add('hidden');
      return;
    }

    const res = state.bookings
      .filter(b =>
        norm(b.name).includes(q) ||
        norm(b.phone).includes(q)
      )
      .sort((a, b) =>
        Math.abs(a.start - Date.now()) -
        Math.abs(b.start - Date.now())
      )
      .slice(0, 8);

    box.innerHTML = res.length
      ? res.map(b => `<div data-id="${esc(b.id)}">
          <b>${esc(b.name)}</b> ${esc(b.phone || '')}
          <small>${esc(roomName(b.roomId))} · ${fmtDT(b.start)} → ${fmtDT(b.end)}${b.status === 'cancel' ? ' · ĐÃ HỦY' : ''}</small>
        </div>`).join('')
      : '<div style="cursor:default">Không tìm thấy</div>';

    box.classList.remove('hidden');
  });

  $('#qres').addEventListener('click', e => {
    const it = e.target.closest('[data-id]');
    if (!it) return;

    const b = state.bookings.find(x => x.id === it.dataset.id);
    if (!b) return;

    $('#qres').classList.add('hidden');
    $('#q').value = '';

    setDate(new Date(b.start));
    openBooking(b.id);
  });

  /* ---------- USER MENU ---------- */

  $('#umBtn').onclick = e => {
    e.stopPropagation();

    const p = $('#um');

    if (!p.classList.contains('hidden')) {
      p.classList.add('hidden');
      return;
    }

    p.innerHTML = `<div class="who">
        ${esc(state.me.username)} · ${isMgr() ? 'Quản lý' : 'Nhân viên'}
      </div>

      ${isMgr() ? `
        <button data-a="rooms">🛏 Quản lý phòng</button>
        <button data-a="users">👥 Tạo tài khoản</button>
        <button data-a="export">⬇ Sao lưu dữ liệu</button>
        <button data-a="import">⬆ Khôi phục dữ liệu</button>
      ` : ''}

      <button data-a="pw">🔑 Đổi mật khẩu</button>
      <button data-a="out">🚪 Đăng xuất</button>`;

    p.classList.remove('hidden');
  };

  $('#um').onclick = e => {
    const a = e.target.dataset.a;
    if (!a) return;

    $('#um').classList.add('hidden');

    ({
      rooms: roomsModal,
      users: usersModal,
      export: exportData,
      import: () => $('#importFile').click(),
      pw: pwModal,
      out: logout
    })[a]();
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
    const draw = () => {
      mbox.innerHTML = `<h3>Quản lý phòng</h3>
        <div class="list">
          ${state.rooms.map((r, i) => `<div class="rrow">
            <input data-f="name" data-i="${i}" value="${esc(r.name)}" placeholder="Tên phòng">
            <input data-f="type" data-i="${i}" value="${esc(r.type || '')}" placeholder="Loại / ghi chú">
            <button data-up="${i}" title="Lên">↑</button>
            <button data-dn="${i}" title="Xuống">↓</button>
            <button class="danger" data-del="${i}" title="Xóa phòng">🗑</button>
          </div>`).join('') || '<div class="empty">Chưa có phòng</div>'}
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

    mbox.onchange = e => {
      const t = e.target;

      if (t.dataset.f) {
        state.rooms[+t.dataset.i][t.dataset.f] = t.value.trim();
        saveAll();
        renderGrid();
      }
    };

    mbox.onclick = async e => {
      const t = e.target.closest('button');
      if (!t) return;

      const d = t.dataset;

      if (d.done) {
        closeModal();
        return;
      }

      if (d.add) {
        const n = $('#nrn').value.trim();

        if (!n) {
          toast('Nhập tên phòng', true);
          return;
        }

        if (state.rooms.some(r => norm(r.name) === norm(n))) {
          toast('Tên phòng đã tồn tại', true);
          return;
        }

        state.rooms.push({
          id: uid(),
          name: n,
          type: $('#nrt').value.trim()
        });

      } else if (d.up !== undefined) {
        const i = +d.up;

        if (i > 0) {
          [state.rooms[i - 1], state.rooms[i]] =
            [state.rooms[i], state.rooms[i - 1]];
        }

      } else if (d.dn !== undefined) {
        const i = +d.dn;

        if (i < state.rooms.length - 1) {
          [state.rooms[i + 1], state.rooms[i]] =
            [state.rooms[i], state.rooms[i + 1]];
        }

      } else if (d.del !== undefined) {
        const index = +d.del;
        const room = state.rooms[index];

        const related = state.bookings.filter(b => b.roomId === room.id);
        const bookingIds = related.map(b => b.id);

        if (!confirm(
          `Xóa ${room.name}?` +
          (related.length
            ? `\nPhòng này có ${related.length} lượt đặt, tất cả sẽ bị xóa theo.`
            : '')
        )) return;

        try {
          await deleteRoomFromDatabase(room.id, bookingIds);

          state.bookings = state.bookings.filter(b => b.roomId !== room.id);
          state.rooms.splice(index, 1);

        } catch (error) {
          toast('Không xóa được: ' + error.message, true);
          return;
        }

      } else {
        return;
      }

      await saveAll();
      renderGrid();
      draw();
    };
  }

  /* ---------- USERS ---------- */

  
async function usersModal() {
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);

  const callAdmin = async (action, extra = {}) => {
    const { data, error } = await db.functions.invoke(
      'create-staff-user',
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

  // Tải danh sách tài khoản
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

      listBox.innerHTML = users.map(u => {
        const isMe = u.id === state.me?.id;
        const roleName = u.role === 'manager' ? 'Quản lý' : 'Nhân viên';

        return `
          <div style="
            border:1px solid var(--border,#ddd);
            border-radius:8px;
            padding:12px;
            margin-bottom:10px;
          ">
            <div style="font-weight:600;overflow-wrap:anywhere">
              ${escapeHTML(u.email)}
              ${isMe ? '<small>(Bạn)</small>' : ''}
            </div>

            <div style="margin:6px 0">
              Quyền: <strong>${roleName}</strong>
            </div>

            ${!isMe ? `
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
                <button type="button"
                  data-action="role"
                  data-id="${escapeHTML(u.id)}"
                  data-role="${escapeHTML(u.role)}">
                  Đổi quyền
                </button>

                <button type="button"
                  data-action="password"
                  data-id="${escapeHTML(u.id)}">
                  Đặt lại mật khẩu
                </button>

                <button type="button"
                  data-action="delete"
                  data-id="${escapeHTML(u.id)}"
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
      errorBox.textContent = error.message || 'Không tải được danh sách tài khoản';
    }
  }

  // Tạo tài khoản
  $('#newUserForm').onsubmit = async e => {
    e.preventDefault();

    const email = $('#newEmail').value.trim();
    const password = $('#newPassword').value;
    const role = $('#newRole').value;
    const formError = $('#newUserError');

    if (password.length < 8) {
      formError.textContent = 'Mật khẩu cần ít nhất 8 ký tự';
      return;
    }

    formError.textContent = 'Đang tạo tài khoản...';

    try {
      await callAdmin('create', { email, password, role });

      toast('Đã tạo tài khoản thành công');

      $('#newUserForm').reset();
      createArea.classList.add('hidden');

      await loadUsers();

    } catch (error) {
      console.error('Create user error:', error);
      formError.textContent = error.message || 'Không tạo được tài khoản';
    }
  };

  // Xử lý các nút trong danh sách
  listBox.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    try {
      if (action === 'role') {
        const currentRole = btn.dataset.role;
        const newRole = currentRole === 'manager' ? 'staff' : 'manager';
        const roleName = newRole === 'manager' ? 'Quản lý' : 'Nhân viên';

        if (!confirm(`Bạn muốn đổi quyền tài khoản này thành ${roleName}?`)) {
          return;
        }

        await callAdmin('update_role', { id, role: newRole });

        toast('Đã cập nhật quyền tài khoản');
        await loadUsers();
      }

      else if (action === 'password') {
        const password = prompt('Nhập mật khẩu mới (ít nhất 8 ký tự):');

        if (password === null) return;

        if (password.length < 8) {
          alert('Mật khẩu cần ít nhất 8 ký tự.');
          return;
        }

        await callAdmin('reset_password', { id, password });

        toast('Đã đặt lại mật khẩu');
      }

      else if (action === 'delete') {
        if (!confirm(
          'Bạn chắc chắn muốn xóa tài khoản này? Người dùng sẽ không thể đăng nhập nữa.'
        )) {
          return;
        }

        await callAdmin('delete', { id });

        toast('Đã xóa tài khoản');
        await loadUsers();
      }

    } catch (error) {
      console.error('Manage user error:', error);
      alert(error.message || 'Không thực hiện được thao tác');
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

      if (newPassword.length < 8) {
        $('#pe').textContent = 'Mật khẩu mới tối thiểu 8 ký tự';
        return;
      }

      if (newPassword !== $('#p2').value) {
        $('#pe').textContent = 'Nhập lại mật khẩu không khớp';
        return;
      }

      try {
        const { error: loginError } = await db.auth.signInWithPassword({
          email: state.me.email,
          password: oldPassword
        });

        if (loginError) {
          throw new Error('Mật khẩu hiện tại không đúng');
        }

        const { error } = await db.auth.updateUser({
          password: newPassword
        });

        if (error) throw error;

        closeModal();
        toast('Đã đổi mật khẩu');

      } catch (error) {
        $('#pe').textContent = error.message;
      }
    };
  }

  /* ---------- BACKUP ---------- */

  function exportData() {
    const blob = new Blob([
      JSON.stringify({
        rooms: state.rooms,
        bookings: state.bookings
      }, null, 2)
    ], { type: 'application/json' });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);

    a.download =
      'lich-dat-phong-' +
      new Date().toISOString().slice(0, 10) +
      '.json';

    a.click();

    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  $('#importFile').onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';

    if (!f) return;

    const r = new FileReader();

    r.onload = async () => {
      try {
        const j = JSON.parse(r.result);

        if (
          !Array.isArray(j.rooms) ||
          !Array.isArray(j.bookings)
        ) {
          throw new Error('File không đúng định dạng');
        }

        if (!confirm('Khôi phục sẽ thay thế dữ liệu hiện tại. Tiếp tục?')) {
          return;
        }

        state.rooms = j.rooms;
        state.bookings = j.bookings;

        await saveAll();

        renderGrid();
        toast('Đã gửi dữ liệu khôi phục lên hệ thống');

      } catch (error) {
        toast(error.message || 'File không hợp lệ', true);
      }
    };

    r.readAsText(f);
  };

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
  }

})();
