// Logic ứng dụng hiện tại, được tách khỏi HTML để dễ bảo trì.

(async function(){

// SUPABASE CONNECTION
const SUPABASE_URL = 'https://abrfitfcfgtcmuplwenl.supabase.co/rest/v1/';
const SUPABASE_KEY = 'sb_publishable_9cKAWzanSjSKeYY108j9rw_PZJeTG6U';

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const HW=64, ROOMW=124, SNAP=30;
const HOUR=36e5, MIN=6e4, DAY=864e5;
const LS={users:'hp_users',rooms:'hp_rooms',bookings:'hp_bookings',session:'hp_session'};
const STATUS={wait:'Giữ chỗ (chưa cọc)',dep:'Đã cọc',in:'Đang ở',out:'Đã trả phòng',cancel:'Đã hủy'};
const effectiveTimes=b=>{const now=Date.now();let start=b.start,end=b.end;if(b.status==='cancel')end=b.cancelledAt||b.end;else if(b.status==='out')end=b.actualEnd||b.end;else if(b.status==='in'){start=b.actualStart||b.start;if(now>end)end=now;}return {start,end,now,lateCheckin:(b.status==='wait'||b.status==='dep')&&!b.actualStart&&now>b.start,overtime:b.status==='in'&&now>b.end};};
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const pad=n=>String(n).padStart(2,'0');
const money=n=>(Number(n)||0).toLocaleString('vi-VN');
const ld=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v??d}catch(e){return d}};
const sv=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const sod=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x};
const toInput=ts=>{if(!ts)return '';const d=new Date(ts);return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`};
const fromInput=v=>{const m=String(v||'').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);if(!m)return NaN;const dd=+m[1],mm=+m[2],yy=2000+(+m[3]),hh=+m[4],mi=+m[5],d=new Date(yy,mm-1,dd,hh,mi);return d.getFullYear()===yy&&d.getMonth()===mm-1&&d.getDate()===dd&&hh<24&&mi<60?d.getTime():NaN};
const dateStr=d=>`${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)}`;
const dateInput=d=>dateStr(d);
const parseDateInput=v=>{const m=String(v||'').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);if(!m)return null;const yy=2000+(+m[3]),mm=+m[2],dd=+m[1],d=new Date(yy,mm-1,dd);return d.getFullYear()===yy&&d.getMonth()===mm-1&&d.getDate()===dd?d:null};
const fmtT=ts=>{const d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes())};
const fmtDT=ts=>{const d=new Date(ts);return fmtT(ts)+' '+pad(d.getDate())+'/'+pad(d.getMonth()+1)};
const WD=['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');

async function hashPw(u,p){
  const s='hp|'+u.toLowerCase()+'|'+p;
  try{ if(window.crypto&&crypto.subtle){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')} }catch(e){}
  let h=5381;for(const c of s)h=((h<<5)+h+c.charCodeAt(0))|0;return 'x'+(h>>>0).toString(16);
}

const state={users:ld(LS.users,[]),rooms:ld(LS.rooms,null),bookings:ld(LS.bookings,[]),me:null,date:sod(new Date())};
if(!state.users.length){
  state.users=[
    {username:'admin',hash:await hashPw('admin','admin123'),role:'manager'},
    {username:'nhanvien',hash:await hashPw('nhanvien','123456'),role:'staff'}];
  sv(LS.users,state.users);
}
if(!state.rooms){
  state.rooms=['101','102','103','104','105'].map(n=>({id:uid(),name:'Phòng '+n,type:''}));
  sv(LS.rooms,state.rooms);
}
const saveAll=()=>{sv(LS.users,state.users);sv(LS.rooms,state.rooms);sv(LS.bookings,state.bookings)};

let toastT;
function toast(msg,bad){const t=$('#toast');t.textContent=msg;t.className='show'+(bad?' bad':'');clearTimeout(toastT);toastT=setTimeout(()=>t.className='',2600)}


/* ---------- Login - Supabase ---------- */

async function showLogin(){
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#lh').classList.add('hidden');
  $('#le').textContent='';
  $('#lu').focus();
}

async function loadUserData(user){
  // Lấy thông tin quyền của tài khoản
  const { data: profile, error: profileError } = await db
    .from('hp_profiles')
    .select('id,email,role')
    .eq('id', user.id)
    .single();

  if(profileError || !profile){
    throw new Error('Không tìm thấy hồ sơ phân quyền. Hãy kiểm tra hp_profiles.');
  }

  // Tải danh sách phòng
  const { data: rooms, error: roomsError } = await db
    .from('hp_rooms')
    .select('id,data');

  if(roomsError) throw roomsError;

  // Tải danh sách đặt phòng
  const { data: bookings, error: bookingsError } = await db
    .from('hp_bookings')
    .select('id,data');

  if(bookingsError) throw bookingsError;

  state.rooms = (rooms || []).map(x => x.data);
  state.bookings = (bookings || []).map(x => x.data);

  return {
    id: profile.id,
    email: profile.email,
    username: profile.email,
    role: profile.role
  };
}

$('#lf').addEventListener('submit', async e=>{
  e.preventDefault();

  const email = $('#lu').value.trim();
  const password = $('#lp').value;

  $('#le').textContent = 'Đang đăng nhập...';

  try{
    const { data, error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if(error) throw error;

    const user = await loadUserData(data.user);

    $('#le').textContent = '';
    $('#lp').value = '';

    enterApp(user);

  }catch(error){
    console.error('Login error:', error);

    $('#le').textContent =
      error.message || 'Đăng nhập thất bại. Vui lòng thử lại.';

    await db.auth.signOut();
  }
});

function enterApp(user){
  state.me = user;

  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');

  $('#umBtn').textContent = '👤 ' + user.email + ' ▾';

  state.date = sod(new Date());
  $('#dpick').value = dateInput(state.date);

  renderGrid();
  scrollDefault();
}

async function logout(){
  await db.auth.signOut();
  state.me = null;
  showLogin();
}

const isMgr = () => state.me && state.me.role === 'manager';


/* ---------- Grid ---------- */
function barHtml(b,ds,de){
  const t=effectiveTimes(b);
  const s=Math.max(t.start,ds),e=Math.min(t.end,de);
  if(e<=s)return '';
  const l=(s-ds)/HOUR*HW,w=Math.max((e-s)/HOUR*HW,18);
  const cls=(t.start<ds?' cl':'')+(t.end>de?' cr':'');
  const actual=`\\nThực tế: ${b.actualStart?fmtDT(b.actualStart):'Chưa nhận'} → ${b.actualEnd?fmtDT(b.actualEnd):'Chưa trả'}`;
  const statusText=t.lateCheckin?`⚠ TRỄ HẸN ${fmtLate(t.now-b.start)}`:t.overtime?`⚠ QUÁ GIỜ TRẢ ${fmtLate(t.now-b.end)}`:STATUS[b.status]||'';
  const tip=`${b.name} ${b.phone||''}\\n${fmtDT(b.start)} → ${fmtDT(b.end)}${actual}\\nTrạng thái: ${statusText}\\nCọc: ${money(b.deposit)}đ${b.note?'\\n'+b.note:''}`;
  return `<div class="bk s-${b.status}${t.lateCheckin?' late':''}${t.overtime?' overtime':''}${cls}" data-id="${b.id}" style="left:${l}px;width:${w}px" title="${esc(tip)}">
    <i class="rh rl"></i><div><b>${esc(b.name)}</b> ${esc(b.phone||'')}</div>
    <div class="bs">${fmtT(t.start)}–${fmtT(t.end)}${b.deposit?' · cọc '+money(b.deposit):''}</div>
    ${(t.lateCheckin||t.overtime)?`<div class="alerttxt">${esc(statusText)}</div>`:''}<i class="rh rr"></i></div>`;
}
function fmtLate(ms){const m=Math.max(0,Math.floor(ms/MIN));const h=Math.floor(m/60),r=m%60;return h?`${h} giờ ${r} phút`:`${r} phút`;}

function renderGrid(){
  const gw=$('#gw');const sl=gw.scrollLeft,st=gw.scrollTop;
  const ds=state.date.getTime(),de=ds+DAY;
  let h=`<div class="grid" style="width:${ROOMW+24*HW}px"><div class="hdr"><div class="corner"><span class="ct">Giờ</span><span class="cb">Phòng</span></div>`;
  for(let i=0;i<24;i++)h+=`<div class="hh" style="width:${HW}px">${i}h</div>`;
  h+='</div>';
  if(!state.rooms.length)h+='<div class="empty">Chưa có phòng nào. '+(isMgr()?'Vào menu tài khoản → Quản lý phòng để thêm.':'Hãy nhờ quản lý thêm phòng.')+'</div>';
  state.rooms.forEach((r,ri)=>{
    h+=`<div class="row"><div class="rc"><b>${esc(r.name)}</b><small>${esc(r.type||'')}</small></div><div class="track" data-ri="${ri}" style="width:${24*HW}px">`;
    state.bookings.filter(b=>b.roomId===r.id&&effectiveTimes(b).start<de&&effectiveTimes(b).end>ds).forEach(b=>h+=barHtml(b,ds,de));
    h+='</div></div>';
  });
  h+='<div class="nowline hidden" id="nowl"></div></div>';
  gw.innerHTML=h;gw.scrollLeft=sl;gw.scrollTop=st;
  updateNow();updateSummary();
}
function updateNow(){
  const el=$('#nowl');if(!el)return;
  const ds=state.date.getTime(),n=Date.now();
  if(n<ds||n>=ds+DAY){el.classList.add('hidden');return}
  el.classList.remove('hidden');el.style.left=(ROOMW+(n-ds)/HOUR*HW)+'px';el.innerHTML=`<span class="nowlabel">${fmtT(n)}</span>`;
}
setInterval(()=>{updateNow();renderGrid();},60000);
function updateSummary(){
  const ds=state.date.getTime(),de=ds+DAY;
  const list=state.bookings.filter(b=>b.status!=='cancel'&&effectiveTimes(b).start<de&&effectiveTimes(b).end>ds);
  const dep=list.reduce((s,b)=>s+(+b.deposit||0),0);
  $('#sum').innerHTML=`📅 <b>${WD[state.date.getDay()]}, ${pad(state.date.getDate())}/${pad(state.date.getMonth()+1)}/${state.date.getFullYear()}</b> · ${list.length} lượt khách · Tổng cọc: ${money(dep)}đ`;
}
function scrollDefault(){
  const gw=$('#gw');const isToday=state.date.getTime()===sod(new Date()).getTime();
  const hr=isToday?Math.max(0,new Date().getHours()-2):6;
  gw.scrollLeft=hr*HW;
}
function setDate(d){state.date=sod(d);$('#dpick').value=dateInput(state.date);renderGrid();scrollDefault()}
$('#prev').onclick=()=>setDate(new Date(state.date.getTime()-DAY+12*HOUR));
$('#next').onclick=()=>setDate(new Date(state.date.getTime()+DAY+12*HOUR));
$('#today').onclick=()=>setDate(new Date());
$('#dpick').onchange=e=>{const d=parseDateInput(e.target.value);if(!d){toast('Ngày không hợp lệ. Nhập DD/MM/YY',true);e.target.value=dateInput(state.date);return}setDate(d)};

/* ---------- Conflict ---------- */
function findConflict(b){
  const bt=effectiveTimes(b);return state.bookings.find(o=>{if(o.id===b.id||o.status==='cancel'||b.status==='cancel'||o.roomId!==b.roomId)return false;const ot=effectiveTimes(o);return bt.start<ot.end&&bt.end>ot.start;});
}
const roomName=id=>(state.rooms.find(r=>r.id===id)||{}).name||'?';

/* ---------- Drag / resize / select ---------- */
let act=null;
$('#gw').addEventListener('pointerdown',e=>{
  if(e.button!==0||act)return;
  const gw=$('#gw');
  const el=e.target.closest('.bk'),tr=e.target.closest('.track');
  if(el){
    const b=state.bookings.find(x=>x.id===el.dataset.id);if(!b)return;
    const mode=e.target.classList.contains('rl')?'rl':e.target.classList.contains('rr')?'rr':'mv';
    const ri0=state.rooms.findIndex(r=>r.id===b.roomId);
    act={type:'bk',b,el,mode,x0:e.clientX,y0:e.clientY,lx:e.clientX,ly:e.clientY,sl0:gw.scrollLeft,moved:false,dm:0,ri0,ri:ri0};
  }else if(tr){
    act={type:'sel',tr,ri:+tr.dataset.ri,x0:e.clientX,y0:e.clientY,lx:e.clientX,ly:e.clientY,sl0:gw.scrollLeft,moved:false,xr0:e.clientX-tr.getBoundingClientRect().left,xr:0};
    act.xr=act.xr0;
  }else return;
  act.timer=setInterval(autoScroll,30);
  window.addEventListener('pointermove',onMoveA);
  window.addEventListener('pointerup',onUpA);
  window.addEventListener('pointercancel',onCancelA);
  if(e.pointerType==='mouse')e.preventDefault();
});
function autoScroll(){
  if(!act||!act.moved)return;
  const gw=$('#gw'),r=gw.getBoundingClientRect();
  if(act.lx>r.right-40)gw.scrollLeft+=14;
  else if(act.lx<r.left+ROOMW+30)gw.scrollLeft-=14;
  else return;
  applyAct();
}
function onMoveA(e){
  if(!act)return;
  act.lx=e.clientX;act.ly=e.clientY;
  if(!act.moved){
    if(Math.hypot(e.clientX-act.x0,e.clientY-act.y0)<5)return;
    act.moved=true;
    if(act.type==='bk')act.el.classList.add('dragging');
    else{act.sb=document.createElement('div');act.sb.className='selbox';act.tr.appendChild(act.sb)}
  }
  applyAct();
}
function applyAct(){
  const gw=$('#gw');
  const dx=act.lx-act.x0+(gw.scrollLeft-act.sl0);
  if(act.type==='bk'){
    const dm=Math.round(dx/HW*60/SNAP)*SNAP;act.dm=dm;
    const b=act.b,el=act.el,ds=state.date.getTime(),de=ds+DAY;
    if(act.mode==='mv'){
      const tracks=gw.querySelectorAll('.track');
      const t0=tracks[0].getBoundingClientRect(),rh=tracks[0].offsetHeight;
      let ri=Math.floor((act.ly-t0.top)/rh);ri=Math.max(0,Math.min(tracks.length-1,ri));act.ri=ri;
      el.style.transform=`translate(${dm/60*HW}px,${(ri-act.ri0)*rh}px)`;
    }else{
      let s=b.start,e=b.end;
      if(act.mode==='rl')s=Math.min(b.start+dm*MIN,b.end-SNAP*MIN);else e=Math.max(b.end+dm*MIN,b.start+SNAP*MIN);
      act.ns=s;act.ne=e;
      const vs=Math.max(s,ds),ve=Math.min(e,de);
      el.style.left=(vs-ds)/HOUR*HW+'px';el.style.width=Math.max((ve-vs)/HOUR*HW,18)+'px';
    }
  }else{
    const r=act.tr.getBoundingClientRect();
    act.xr=act.lx-r.left;
    const px=SNAP/60*HW;
    let a=Math.min(act.xr0,act.xr),b=Math.max(act.xr0,act.xr);
    a=Math.max(0,Math.floor(a/px)*px);b=Math.min(24*HW,Math.max(Math.ceil(b/px)*px,a+px));
    act.sb.style.left=a+'px';act.sb.style.width=(b-a)+'px';
  }
}
function cleanupAct(){
  clearInterval(act.timer);
  window.removeEventListener('pointermove',onMoveA);
  window.removeEventListener('pointerup',onUpA);
  window.removeEventListener('pointercancel',onCancelA);
}
function onCancelA(){if(!act)return;cleanupAct();act=null;renderGrid()}
function onUpA(){
  if(!act)return;
  cleanupAct();const a=act;act=null;
  const ds=state.date.getTime();
  if(a.type==='bk'){
    if(!a.moved){openBooking(a.b.id);return}
    const b=a.b;let s=b.start,e=b.end,room=b.roomId;
    if(a.mode==='mv'){s+=a.dm*MIN;e+=a.dm*MIN;room=state.rooms[a.ri].id}
    else{s=a.ns??s;e=a.ne??e}
    if(s===b.start&&e===b.end&&room===b.roomId){renderGrid();return}
    const c=findConflict({...b,start:s,end:e,roomId:room});
    if(c){toast(`Trùng lịch với ${c.name} (${roomName(c.roomId)}, ${fmtDT(c.start)} → ${fmtDT(c.end)})`,true);renderGrid();return}
    b.start=s;b.end=e;b.roomId=room;b.updatedBy=state.me.username;
    saveAll();toast('Đã cập nhật lịch: '+b.name);renderGrid();
  }else{
    a.sb&&a.sb.remove();
    const pm=HW/60;let sm,em;
    if(!a.moved){sm=Math.floor(a.xr0/HW*60/SNAP)*SNAP;em=sm+120}
    else{
      const lo=Math.min(a.xr0,a.xr),hi=Math.max(a.xr0,a.xr);
      sm=Math.floor(lo/pm/SNAP)*SNAP;em=Math.max(Math.ceil(hi/pm/SNAP)*SNAP,sm+SNAP);
    }
    sm=Math.max(0,sm);em=Math.min(1440,em);if(em<=sm)em=sm+SNAP;
    openBooking(null,{roomId:state.rooms[a.ri].id,start:ds+sm*MIN,end:ds+em*MIN});
  }
}

/* ---------- Modal helpers ---------- */
const modal=$('#modal'),mbox=$('#mbox');
function openModal(html){mbox.onclick=null;mbox.onchange=null;mbox.innerHTML=html;modal.classList.remove('hidden')}
function closeModal(){modal.classList.add('hidden');mbox.innerHTML='';mbox.onclick=null;mbox.onchange=null}
modal.addEventListener('mousedown',e=>{if(e.target===modal)closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.classList.contains('hidden'))closeModal()});

/* ---------- Booking modal ---------- */
function openBooking(id,pre){
  if(!state.rooms.length){toast('Chưa có phòng. '+(isMgr()?'Hãy thêm phòng trước.':'Hãy nhờ quản lý thêm phòng.'),true);return}
  const b=id?state.bookings.find(x=>x.id===id):null;
  let ds=state.date.getTime(),defS=ds+14*HOUR;
  if(ds===sod(new Date()).getTime()){const n=new Date();n.setMinutes(0,0,0);defS=n.getTime()+HOUR}
  const d=b||{roomId:pre?.roomId||state.rooms[0].id,start:pre?.start??defS,end:pre?.end??(pre?.start??defS)+2*HOUR,
    name:'',phone:'',guests:1,total:0,deposit:0,source:'',note:'',status:'wait'};
  openModal(`<h3>${b?'Sửa thông tin khách':'Thêm khách đặt phòng'}</h3>
  <form id="bf"><div class="g2">
   <div><label>Phòng</label><select id="f_room">${state.rooms.map(r=>`<option value="${r.id}" ${r.id===d.roomId?'selected':''}>${esc(r.name)}</option>`).join('')}</select></div>
   <div><label>Trạng thái</label><select id="f_status">${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${k===d.status?'selected':''}>${v}</option>`).join('')}</select></div>
   <div><label>Giờ nhận phòng dự kiến</label><input type="text" id="f_start" value="${toInput(d.start)}" placeholder="DD/MM/YY HH:mm" required></div>
   <div><label>Giờ trả phòng dự kiến</label><input type="text" id="f_end" value="${toInput(d.end)}" placeholder="DD/MM/YY HH:mm" required></div>
   <div><label>Giờ nhận phòng thực tế</label><input type="text" id="f_actual_start" value="${b?.actualStart?toInput(b.actualStart):''}" placeholder="DD/MM/YY HH:mm"></div>
   <div><label>Giờ trả phòng thực tế</label><input type="text" id="f_actual_end" value="${b?.actualEnd?toInput(b.actualEnd):''}" placeholder="DD/MM/YY HH:mm"></div>
   <div><label>Tên khách *</label><input id="f_name" value="${esc(d.name)}" required></div>
   <div><label>Số điện thoại</label><input id="f_phone" type="tel" value="${esc(d.phone)}"></div>
   <div><label>Số khách</label><input id="f_guests" type="number" min="1" value="${d.guests||1}"></div>
   <div><label>Nguồn khách</label><input id="f_source" placeholder="Zalo, Facebook, Booking..." value="${esc(d.source)}"></div>
   <div><label>Tổng tiền (đ)</label><input id="f_total" type="number" min="0" step="1000" value="${d.total||0}"></div>
   <div><label>Tiền cọc (đ)</label><input id="f_dep" type="number" min="0" step="1000" value="${d.deposit||0}"></div>
   <div class="full rest">Còn lại phải thu: <span id="rest"></span>đ</div>
   <div class="full"><small style="color:var(--muted)">Định dạng ngày DD/MM/YY · Giờ 24h HH:mm. Giờ đặt và giờ thực tế được lưu riêng; có thể chỉnh giờ thực tế khi cần.</small></div><div class="full"><label>Ghi chú</label><textarea id="f_note" rows="2">${esc(d.note)}</textarea></div>
  </div>
  <div class="err" id="f_err"></div>
  ${b?`<div style="font-size:12px;color:var(--muted)">Tạo bởi ${esc(b.createdBy||'?')}${b.updatedBy?' · sửa bởi '+esc(b.updatedBy):''}</div>`:''}
  <div class="mfoot">${b&&b.status!=='cancel'?'<button type="button" class="danger l" id="f_del">Hủy booking</button>':''}${b&&b.status!=='cancel'&&b.status!=='out'?'<button type="button" id="f_checkin">Nhận phòng ngay</button>':''}${b&&b.status==='in'?'<button type="button" class="primary" id="f_checkout">Trả phòng ngay</button>':''}<button type="button" id="f_cancel">Đóng</button><button class="primary">Lưu</button></div></form>`);
  const rest=()=>{$('#rest').textContent=money((+$('#f_total').value||0)-(+$('#f_dep').value||0))};
  rest();$('#f_total').oninput=rest;$('#f_dep').oninput=rest;
  $('#f_cancel').onclick=closeModal;
  if(b&&b.status!=='cancel')$('#f_del').onclick=()=>{
    if(!confirm('Hủy booking của khách "'+b.name+'"? Lịch sử booking sẽ được giữ lại.'))return;
    b.status='cancel';b.cancelledAt=Date.now();b.cancelledBy=state.me.username;
    saveAll();closeModal();renderGrid();toast('Đã hủy booking');
  };
  if(b&&b.status!=='cancel'&&b.status!=='out')$('#f_checkin').onclick=()=>{
    if(!confirm('Xác nhận khách nhận phòng ngay?'))return;
    b.actualStart=Date.now();b.status='in';b.updatedBy=state.me.username;saveAll();closeModal();renderGrid();toast('Đã ghi nhận giờ nhận phòng thực tế');
  };
  if(b&&b.status==='in')$('#f_checkout').onclick=()=>{
    if(!confirm('Xác nhận khách trả phòng ngay? Giờ trả thực tế sẽ được ghi nhận, giờ đặt ban đầu được giữ nguyên.'))return;
    const now=Date.now();b.actualEnd=now;b.status='out';b.updatedBy=state.me.username;saveAll();closeModal();renderGrid();toast('Đã trả phòng lúc '+fmtDT(now));
  };
  $('#bf').onsubmit=e=>{
    e.preventDefault();
    const nb={id:b?b.id:uid(),roomId:$('#f_room').value,status:$('#f_status').value,
      start:fromInput($('#f_start').value),end:fromInput($('#f_end').value),
      name:$('#f_name').value.trim(),phone:$('#f_phone').value.trim(),guests:+$('#f_guests').value||1,
      source:$('#f_source').value.trim(),total:+$('#f_total').value||0,deposit:+$('#f_dep').value||0,note:$('#f_note').value.trim(),actualStart:$('#f_actual_start').value.trim()?fromInput($('#f_actual_start').value):null,actualEnd:$('#f_actual_end').value.trim()?fromInput($('#f_actual_end').value):null};
    const err=m=>{$('#f_err').textContent=m};
    if(!nb.name)return err('Vui lòng nhập tên khách');
    if(isNaN(nb.start)||isNaN(nb.end))return err('Ngày giờ dự kiến không hợp lệ. Dùng DD/MM/YY HH:mm');
    if(nb.end<=nb.start)return err('Giờ trả dự kiến phải sau giờ nhận dự kiến');
    if(nb.actualStart!==null&&isNaN(nb.actualStart))return err('Giờ nhận thực tế không hợp lệ. Dùng DD/MM/YY HH:mm');
    if(nb.actualEnd!==null&&isNaN(nb.actualEnd))return err('Giờ trả thực tế không hợp lệ. Dùng DD/MM/YY HH:mm');
    if(nb.actualStart!==null&&nb.actualEnd!==null&&nb.actualEnd<=nb.actualStart)return err('Giờ trả thực tế phải sau giờ nhận thực tế');
    const c=findConflict(nb);
    if(c)return err(`Trùng lịch phòng ${roomName(c.roomId)}: ${c.name} (${fmtDT(c.start)} → ${fmtDT(c.end)})`);
    if(b){Object.assign(b,nb,{updatedBy:state.me.username})}
    else{nb.createdBy=state.me.username;nb.createdAt=Date.now();state.bookings.push(nb)}
    saveAll();closeModal();
    if(nb.end<=state.date.getTime()||nb.start>=state.date.getTime()+DAY){setDate(new Date(nb.start))}else renderGrid();
    toast('Đã lưu');
  };
  setTimeout(()=>$('#f_name').focus(),30);
}
$('#addBk').onclick=()=>openBooking();

