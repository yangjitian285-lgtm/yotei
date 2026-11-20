// デモモード用のバックエンド(この端末の中だけで動く。サーバー不要)
export const isDemo = true;
const KEY = 'yotei-demo-db-v2';
const ME = 'demo-me';
const PARTNER = 'demo-partner';
const CID = 'demo-me_demo-partner';

let db;
const watchers = new Set();
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rel = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const nextSat = () => { const d = new Date(); const add = (6 - d.getDay() + 7) % 7 || 7; return rel(add); };

let idc = 0;
export const newId = () => Date.now().toString(36) + (idc++).toString(36) + Math.random().toString(36).slice(2, 6);

function ev(o) {
  return {
    id: newId(), title: '', startDate: rel(0), endDate: o.startDate || rel(0), allDay: false,
    startTime: '', endTime: '', owner: ME, visibility: 'shared', place: '', note: '',
    createdBy: o.owner === 'both' ? ME : (o.owner || ME), updatedBy: o.owner === PARTNER ? PARTNER : ME,
    updatedAt: Date.now() - 3600e3, ...o,
  };
}

function seed() {
  const now = Date.now();
  const d = { users: {}, priv: { [ME]: {} }, couples: {}, shared: { [CID]: {} }, annivs: { [CID]: {} }, myannivs: { [ME]: {} }, activity: { [CID]: {} } };
  d.users[ME] = { name: 'わたし', color: '#3b82f6', lastSeenAt: now - 2 * 3600e3 };
  d.couples[CID] = {
    id: CID, members: [ME, PARTNER], startDate: '', createdAt: now,
    profiles: { [ME]: { name: 'わたし', color: '#3b82f6' }, [PARTNER]: { name: 'はると', color: '#f97316' } },
  };
  const sat = nextSat();
  const shared = [
    ev({ title: '水族館', startDate: sat, endDate: sat, startTime: '13:00', endTime: '18:00', owner: 'both', place: '駅前で待ち合わせ' }),
    ev({ title: 'バイト', startDate: rel(1), endDate: rel(1), startTime: '17:00', endTime: '22:00', owner: PARTNER, updatedAt: now - 3600e3 }),
    ev({ title: '', startDate: rel(2), endDate: rel(2), startTime: '19:00', endTime: '21:00', owner: PARTNER, visibility: 'busy' }),
    ev({ title: '歯医者', startDate: rel(3), endDate: rel(3), startTime: '10:00', endTime: '11:00', owner: ME }),
    ev({ title: '旅行(箱根)', startDate: rel(14), endDate: rel(15), allDay: true, owner: 'both', note: '宿は予約済み' }),
    ev({ title: 'ミーティング', startDate: rel(0), endDate: rel(0), startTime: '10:00', endTime: '11:00', owner: ME }),
  ];
  for (const e of shared) d.shared[CID][e.id] = e;
  const p = ev({ title: '買い物', startDate: rel(5), endDate: rel(5), startTime: '12:00', endTime: '14:00', visibility: 'private' });
  d.priv[ME][p.id] = p;
  const a = { id: newId(), title: 'はるとの誕生日', date: `2001-${rel(40).slice(5)}`, yearly: true };
  d.annivs[CID][a.id] = a;
  const m = { id: newId(), title: '母の誕生日', date: `1970-${rel(20).slice(5)}`, yearly: true };
  d.myannivs[ME][m.id] = m;
  const act = { id: newId(), by: PARTNER, type: 'add', title: 'バイト', date: rel(1), at: now - 3600e3 };
  d.activity[CID][act.id] = act;
  return d;
}

function load() {
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || !db.users) db = seed();
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 保存できない環境でも動かす */ }
}
function watch(compute, cb) {
  const w = { compute, cb };
  watchers.add(w);
  queueMicrotask(() => watchers.has(w) && cb(clone(compute())));
  return () => watchers.delete(w);
}
function emit() {
  persist();
  for (const w of watchers) w.cb(clone(w.compute()));
}
function setPath(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = val;
}

