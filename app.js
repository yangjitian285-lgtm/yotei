import { firebaseConfig } from './firebase-config.js';

// ================= 起動 =================
const DEMO_FLAG = 'yotei-demo-mode';
const SOLO_FLAG = 'yotei-solo';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const hasConfig = !!firebaseConfig.apiKey;
const useDemo = !hasConfig || lsGet(DEMO_FLAG) === '1';
const B = useDemo ? await import('./backend-local.js') : await import('./backend-firebase.js');
await B.init(firebaseConfig);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ================= 小道具 =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const fmtDate = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
const isColor = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');
const COLORS = ['#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#ca8a04', '#64748b'];
const BOTH = '#6366f1';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len = 8) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map((n) => CODE_CHARS[n % 32]).join('');
}
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}
function authError(e) {
  const map = {
    'auth/invalid-email': 'メールアドレスの形式が正しくありません',
    'auth/email-already-in-use': 'このメールアドレスは登録済みです。ログインしてください',
    'auth/weak-password': 'パスワードが弱すぎます(8文字以上・英数字まぜて)',
    'auth/invalid-credential': 'メールアドレスかパスワードが違います',
    'auth/wrong-password': 'メールアドレスかパスワードが違います',
    'auth/user-not-found': 'メールアドレスかパスワードが違います',
    'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからもう一度',
    'auth/network-request-failed': 'ネットにつながっていないようです',
    'permission-denied': '権限がありません(メール確認が済んでいるか確認してください)',
  };
  return map[e?.code] || e?.message || 'エラーが発生しました';
}

// ================= 状態 =================
const S = {
  user: null, profile: null, couple: null,
  shared: [], priv: [], annivs: [], myAnnivs: [], activity: [],
  ready: { profile: false, couple: false },
  solo: lsGet(SOLO_FLAG) === '1',
  tab: 'home', month: (() => { const d = new Date(); d.setDate(1); return ymd(d); })(),
  sel: todayStr(), filter: 'all',
  invite: null, sessionSeen: null, loadedAt: Date.now(), notified: new Set(),
};
let subs = [], coupleSubs = [], coupleId = null;
const clearSubs = (arr) => { arr.forEach((u) => { try { u(); } catch {} }); arr.length = 0; };

const me = () => S.user?.uid;
const paired = () => !!S.couple;
const partner = () => S.couple?.members.find((m) => m !== me());
function prof(uid) {
  if (uid === 'both') return { name: 'ふたり', color: BOTH };
  const p = S.couple?.profiles?.[uid] || (uid === me() ? S.profile : null) || {};
  return { name: p.name || (uid === me() ? 'わたし' : '相手'), color: isColor(p.color) ? p.color : '#94a3b8' };
}

B.onAuth((user) => {
  clearSubs(subs); clearSubs(coupleSubs); coupleId = null;
  Object.assign(S, { user, profile: null, couple: null, shared: [], priv: [], annivs: [], myAnnivs: [], activity: [], ready: { profile: false, couple: false }, sessionSeen: null });
  if (!user || !user.verified) return render(true);
  subs.push(B.watchProfile(user.uid, (p) => {
    S.profile = p; S.ready.profile = true;
    if (S.sessionSeen === null && p) S.sessionSeen = p.lastSeenAt || 0;
    render();
  }));
  subs.push(B.watchPrivateEvents(user.uid, (l) => { S.priv = l; render(); }));
  subs.push(B.watchMyAnniversaries(user.uid, (l) => { S.myAnnivs = l; render(); }));
  subs.push(B.watchCouple(user.uid, (c) => {
    S.couple = c; S.ready.couple = true;
    if ((c?.id || null) !== coupleId) subscribeCouple(c);
    render();
  }));
});

function subscribeCouple(c) {
  clearSubs(coupleSubs);
  coupleId = c?.id || null;
  S.shared = []; S.annivs = []; S.activity = [];
  if (!c) return;
  if (S.invite) { B.deleteInvite?.(S.invite.code); S.invite = null; toast('共有を開始しました'); }
  coupleSubs.push(B.watchSharedEvents(c.id, (l) => { S.shared = l; render(); }));
  coupleSubs.push(B.watchAnniversaries(c.id, (l) => { S.annivs = l; render(); }));
  coupleSubs.push(B.watchActivity(c.id, (l) => { S.activity = l; onActivity(); render(); }));
}

// ================= 相手の更新のお知らせ =================
const actText = (a) => {
  const verb = { add: '追加', edit: '変更', delete: '削除' }[a.type] || '更新';
  return `${prof(a.by).name}さんが「${a.title || '予定'}」(${fmtDate(a.date)})を${verb}しました`;
};
const unseenCount = () => S.activity.filter((a) => a.by !== me() && a.at > (S.profile?.lastSeenAt || 0)).length;

function onActivity() {
  for (const a of S.activity) {
    if (a.by === me() || a.at <= S.loadedAt || S.notified.has(a.id)) continue;
    S.notified.add(a.id);
    toast(actText(a));
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
      navigator.serviceWorker?.ready.then((r) => r.showNotification('よてい', { body: actText(a), icon: 'icons/icon-192.png', tag: a.id })).catch(() => {});
    }
  }
  const n = unseenCount();
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}
let seenTimer;
function markSeen() {
  if (!unseenCount()) return;
  clearTimeout(seenTimer);
  seenTimer = setTimeout(() => B.saveProfile(me(), { lastSeenAt: Date.now() }).catch(() => {}), 1500);
}