/* ---------- Search ---------- */
$('#q').addEventListener('input',e=>{
  const q=norm(e.target.value.trim()),box=$('#qres');
  if(!q){box.classList.add('hidden');return}
  const res=state.bookings.filter(b=>norm(b.name).includes(q)||norm(b.phone).includes(q))
    .sort((a,b)=>Math.abs(a.start-Date.now())-Math.abs(b.start-Date.now())).slice(0,8);
  box.innerHTML=res.length?res.map(b=>`<div data-id="${b.id}"><b>${esc(b.name)}</b> ${esc(b.phone||'')}<small>${esc(roomName(b.roomId))} · ${fmtDT(b.start)} → ${fmtDT(b.end)}${b.status==='cancel'?' · ĐÃ HỦY':''}</small></div>`).join(''):'<div style="cursor:default">Không tìm thấy</div>';
  box.classList.remove('hidden');
});
$('#qres').addEventListener('click',e=>{
  const it=e.target.closest('[data-id]');if(!it)return;
  const b=state.bookings.find(x=>x.id===it.dataset.id);if(!b)return;
  $('#qres').classList.add('hidden');$('#q').value='';
  setDate(new Date(b.start));openBooking(b.id);
});

/* ---------- User menu ---------- */
$('#umBtn').onclick=e=>{
  e.stopPropagation();const p=$('#um');
  if(!p.classList.contains('hidden')){p.classList.add('hidden');return}
  p.innerHTML=`<div class="who">${esc(state.me.username)} · ${isMgr()?'Quản lý':'Nhân viên'}</div>
   ${isMgr()?`<button data-a="rooms">🛏 Quản lý phòng</button><button data-a="users">👥 Quản lý tài khoản</button><button data-a="export">⬇ Sao lưu dữ liệu</button><button data-a="import">⬆ Khôi phục dữ liệu</button>`:''}
   <button data-a="pw">🔑 Đổi mật khẩu</button><button data-a="out">🚪 Đăng xuất</button>`;
  p.classList.remove('hidden');
};
$('#um').onclick=e=>{
  const a=e.target.dataset.a;if(!a)return;$('#um').classList.add('hidden');
  ({rooms:roomsModal,users:usersModal,export:exportData,import:()=>$('#importFile').click(),pw:pwModal,out:logout})[a]();
};
document.addEventListener('click',e=>{
  if(!e.target.closest('.usermenu'))$('#um').classList.add('hidden');
  if(!e.target.closest('.search'))$('#qres').classList.add('hidden');
});