export async function init() { load(); persist(); }

export function onAuth(cb) {
  queueMicrotask(() => cb({ uid: ME, email: 'demo@example.com', verified: true }));
  return () => {};
}
export async function signOut() {}

export const watchProfile = (uid, cb) => watch(() => db.users[uid] || null, cb);
export async function saveProfile(uid, data) { db.users[uid] = { ...(db.users[uid] || {}), ...clone(data) }; emit(); }

export const watchCouple = (uid, cb) => watch(() => Object.values(db.couples).find((c) => c.members.includes(uid)) || null, cb);
export async function updateCouple(cid, data) {
  for (const [k, v] of Object.entries(clone(data))) setPath(db.couples[cid], k, v);
  emit();
}
export async function unpair(cid) {
  for (const k of ['couples', 'shared', 'annivs', 'activity']) delete db[k][cid];
  emit();
}

const coll = (name, id) => ((db[name] ??= {})[id] ??= {});
export const watchSharedEvents = (cid, cb) => watch(() => Object.values(coll('shared', cid)), cb);
export const watchPrivateEvents = (uid, cb) => watch(() => Object.values(coll('priv', uid)), cb);
export async function saveSharedEvent(cid, e) { coll('shared', cid)[e.id] = clone(e); emit(); }
export async function deleteSharedEvent(cid, id) { delete coll('shared', cid)[id]; emit(); }
export async function savePrivateEvent(uid, e) { coll('priv', uid)[e.id] = clone(e); emit(); }
export async function deletePrivateEvent(uid, id) { delete coll('priv', uid)[id]; emit(); }

export const watchAnniversaries = (cid, cb) => watch(() => Object.values(coll('annivs', cid)), cb);
export async function saveAnniversary(cid, a) { coll('annivs', cid)[a.id] = clone(a); emit(); }
export async function deleteAnniversary(cid, id) { delete coll('annivs', cid)[id]; emit(); }

export const watchMyAnniversaries = (uid, cb) => watch(() => Object.values(coll('myannivs', uid)), cb);
export async function saveMyAnniversary(uid, a) { coll('myannivs', uid)[a.id] = clone(a); emit(); }
export async function deleteMyAnniversary(uid, id) { delete coll('myannivs', uid)[id]; emit(); }

export const watchActivity = (cid, cb) =>
  watch(() => Object.values(coll('activity', cid)).sort((a, b) => b.at - a.at).slice(0, 30), cb);
export async function addActivity(cid, a) { coll('activity', cid)[a.id] = clone(a); emit(); }

export const watchTemplates = (uid, cb) => watch(() => Object.values(coll('templates', uid)), cb);
export async function saveTemplate(uid, t) { coll('templates', uid)[t.id] = clone(t); emit(); }
export async function deleteTemplate(uid, id) { delete coll('templates', uid)[id]; emit(); }

// ---- デモ専用 ----
export function resetDemo() { db = seed(); emit(); }
export function simulatePartner() {
  const ideas = [
    ['飲み会', 'shared', '19:00', '23:00'], ['美容院', 'shared', '11:00', '13:00'],
    ['', 'busy', '18:00', '20:00'], ['実家に帰る', 'shared', '', ''],
  ];
  const [title, visibility, s, e] = ideas[Math.floor(Math.random() * ideas.length)];
  const day = rel(1 + Math.floor(Math.random() * 10));
  const x = ev({ title, visibility, startDate: day, endDate: day, startTime: s, endTime: e, allDay: !s, owner: PARTNER, updatedAt: Date.now() });
  coll('shared', CID)[x.id] = x;
  const act = { id: newId(), by: PARTNER, type: 'add', title: visibility === 'busy' ? '予定あり' : title, date: day, at: Date.now() };
  coll('activity', CID)[act.id] = act;
  emit();
}