// ================= 予定データ =================
function allEvents() {
  const privIds = new Set(S.priv.map((e) => e.id));
  return [
    ...S.shared.filter((e) => !(e.visibility === 'busy' && e.owner === me() && privIds.has(e.id))),
    ...S.priv,
  ];
}
function passFilter(e) {
  if (S.filter === 'all' || !paired()) return true;
  if (S.filter === 'me') return e.owner === me();
  if (S.filter === 'partner') return e.owner === partner();
  return e.owner === 'both';
}
function eventsOn(day, filtered = true) {
  return allEvents()
    .filter((e) => e.startDate <= day && (e.endDate || e.startDate) >= day && (!filtered || passFilter(e)))
    .sort((a, b) => (b.allDay - a.allDay) || (a.startTime || '').localeCompare(b.startTime || ''));
}
const isPartnerBusy = (e) => e.visibility === 'busy' && e.owner !== me();
const evTitle = (e) => (isPartnerBusy(e) ? '予定あり' : e.title || '(タイトルなし)');
function evTime(e) {
  const multi = e.endDate && e.endDate !== e.startDate;
  let t = e.allDay ? '終日' : [e.startTime, e.endTime].filter(Boolean).join('〜') || '時間未定';
  if (multi) t = `${fmtDate(e.startDate)}〜${fmtDate(e.endDate)} ${e.allDay ? '' : t}`;
  return t.trim();
}
const visLabel = { shared: '', busy: '予定ありのみ公開', private: '非公開' };

async function saveEvent(old, form) {
  const uid = me(), cid = S.couple?.id;
  const ev = {
    id: old?.id || B.newId(),
    title: form.title.trim().slice(0, 100), startDate: form.startDate,
    endDate: form.endDate < form.startDate ? form.startDate : form.endDate,
    allDay: !!form.allDay, startTime: form.allDay ? '' : form.startTime, endTime: form.allDay ? '' : form.endTime,
    owner: cid ? form.owner : uid,
    visibility: !cid ? 'private' : form.owner === uid ? form.visibility : 'shared',
    place: form.place.trim().slice(0, 100), note: form.note.trim().slice(0, 1000),
    createdBy: old?.createdBy || uid, updatedBy: uid, updatedAt: Date.now(),
  };
  if (!cid) return B.savePrivateEvent(uid, ev);
  const oldVis = old?.visibility;
  const tasks = [];
  if (ev.visibility === 'shared') {
    tasks.push(B.saveSharedEvent(cid, ev));
    if (oldVis === 'private' || oldVis === 'busy') tasks.push(B.deletePrivateEvent(uid, ev.id));
  } else if (ev.visibility === 'private') {
    tasks.push(B.savePrivateEvent(uid, ev));
    if (oldVis === 'shared' || oldVis === 'busy') tasks.push(B.deleteSharedEvent(cid, ev.id));
  } else {
    tasks.push(B.savePrivateEvent(uid, ev));
    tasks.push(B.saveSharedEvent(cid, { ...ev, title: '', place: '', note: '' }));
  }
  await Promise.all(tasks);
  // 相手に見える変更だけを履歴に残す(非公開の中身は書かない)
  const visibleTitle = (e) => (e.visibility === 'shared' ? e.title : '予定あり');
  if (ev.visibility !== 'private') {
    await logActivity(old ? 'edit' : 'add', visibleTitle(ev), ev.startDate);
  } else if (oldVis && oldVis !== 'private') {
    await logActivity('delete', visibleTitle(old), old.startDate);
  }
}
async function deleteEvent(ev) {
  const uid = me(), cid = S.couple?.id;
  if (cid && (ev.visibility !== 'private' || ev.owner !== uid)) await B.deleteSharedEvent(cid, ev.id);
  if (ev.visibility !== 'shared' && ev.owner === uid) await B.deletePrivateEvent(uid, ev.id);
  if (cid && ev.visibility !== 'private') await logActivity('delete', ev.visibility === 'shared' ? ev.title : '予定あり', ev.startDate);
}
function logActivity(type, title, date) {
  if (!S.couple) return Promise.resolve();
  return B.addActivity(S.couple.id, { id: B.newId(), by: me(), type, title: (title || '予定').slice(0, 100), date, at: Date.now() }).catch(() => {});
}

// ================= 記念日 =================
function allAnnivs() {
  return [
    ...S.myAnnivs.map((a) => ({ ...a, scope: 'me' })),
    ...(paired() ? S.annivs.map((a) => ({ ...a, scope: 'shared' })) : []),
  ];
}
function annivOn(day) {
  const out = [];
  const st = paired() ? S.couple.startDate : '';
  if (st && day > st) {
    const n = diffDays(st, day) + 1;
    if (n % 100 === 0) out.push({ title: `${n}日目` });
    const [sy, sm, sd] = st.split('-').map(Number);
    const [y, m, d] = day.split('-').map(Number);
    if (m === sm && d === sd && y > sy) out.push({ title: `${y - sy}周年` });
    else if (d === sd) {
      const months = (y - sy) * 12 + (m - sm);
      if (months > 0 && months % 12) out.push({ title: `${months}ヶ月` });
    }
  }
  for (const a of allAnnivs()) {
    if (a.yearly ? a.date.slice(5) === day.slice(5) && day >= a.date : a.date === day) {
      const yrs = Number(day.slice(0, 4)) - Number(a.date.slice(0, 4));
      out.push({ title: a.title + (a.yearly && yrs > 0 && !/誕生日/.test(a.title) ? `(${yrs}周年)` : ''), id: a.id });
    }
  }
  return out;
}
function upcomingAnnivs(limit = 5, days = 400) {
  const t = todayStr(), out = [];
  for (let i = 0; i <= days && out.length < limit; i++) {
    const d = addDays(t, i);
    for (const a of annivOn(d)) out.push({ ...a, date: d, inDays: i });
  }
  return out.slice(0, limit);
}