/* ---------- Rooms ---------- */
function roomsModal(){
  const draw=()=>{
    mbox.innerHTML=`<h3>Quản lý phòng</h3><div class="list">${state.rooms.map((r,i)=>`<div class="rrow">
      <input data-f="name" data-i="${i}" value="${esc(r.name)}" placeholder="Tên phòng"><input data-f="type" data-i="${i}" value="${esc(r.type||'')}" placeholder="Loại / ghi chú">
      <button data-up="${i}" title="Lên">↑</button><button data-dn="${i}" title="Xuống">↓</button><button class="danger" data-del="${i}" title="Xóa phòng">🗑</button></div>`).join('')||'<div class="empty">Chưa có phòng</div>'}</div>
      <div class="rrow"><input id="nrn" placeholder="Tên phòng mới (vd: Phòng 106)"><input id="nrt" placeholder="Loại phòng"><button class="primary" data-add="1">+ Thêm</button></div>
      <div class="mfoot"><button class="primary" data-done="1">Xong</button></div>`;
  };
  openModal('');draw();
  mbox.onchange=e=>{const t=e.target;if(t.dataset.f){state.rooms[+t.dataset.i][t.dataset.f]=t.value.trim();saveAll();renderGrid()}};
  mbox.onclick=e=>{
    const t=e.target.closest('button');if(!t)return;const d=t.dataset;
    if(d.done){closeModal();return}
    if(d.add){
      const n=$('#nrn').value.trim();if(!n){toast('Nhập tên phòng',true);return}
      if(state.rooms.some(r=>norm(r.name)===norm(n))){toast('Tên phòng đã tồn tại',true);return}
      state.rooms.push({id:uid(),name:n,type:$('#nrt').value.trim()});
    }else if(d.up!==undefined){const i=+d.up;if(i>0)[state.rooms[i-1],state.rooms[i]]=[state.rooms[i],state.rooms[i-1]]}
    else if(d.dn!==undefined){const i=+d.dn;if(i<state.rooms.length-1)[state.rooms[i+1],state.rooms[i]]=[state.rooms[i],state.rooms[i+1]]}
    else if(d.del!==undefined){
      const r=state.rooms[+d.del],n=state.bookings.filter(b=>b.roomId===r.id).length;
      if(!confirm(`Xóa ${r.name}?`+(n?`\nPhòng này có ${n} lượt đặt, tất cả sẽ bị xóa theo.`:'')))return;
      state.bookings=state.bookings.filter(b=>b.roomId!==r.id);state.rooms.splice(+d.del,1);
    }else return;
    saveAll();renderGrid();draw();
  };
}