// ================= 画面描画 =================
const app = document.getElementById('app');
let lastScreen = '';
function screenName() {
  if (!S.user) return 'auth';
  if (!S.user.verified) return 'verify';
  if (!S.ready.profile || !S.ready.couple) return 'loading';
  if (!S.profile?.name) return 'profile';
  if (!S.couple && !S.solo) return 'pair';
  return 'main';
}
function render(force = false) {
  const scr = screenName();
  if (scr !== 'main' && scr === lastScreen && !force) return;
  lastScreen = scr;
  const y = window.scrollY;
  app.innerHTML = ({ auth: authView, verify: verifyView, loading: () => '<div class="center"><div class="spinner"></div></div>', profile: profileView, pair: pairView, main: mainView })[scr]();
  bind(scr);
  if (scr === 'main') window.scrollTo(0, y);
}

// ---------- ログイン ----------
let authMode = 'login';
function authView() {
  const signup = authMode === 'signup';
  return `
  <div class="auth">
    <img class="logo-img" src="icons/icon-192.png" alt="">
    <h1>よてい</h1>
    <p class="muted">シンプルなスケジュール帳。大切な人との共有もできます</p>
    <form id="authForm" class="card form">
      <label>メールアドレス<input name="email" type="email" autocomplete="email" required></label>
      <label>パスワード${signup ? '(8文字以上・英字と数字をまぜて)' : ''}
        <input name="pw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="${signup ? 8 : 6}"></label>
      ${signup ? '<label>パスワード(確認)<input name="pw2" type="password" autocomplete="new-password" required></label>' : ''}
      <p class="err" id="authErr"></p>
      <button class="btn primary" type="submit">${signup ? '新規登録' : 'ログイン'}</button>
      <button class="link" type="button" id="toggleMode">${signup ? 'アカウントをお持ちの方はこちら' : 'はじめての方は新規登録'}</button>
      ${signup ? '' : '<button class="link" type="button" id="resetPw">パスワードを忘れた</button>'}
    </form>
    <button class="link" id="tryDemo">登録せずにデモで試す</button>
  </div>`;
}
function bindAuth() {
  $('#toggleMode').onclick = () => { authMode = authMode === 'login' ? 'signup' : 'login'; render(true); };
  $('#tryDemo').onclick = () => { lsSet(DEMO_FLAG, '1'); location.reload(); };
  $('#resetPw') && ($('#resetPw').onclick = async () => {
    const email = $('#authForm').email.value.trim();
    if (!email) return ($('#authErr').textContent = 'メールアドレスを入力してから押してください');
    try { await B.resetPassword(email); toast('再設定メールを送りました'); } catch (e) { $('#authErr').textContent = authError(e); }
  });
  $('#authForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target, err = $('#authErr'), btn = f.querySelector('[type=submit]');
    const email = f.email.value.trim(), pw = f.pw.value;
    err.textContent = '';
    if (authMode === 'signup') {
      if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return (err.textContent = 'パスワードは8文字以上で、英字と数字を両方入れてください');
      if (pw !== f.pw2.value) return (err.textContent = 'パスワード(確認)が一致しません');
    }
    btn.disabled = true;
    try { authMode === 'signup' ? await B.signUp(email, pw) : await B.signIn(email, pw); }
    catch (e) { err.textContent = authError(e); btn.disabled = false; }
  };
}

// ---------- メール確認 ----------
function verifyView() {
  return `
  <div class="auth">
    <h2>メールを確認してください</h2>
    <p class="muted"><b>${esc(S.user.email)}</b> に確認メールを送りました。<br>メール内のリンクを開いてから、下のボタンを押してください。<br><small>(届かないときは迷惑メールフォルダも確認してください)</small></p>
    <button class="btn primary" id="checked">確認しました</button>
    <button class="btn" id="resend">確認メールを再送</button>
    <button class="link" id="logout">別のアカウントでログイン</button>
  </div>`;
}
function bindVerify() {
  $('#checked').onclick = async () => {
    try {
      const u = await B.reloadUser();
      if (u.verified) location.reload(); else toast('まだ確認が済んでいないようです');
    } catch (e) { toast(authError(e)); }
  };
  $('#resend').onclick = async () => { try { await B.resendVerification(); toast('再送しました'); } catch (e) { toast(authError(e)); } };
  $('#logout').onclick = () => B.signOut();
}

// ---------- プロフィール ----------
function colorPicker(name, current, avoid) {
  return `<div class="swatches">${COLORS.map((c) => `
    <label class="swatch ${c === avoid ? 'taken' : ''}" style="--c:${c}" title="${c === avoid ? '相手の色' : ''}">
      <input type="radio" name="${name}" value="${c}" ${c === current ? 'checked' : ''}><span></span></label>`).join('')}</div>`;
}
function profileView() {
  return `
  <div class="auth">
    <h2>はじめに</h2>
    <form id="profForm" class="card form">
      <label>表示名(共有したときに相手に表示されます)<input name="name" maxlength="20" required placeholder="例: ゆう"></label>
      <div class="lbl">あなたの色(カレンダーでの色分け)</div>
      ${colorPicker('color', COLORS[0])}
      <button class="btn primary" type="submit">次へ</button>
    </form>
  </div>`;
}
function bindProfile() {
  $('#profForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const name = ev.target.name.value.trim().slice(0, 20);
    if (!name) return;
    await B.saveProfile(me(), { name, color: ev.target.color.value, lastSeenAt: Date.now() }).catch((e) => toast(authError(e)));
  };
}

// ---------- 共有の設定(ペアリング) ----------
function pairView() {
  const inv = S.invite;
  const left = inv ? Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / 60000)) : 0;
  return `
  <div class="auth">
    <h2>予定を共有しますか?</h2>
    <p class="muted">恋人や家族など、1人とカレンダーを共有できます。<br>共有しなくても、ふつうのスケジュール帳として使えます。</p>
    <button class="btn primary" id="solo">ひとりで使う(あとから共有できます)</button>
    <div class="card form">
      <h3>相手を招待する</h3>
      ${inv ? `
        <div class="code" id="codeBox">${esc(inv.code.slice(0, 4))}-${esc(inv.code.slice(4))}</div>
        <p class="muted small">相手のアプリでこのコードを入力してもらってください(あと約${left}分有効)。<br>入力されると自動で共有が始まります。</p>
        <div class="row"><button class="btn" id="shareCode">コードを送る</button><button class="btn" id="cancelCode">取り消す</button></div>`
      : '<button class="btn" id="makeCode">招待コードを発行</button>'}
    </div>
    <div class="card form">
      <h3>招待コードを入力する</h3>
      <form id="joinForm">
        <input name="code" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" maxlength="9" required>
        <p class="err" id="joinErr"></p>
        <button class="btn" type="submit">共有を始める</button>
      </form>
    </div>
    <p class="muted small">コードは8文字・30分で失効・1回きりです。メッセージアプリなど相手にだけ届く方法で送ってください。</p>
    <button class="link" id="logout">ログアウト</button>
  </div>`;
}
function bindPair() {
  $('#logout').onclick = () => B.signOut();
  $('#solo').onclick = () => {
    if (S.invite) { B.deleteInvite(S.invite.code); S.invite = null; }
    S.solo = true; lsSet(SOLO_FLAG, '1'); render(true);
  };
  $('#makeCode') && ($('#makeCode').onclick = async () => {
    const code = randomCode(), expiresAt = Date.now() + 30 * 60 * 1000;
    try {
      await B.createInvite(me(), { name: S.profile.name, color: S.profile.color }, code, expiresAt);
      S.invite = { code, expiresAt };
      render(true);
    } catch (e) { toast(authError(e)); }
  });
  $('#cancelCode') && ($('#cancelCode').onclick = () => { B.deleteInvite(S.invite.code); S.invite = null; render(true); });
  $('#shareCode') && ($('#shareCode').onclick = async () => {
    const text = `「よてい」の招待コード: ${S.invite.code}(30分有効)`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(S.invite.code); toast('コピーしました'); } } catch {}
  });
  $('#joinForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('#joinErr');
    const code = ev.target.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    err.textContent = '';
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return (err.textContent = 'コードは8文字です(0・1・I・Oは使われません)');
    try {
      const inv = await B.getInvite(code);
      if (!inv) return (err.textContent = 'コードが見つかりません。もう一度確認してください');
      if (inv.expiresAt < Date.now()) return (err.textContent = 'このコードは期限切れです。新しく発行してもらってください');
      if (inv.from === me()) return (err.textContent = '自分で発行したコードは使えません');
      let color = S.profile.color;
      if (color === inv.profile.color) {
        color = COLORS.find((c) => c !== inv.profile.color);
        await B.saveProfile(me(), { color });
      }
      const members = [inv.from, me()].sort();
      await B.createCouple(members.join('_'), {
        members, inviteCode: code, startDate: '', createdAt: Date.now(),
        profiles: { [inv.from]: inv.profile, [me()]: { name: S.profile.name, color } },
      });
      B.deleteInvite(code);
    } catch (e) { err.textContent = authError(e); }
  };
}

// ---------- メイン ----------
const TABS = [['home', 'ホーム'], ['cal', 'カレンダー'], ['anniv', '記念日'], ['set', '設定']];
const TAB_ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  anniv: '<path d="M4 11h16v10H4zM2 7h20v4H2zM12 7v14M12 7c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[k]}</svg>`;