/* ---------- Users ---------- */
function usersModal(){
  const draw=()=>{
    mbox.innerHTML=`<h3>Quản lý tài khoản</h3><div class="list">${state.users.map(u=>`<div class="urow"><span><b>${esc(u.username)}</b> <span class="tag">${u.role==='manager'?'Quản lý':'Nhân viên'}</span></span>
      <button data-reset="${esc(u.username)}">Đặt lại MK</button>${u.username===state.me.username?'':`<button class="danger" data-del="${esc(u.username)}">Xóa</button>`}</div>`).join('')}</div>
      <div class="g3" style="margin-top:8px"><div><label>Tài khoản mới</label><input id="nu"></div><div><label>Mật khẩu</label><input id="np" type="text"></div>
      <div><label>Quyền</label><select id="nr"><option value="staff">Nhân viên</option><option value="manager">Quản lý</option></select></div></div>
      <div class="mfoot"><button class="primary" data-add="1">+ Tạo tài khoản</button><button data-done="1">Đóng</button></div>`;
  };
  openModal('');draw();
  mbox.onclick=async e=>{
    const t=e.target.closest('button');if(!t)return;const d=t.dataset;
    if(d.done){closeModal();return}
    if(d.add){
      const u=$('#nu').value.trim(),p=$('#np').value;
      if(!u||p.length<4){toast('Nhập tên tài khoản và mật khẩu (từ 4 ký tự)',true);return}
      if(state.users.some(x=>x.username.toLowerCase()===u.toLowerCase())){toast('Tài khoản đã tồn tại',true);return}
      state.users.push({username:u,hash:await hashPw(u,p),role:$('#nr').value});toast('Đã tạo tài khoản');
    }else if(d.del){
      if(!confirm('Xóa tài khoản '+d.del+'?'))return;state.users=state.users.filter(x=>x.username!==d.del);
    }else if(d.reset){
      const p=prompt('Mật khẩu mới cho '+d.reset+' (từ 4 ký tự):');if(!p)return;
      if(p.length<4){toast('Mật khẩu quá ngắn',true);return}
      const u=state.users.find(x=>x.username===d.reset);u.hash=await hashPw(u.username,p);toast('Đã đặt lại mật khẩu');
    }else return;
    saveAll();draw();
  };
}
function pwModal(){
  openModal(`<h3>Đổi mật khẩu</h3><form id="pf"><div class="g2"><div class="full"><label>Mật khẩu hiện tại</label><input id="p0" type="password" required></div>
    <div><label>Mật khẩu mới</label><input id="p1" type="password" required></div><div><label>Nhập lại</label><input id="p2" type="password" required></div></div>
    <div class="err" id="pe"></div><div class="mfoot"><button type="button" id="pc">Hủy</button><button class="primary">Đổi</button></div></form>`);
  $('#pc').onclick=closeModal;
  $('#pf').onsubmit=async e=>{
    e.preventDefault();
    if(state.me.hash!==await hashPw(state.me.username,$('#p0').value))return $('#pe').textContent='Mật khẩu hiện tại không đúng';
    if($('#p1').value.length<4)return $('#pe').textContent='Mật khẩu mới tối thiểu 4 ký tự';
    if($('#p1').value!==$('#p2').value)return $('#pe').textContent='Nhập lại không khớp';
    state.me.hash=await hashPw(state.me.username,$('#p1').value);saveAll();closeModal();toast('Đã đổi mật khẩu');
  };
}

/* ---------- Backup ---------- */
function exportData(){
  const blob=new Blob([JSON.stringify({users:state.users,rooms:state.rooms,bookings:state.bookings},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lich-dat-phong-'+new Date().getFullYear()+'-'+pad(new Date().getMonth()+1)+'-'+pad(new Date().getDate())+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
$('#importFile').onchange=e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const j=JSON.parse(r.result);
      if(!Array.isArray(j.rooms)||!Array.isArray(j.bookings)||!Array.isArray(j.users))throw 0;
      if(!confirm('Khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại. Tiếp tục?'))return;
      state.users=j.users;state.rooms=j.rooms;state.bookings=j.bookings;saveAll();
      const me=state.users.find(u=>u.username===state.me.username);
      if(!me||me.role!=='manager'){logout();return}
      state.me=me;renderGrid();toast('Đã khôi phục dữ liệu');
    }catch(err){toast('File không hợp lệ',true)}
  };
  r.readAsText(f);
};

/* ---------- Start ---------- */
const ses=ld(LS.session,null);
const su=ses&&state.users.find(u=>u.username===ses.u);
if(su)enterApp(su);else showLogin();
})();