function mainView() {
  const n = unseenCount();
  const body = { home: homeView, cal: calView, anniv: annivView, set: settingsView }[S.tab]();
  return `
  ${useDemo ? '<div class="demo-bar">デモモード(この端末の中だけで動いています)</div>' : ''}
  <main class="page">${body}</main>
  ${S.tab === 'home' || S.tab === 'cal' ? '<button class="fab" id="fab" aria-label="予定を追加">＋</button>' : ''}
  <nav class="tabbar">${TABS.map(([k, l]) => `
    <button data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><span class="ti">${svg(k)}${k === 'home' && n ? `<b class="badge">${n}</b>` : ''}</span>${l}</button>`).join('')}
  </nav>`;
}
function shareLine() {
  if (!paired()) return '';
  const b = prof(partner());
  const st = S.couple.startDate;
  const days = st && st <= todayStr() ? ` ・ ${diffDays(st, todayStr()) + 1}日目` : '';
  return `<div class="share-line"><span class="dot" style="--c:${b.color}"></span>${esc(b.name)}さんと共有中${days}</div>`;
}
function evCard(e, showDate = false) {
  const o = prof(e.owner);
  const busy = isPartnerBusy(e);
  const who = paired() ? esc(o.name) : '';
  const vis = paired() && e.owner === me() && visLabel[e.visibility] ? `<em class="tag">${visLabel[e.visibility]}</em>` : '';
  const meta = [who, e.place && !busy ? esc(e.place) : ''].filter(Boolean).join(' ・ ');
  return `<button class="ev ${busy ? 'busy' : ''}" data-ev="${esc(e.id)}" style="--c:${o.color}">
    <span class="ev-time">${showDate ? fmtDate(e.startDate) + ' ' : ''}${esc(evTime(e))}</span>
    <span class="ev-title">${esc(evTitle(e))}</span>
    ${meta || vis ? `<span class="ev-meta">${meta} ${vis}</span>` : ''}
  </button>`;
}
function homeView() {
  const t = todayStr();
  const d = parseYmd(t);
  const today = eventsOn(t, false);
  const upcoming = allEvents()
    .filter((e) => e.startDate > t && e.startDate <= addDays(t, 7))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime || '').localeCompare(b.startTime || ''));
  const nextBoth = paired() ? allEvents().filter((e) => e.owner === 'both' && (e.endDate || e.startDate) >= t)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime || '').localeCompare(b.startTime || ''))[0] : null;
  const ann = upcomingAnnivs(1, 60)[0];
  const acts = S.activity.slice(0, 6);
  const seen = S.sessionSeen ?? 0;
  return `
  <div class="today-h">
    <div><div class="muted small">${d.getFullYear()}年</div><h2>${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})</h2></div>
  </div>
  ${shareLine()}
  <h3 class="sec">今日の予定</h3>
  ${today.length ? today.map((e) => evCard(e)).join('') : '<p class="muted empty-line">予定はありません</p>'}
  ${nextBoth || ann ? `<div class="grid2">
    ${nextBoth ? `<button class="card mini" data-ev="${esc(nextBoth.id)}"><div class="mini-h">次のふたりの予定</div><div class="mini-b"><b>${nextBoth.startDate <= t ? '今日' : `あと${diffDays(t, nextBoth.startDate)}日`}</b><span>${esc(nextBoth.title)}</span><small>${fmtDate(nextBoth.startDate)}</small></div></button>` : ''}
    ${ann ? `<button class="card mini" data-goto="anniv"><div class="mini-h">次の記念日</div><div class="mini-b"><b>${ann.inDays === 0 ? '今日' : `あと${ann.inDays}日`}</b><span>${esc(ann.title)}</span><small>${fmtDate(ann.date)}</small></div></button>` : ''}
  </div>` : ''}
  <h3 class="sec">これから1週間</h3>
  ${upcoming.length ? upcoming.map((e) => evCard(e, true)).join('') : '<p class="muted empty-line">予定はありません</p>'}
  ${paired() ? `
  <h3 class="sec">最近の更新</h3>
  <div class="card list">
    ${acts.length ? acts.map((a) => `<div class="act ${a.by !== me() && a.at > seen ? 'new' : ''}">
      <span class="dot" style="--c:${prof(a.by).color}"></span><span>${esc(actText(a))}</span><small>${ago(a.at)}</small></div>`).join('')
      : '<p class="muted">共有の予定を追加・変更すると、ここに表示されます</p>'}
  </div>` : ''}`;
}
function calView() {
  const first = parseYmd(S.month);
  const y = first.getFullYear(), m = first.getMonth();
  const start = new Date(y, m, 1 - first.getDay());
  const t = todayStr();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = ymd(d);
    const evs = eventsOn(ds);
    const an = annivOn(ds);
    cells.push(`<button class="cell ${d.getMonth() !== m ? 'other' : ''} ${ds === t ? 'today' : ''} ${ds === S.sel ? 'sel' : ''} w${d.getDay()}" data-day="${ds}">
      <span class="num">${d.getDate()}${an.length ? '<i class="an"></i>' : ''}</span>
      ${evs.slice(0, 3).map((e) => `<span class="bar ${isPartnerBusy(e) ? 'busy' : ''}" style="--c:${prof(e.owner).color}">${esc(evTitle(e))}</span>`).join('')}
      ${evs.length > 3 ? `<span class="more">+${evs.length - 3}</span>` : ''}
    </button>`);
    // 6行目がまるごと翌月なら5行で終える
    if (i === 34 && new Date(y, m, 1 - first.getDay() + 35).getMonth() !== m) break;
  }
  const dayEvs = eventsOn(S.sel);
  const dayAn = annivOn(S.sel);
  const chips = [['all', 'すべて'], ['me', prof(me()).name], ['partner', prof(partner()).name], ['both', 'ふたり']];
  return `
  <div class="cal-head">
    <button class="icon" id="prevM" aria-label="前の月">‹</button>
    <h2>${y}年${m + 1}月</h2>
    <button class="icon" id="nextM" aria-label="次の月">›</button>
    <button class="chip" id="goToday">今日</button>
  </div>
  ${paired() ? `<div class="chips">${chips.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-filter="${k}">${esc(l)}</button>`).join('')}</div>` : ''}
  <div class="cal">
    ${WD.map((w, i) => `<div class="wd w${i}">${w}</div>`).join('')}
    ${cells.join('')}
  </div>
  <h3 class="sec">${fmtDate(S.sel)}</h3>
  ${dayAn.map((a) => `<div class="card anniv-line">${esc(a.title)}</div>`).join('')}
  ${dayEvs.length ? dayEvs.map((e) => evCard(e)).join('') : '<p class="muted empty-line">予定はありません</p>'}
  <button class="btn" id="addOnDay">＋ この日に予定を追加</button>`;
}
function annivView() {
  const ups = upcomingAnnivs(10);
  const list = allAnnivs().sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)));
  return `
  <h2 class="title">記念日</h2>
  <p class="muted small">誕生日や記念日を登録すると、カレンダーに表示されてカウントダウンできます。</p>
  <h3 class="sec">これからの記念日</h3>
  <div class="card list">
    ${ups.length ? ups.map((a) => `<div class="act"><span>${esc(a.title)}<br><small>${a.date.slice(0, 4)}年 ${fmtDate(a.date)}</small></span><b class="days">${a.inDays ? `あと${a.inDays}日` : '今日'}</b></div>`).join('') : '<p class="muted">まだ登録がありません</p>'}
  </div>
  <h3 class="sec">登録した記念日 <button class="chip" id="addAnniv">＋ 追加</button></h3>
  <div class="card list">
    ${list.length ? list.map((a) => `
      <button class="act" data-anniv="${esc(a.id)}" data-scope="${a.scope}"><span>${esc(a.title)}<br><small>${esc(a.date)}${a.yearly ? '(毎年)' : ''}${paired() ? (a.scope === 'shared' ? ' ・ 共有' : ' ・ 自分のみ') : ''}</small></span><small>編集</small></button>`).join('')
      : '<p class="muted">誕生日・結婚記念日・交際記念日など</p>'}
  </div>
  ${paired() ? `
  <h3 class="sec">ふたりの記念日</h3>
  <div class="card form">
    <label>はじまりの日(交際開始日・結婚記念日など)<input type="date" id="startDate" value="${esc(S.couple.startDate || '')}"></label>
    <p class="muted small">設定すると「◯日目」を表示し、100日ごと・毎月・毎年の節目を自動で数えます。不要なら空欄のままで大丈夫です。</p>
  </div>` : ''}`;
}
function settingsView() {
  const a = prof(me());
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const b = paired() ? prof(partner()) : null;
  return `
  <h2 class="title">設定</h2>
  <div class="card list">
    <div class="act"><span class="dot" style="--c:${a.color}"></span><span><b>${esc(a.name)}</b>${useDemo ? '' : `<br><small>${esc(S.user.email)}</small>`}</span><button class="chip" id="editProf">変更</button></div>
  </div>

  <h3 class="sec">共有</h3>
  <div class="card form">
    ${b ? `<p><span class="dot" style="--c:${b.color}"></span> <b>${esc(b.name)}</b>さんと共有中</p>
      <p class="muted small">予定ごとに公開範囲を選べます。</p>
      <ul class="small">
        <li><b>共有</b>:相手も内容を見られる・編集できる</li>
        <li><b>予定ありのみ</b>:相手には時間帯と「予定あり」だけ表示</li>
        <li><b>非公開</b>:相手には表示されない</li>
      </ul>`
    : `<p class="small">恋人や家族など1人とカレンダーを共有できます。</p><button class="btn" id="startShare">共有を設定する</button>`}
  </div>

  ${b ? `<h3 class="sec">通知</h3>
  <div class="card form">
    ${perm === 'granted' ? '<p class="small">通知はオンです</p>' : perm === 'unsupported' ? '<p class="muted small">この環境は通知に未対応です。iPhoneはホーム画面に追加したアプリから設定できます。</p>' : '<button class="btn" id="askNotif">通知をオンにする</button>'}
    <p class="muted small">相手が共有の予定を変更すると、ホームの「最近の更新」とアイコンのバッジでお知らせします。アプリを閉じている間のプッシュ通知はありません(無料構成のため)。</p>
  </div>` : ''}

  ${standalone ? '' : `<h3 class="sec">ホーム画面に追加(iPhone)</h3>
  <div class="card form small"><ol><li>Safariでこのページを開く</li><li>共有ボタン(□↑)をタップ</li><li>「ホーム画面に追加」を選ぶ</li></ol></div>`}

  <h3 class="sec">アカウント</h3>
  <div class="card form">
    ${useDemo ? `
      ${b ? '<button class="btn" id="simPartner">デモ: 相手が予定を追加したことにする</button>' : ''}
      <button class="btn" id="resetDemo">デモデータをリセット</button>
      ${hasConfig ? '<button class="btn" id="exitDemo">デモを終了してログイン画面へ</button>' : '<p class="muted small">Firebaseを設定すると本番モードになります(README.md参照)。</p>'}
    ` : '<button class="btn" id="logout">ログアウト</button>'}
    ${b ? `<button class="btn danger" id="unpair">共有をやめる</button>
      <p class="muted small">共有をやめると、共有の予定・記念日・履歴はサーバーから削除されます(非公開の予定は残ります)。</p>` : ''}
  </div>
  <p class="muted small center-text">よてい v1.1 ・ データはメール確認済みの本人と共有相手しか読めないよう保護されています</p>`;
}

// ---------- イベント割り当て ----------
function bind(scr) {
  if (scr === 'auth') return bindAuth();
  if (scr === 'verify') return bindVerify();
  if (scr === 'profile') return bindProfile();
  if (scr === 'pair') return bindPair();
  if (scr !== 'main') return;

  $$('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; window.scrollTo(0, 0); render(); }));
  $$('[data-goto]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.goto; window.scrollTo(0, 0); render(); }));
  $$('[data-ev]').forEach((b) => (b.onclick = () => {
    const e = allEvents().find((x) => x.id === b.dataset.ev);
    if (e) openEventModal(e);
  }));
  $('#fab') && ($('#fab').onclick = () => openEventModal(null, S.tab === 'cal' ? S.sel : todayStr()));

  if (S.tab === 'home') markSeen();
  if (S.tab === 'cal') {
    const shift = (n) => { const d = parseYmd(S.month); d.setMonth(d.getMonth() + n); S.month = ymd(d); render(); };
    $('#prevM').onclick = () => shift(-1);
    $('#nextM').onclick = () => shift(1);
    $('#goToday').onclick = () => { S.sel = todayStr(); const d = new Date(); d.setDate(1); S.month = ymd(d); render(); };
    $$('[data-filter]').forEach((b) => (b.onclick = () => { S.filter = b.dataset.filter; render(); }));
    $$('[data-day]').forEach((b) => (b.onclick = () => {
      if (S.sel === b.dataset.day) return openEventModal(null, S.sel);
      S.sel = b.dataset.day;
      if (S.sel.slice(0, 7) !== S.month.slice(0, 7)) S.month = S.sel.slice(0, 8) + '01';
      render();
    }));
    $('#addOnDay').onclick = () => openEventModal(null, S.sel);
    // 左右スワイプで月を移動
    const cal = $('.cal');
    let sx = null;
    cal.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
    cal.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
    });
  }
  if (S.tab === 'anniv') {
    $('#startDate') && ($('#startDate').onchange = (e) => B.updateCouple(S.couple.id, { startDate: e.target.value || '' }).catch((er) => toast(authError(er))));
    $('#addAnniv').onclick = () => openAnnivModal(null);
    $$('[data-anniv]').forEach((b) => (b.onclick = () => openAnnivModal(allAnnivs().find((a) => a.id === b.dataset.anniv && a.scope === b.dataset.scope))));
  }
  if (S.tab === 'set') {
    $('#editProf').onclick = openProfileModal;
    $('#startShare') && ($('#startShare').onclick = () => { S.solo = false; lsSet(SOLO_FLAG, null); render(true); });
    $('#askNotif') && ($('#askNotif').onclick = async () => {
      try { await Notification.requestPermission(); } catch {}
      render();
    });
    $('#logout') && ($('#logout').onclick = () => { if (confirm('ログアウトしますか?')) B.signOut(); });
    $('#unpair') && ($('#unpair').onclick = async () => {
      if (!confirm('共有をやめますか?\n共有の予定・記念日・履歴はすべて削除され、元に戻せません。')) return;
      S.solo = true; lsSet(SOLO_FLAG, '1');
      try {
        await B.unpair(S.couple.id);
        toast('共有をやめました');
      } catch (e) { S.solo = false; lsSet(SOLO_FLAG, null); toast(authError(e)); }
      render(true);
    });
    $('#simPartner') && ($('#simPartner').onclick = () => { B.simulatePartner(); });
    $('#resetDemo') && ($('#resetDemo').onclick = () => { if (confirm('デモデータを最初の状態に戻しますか?')) { B.resetDemo(); toast('リセットしました'); } });
    $('#exitDemo') && ($('#exitDemo').onclick = () => { lsSet(DEMO_FLAG, null); location.reload(); });
  }
}

// ================= モーダル =================
const modalRoot = document.getElementById('modal');
function openModal(html, onBind) {
  modalRoot.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  modalRoot.classList.add('open');
  document.body.classList.add('noscroll');
  $('.sheet-bg', modalRoot).onclick = closeModal;
  $$('[data-close]', modalRoot).forEach((b) => (b.onclick = closeModal));
  onBind?.($('.sheet', modalRoot));
}
function closeModal() {
  modalRoot.classList.remove('open');
  modalRoot.innerHTML = '';
  document.body.classList.remove('noscroll');
}

function openEventModal(ev, date) {
  if (ev && isPartnerBusy(ev)) {
    const o = prof(ev.owner);
    return openModal(`
      <div class="sheet-h"><button class="link" data-close>閉じる</button><b>予定あり</b><span></span></div>
      <div class="form">
        <p><span class="dot" style="--c:${o.color}"></span> ${esc(o.name)}さんの予定</p>
        <p class="big">${fmtDate(ev.startDate)} ${esc(evTime(ev))}</p>
        <p class="muted small">${esc(o.name)}さんは内容を非公開にしています。</p>
      </div>`);
  }
  const uid = me(), pid = partner();
  const e = ev || { title: '', startDate: date, endDate: date, allDay: false, startTime: '', endTime: '', owner: uid, visibility: 'shared', place: '', note: '' };
  const owners = [[uid, prof(uid).name], ['both', 'ふたり'], [pid, prof(pid).name]];
  const edited = paired() && ev && ev.updatedBy ? `<p class="muted small">最終更新: ${esc(prof(ev.updatedBy).name)}・${ago(ev.updatedAt)}</p>` : '';
  openModal(`
    <form id="evForm">
      <div class="sheet-h"><button type="button" class="link" data-close>キャンセル</button><b>${ev ? '予定を編集' : '予定を追加'}</b><button class="link strong" type="submit">保存</button></div>
      <div class="form">
        <input name="title" placeholder="タイトル" maxlength="100" value="${esc(e.title)}" required>
        ${paired() ? `<div class="lbl">だれの予定?</div>
        <div class="seg">${owners.map(([v, l]) => `<label style="--c:${prof(v).color}"><input type="radio" name="owner" value="${esc(v)}" ${e.owner === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>` : `<input type="hidden" name="owner" value="${esc(uid)}">`}
        <div class="row2">
          <label>開始日<input type="date" name="startDate" value="${esc(e.startDate)}" required></label>
          <label>終了日<input type="date" name="endDate" value="${esc(e.endDate || e.startDate)}" required></label>
        </div>
        <label class="check"><input type="checkbox" name="allDay" ${e.allDay ? 'checked' : ''}> 終日</label>
        <div class="row2 times">
          <label>開始<input type="time" name="startTime" value="${esc(e.startTime)}"></label>
          <label>終了<input type="time" name="endTime" value="${esc(e.endTime)}"></label>
        </div>
        <input name="place" placeholder="場所(任意)" maxlength="100" value="${esc(e.place)}">
        <textarea name="note" placeholder="メモ(任意)" maxlength="1000" rows="3">${esc(e.note)}</textarea>
        ${paired() ? `<div class="vis">
          <div class="lbl">相手への公開範囲</div>
          <div class="seg">
            <label><input type="radio" name="visibility" value="shared" ${e.visibility === 'shared' ? 'checked' : ''}><span>共有</span></label>
            <label><input type="radio" name="visibility" value="busy" ${e.visibility === 'busy' ? 'checked' : ''}><span>予定ありのみ</span></label>
            <label><input type="radio" name="visibility" value="private" ${e.visibility === 'private' ? 'checked' : ''}><span>非公開</span></label>
          </div>
          <p class="muted small vis-help"></p>
        </div>` : '<input type="hidden" name="visibility" value="private">'}
        ${edited}
        ${ev ? '<button type="button" class="btn danger" id="delEv">この予定を削除</button>' : ''}
      </div>
    </form>`, (root) => {
    const f = $('#evForm', root);
    const help = {
      shared: '相手もこの予定を見たり編集したりできます。',
      busy: '相手には時間帯と「予定あり」だけ表示されます。',
      private: '相手には表示されません。',
    };
    const val = (name) => (f.querySelector(`[name=${name}]:checked`) || f.querySelector(`[name=${name}]`))?.value;
    const sync = () => {
      if ($('.vis', root)) {
        $('.vis', root).style.display = val('owner') === uid ? '' : 'none';
        $('.vis-help', root).textContent = help[val('visibility')] || '';
      }
      $('.times', root).style.display = f.allDay.checked ? 'none' : '';
      if (f.endDate.value < f.startDate.value) f.endDate.value = f.startDate.value;
    };
    f.addEventListener('change', sync);
    f.startDate.addEventListener('change', () => { if (!ev || f.endDate.value < f.startDate.value) f.endDate.value = f.startDate.value; sync(); });
    sync();
    if (!ev) setTimeout(() => f.title.focus(), 250);
    f.onsubmit = async (x) => {
      x.preventDefault();
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await saveEvent(ev, {
          title: f.title.value, owner: val('owner'), startDate: f.startDate.value, endDate: f.endDate.value,
          allDay: f.allDay.checked, startTime: f.startTime.value, endTime: f.endTime.value,
          place: f.place.value, note: f.note.value, visibility: val('visibility'),
        });
        closeModal(); toast('保存しました');
      } catch (er) { toast(authError(er)); btn.disabled = false; }
    };
    $('#delEv', root) && ($('#delEv', root).onclick = async () => {
      if (!confirm('この予定を削除しますか?')) return;
      try { await deleteEvent(ev); closeModal(); toast('削除しました'); } catch (er) { toast(authError(er)); }
    });
  });
}

function openAnnivModal(a) {
  const x = a || { title: '', date: todayStr(), yearly: true, scope: paired() ? 'shared' : 'me' };
  openModal(`
    <form id="anForm">
      <div class="sheet-h"><button type="button" class="link" data-close>キャンセル</button><b>${a ? '記念日を編集' : '記念日を追加'}</b><button class="link strong" type="submit">保存</button></div>
      <div class="form">
        <input name="title" placeholder="例: 母の誕生日 / 結婚記念日" maxlength="50" value="${esc(x.title)}" required>
        <label>日付<input type="date" name="date" value="${esc(x.date)}" required></label>
        <label class="check"><input type="checkbox" name="yearly" ${x.yearly ? 'checked' : ''}> 毎年くり返す</label>
        ${paired() && !a ? '<label class="check"><input type="checkbox" name="share" checked> 相手と共有する</label>' : ''}
        ${a ? '<button type="button" class="btn danger" id="delAn">削除</button>' : ''}
      </div>
    </form>`, (root) => {
    const f = $('#anForm', root);
    const scope = a ? a.scope : (paired() && f.share?.checked !== false ? 'shared' : 'me');
    const saveFn = (s) => (s === 'shared' ? (d) => B.saveAnniversary(S.couple.id, d) : (d) => B.saveMyAnniversary(me(), d));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const s = a ? a.scope : (paired() && f.share?.checked ? 'shared' : 'me');
      try {
        await saveFn(s)({ id: a?.id || B.newId(), title: f.title.value.trim().slice(0, 50), date: f.date.value, yearly: f.yearly.checked });
        closeModal(); toast('保存しました');
      } catch (er) { toast(authError(er)); }
    };
    $('#delAn', root) && ($('#delAn', root).onclick = async () => {
      if (!confirm('削除しますか?')) return;
      const del = scope === 'shared' ? B.deleteAnniversary(S.couple.id, a.id) : B.deleteMyAnniversary(me(), a.id);
      await del.catch((er) => toast(authError(er)));
      closeModal();
    });
  });
}

function openProfileModal() {
  const p = prof(me());
  const avoid = paired() ? prof(partner()).color : null;
  openModal(`
    <form id="pfForm">
      <div class="sheet-h"><button type="button" class="link" data-close>キャンセル</button><b>プロフィール</b><button class="link strong" type="submit">保存</button></div>
      <div class="form">
        <label>表示名<input name="name" maxlength="20" value="${esc(p.name)}" required></label>
        <div class="lbl">あなたの色</div>
        ${colorPicker('color', p.color, avoid)}
      </div>
    </form>`, (root) => {
    $('#pfForm', root).onsubmit = async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim().slice(0, 20), color = e.target.color.value;
      if (avoid && color === avoid) return toast('相手と同じ色は選べません');
      try {
        await B.saveProfile(me(), { name, color });
        if (paired()) await B.updateCouple(S.couple.id, { [`profiles.${me()}`]: { name, color } });
        closeModal(); toast('保存しました');
      } catch (er) { toast(authError(er)); }
    };
  });
}

// 画面に戻ってきたとき(日付が変わった等)に描き直す
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
render(true);
