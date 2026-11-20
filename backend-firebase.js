// Firebase(無料の Spark プラン)を使うバックエンド
const V = '10.12.2';
const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const A = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const F = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);

let auth, db;
export const isDemo = false;

export async function init(config) {
  const app = initializeApp(config);
  auth = A.getAuth(app);
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache() });
  } catch {
    db = F.getFirestore(app);
  }
}

const clean = (o) => JSON.parse(JSON.stringify(o)); // undefined を除去
const list = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));
const warn = (e) => console.warn('[yotei]', e?.code || e);

// ---------- 認証 ----------
const toUser = (u) => (u ? { uid: u.uid, email: u.email, verified: u.emailVerified } : null);
export function onAuth(cb) {
  return A.onAuthStateChanged(auth, (u) => cb(toUser(u)));
}
export async function signUp(email, pw) {
  const cred = await A.createUserWithEmailAndPassword(auth, email, pw);
  await A.sendEmailVerification(cred.user);
}
export const signIn = (email, pw) => A.signInWithEmailAndPassword(auth, email, pw);
export const signOut = () => A.signOut(auth);
export const resetPassword = (email) => A.sendPasswordResetEmail(auth, email);
export const resendVerification = () => A.sendEmailVerification(auth.currentUser);
export async function reloadUser() {
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true); // メール確認済みの状態をルールに反映
  return toUser(auth.currentUser);
}

// ---------- プロフィール ----------
export function watchProfile(uid, cb) {
  return F.onSnapshot(F.doc(db, 'users', uid), (s) => cb(s.exists() ? s.data() : null), (e) => { warn(e); cb(null); });
}
export const saveProfile = (uid, data) => F.setDoc(F.doc(db, 'users', uid), clean(data), { merge: true });

// ---------- ペア ----------
export function watchCouple(uid, cb) {
  const q = F.query(F.collection(db, 'couples'), F.where('members', 'array-contains', uid));
  return F.onSnapshot(q, (s) => cb(s.empty ? null : { ...s.docs[0].data(), id: s.docs[0].id }), (e) => { warn(e); cb(null); });
}
export const updateCouple = (cid, data) => F.updateDoc(F.doc(db, 'couples', cid), clean(data));

export async function createInvite(uid, profile, code, expiresAt) {
  await F.setDoc(F.doc(db, 'invites', code), { from: uid, profile, createdAt: Date.now(), expiresAt });
}
export async function getInvite(code) {
  const s = await F.getDoc(F.doc(db, 'invites', code));
  return s.exists() ? s.data() : null;
}
export async function createCouple(cid, data) {
  await F.setDoc(F.doc(db, 'couples', cid), clean(data));
}
export const deleteInvite = (code) => F.deleteDoc(F.doc(db, 'invites', code)).catch(warn);

export async function unpair(cid) {
  for (const sub of ['events', 'anniversaries', 'activity']) {
    const s = await F.getDocs(F.collection(db, 'couples', cid, sub));
    let batch = F.writeBatch(db), n = 0;
    for (const d of s.docs) {
      batch.delete(d.ref);
      if (++n % 400 === 0) { await batch.commit(); batch = F.writeBatch(db); }
    }
    await batch.commit();
  }
  await F.deleteDoc(F.doc(db, 'couples', cid));
}

// ---------- 予定 ----------
export function watchSharedEvents(cid, cb) {
  return F.onSnapshot(F.collection(db, 'couples', cid, 'events'), (s) => cb(list(s)), warn);
}
export function watchPrivateEvents(uid, cb) {
  return F.onSnapshot(F.collection(db, 'users', uid, 'events'), (s) => cb(list(s)), warn);
}
export const saveSharedEvent = (cid, ev) => F.setDoc(F.doc(db, 'couples', cid, 'events', ev.id), clean(ev));
export const deleteSharedEvent = (cid, id) => F.deleteDoc(F.doc(db, 'couples', cid, 'events', id));
export const savePrivateEvent = (uid, ev) => F.setDoc(F.doc(db, 'users', uid, 'events', ev.id), clean(ev));
export const deletePrivateEvent = (uid, id) => F.deleteDoc(F.doc(db, 'users', uid, 'events', id));

// ---------- 記念日 ----------
export function watchAnniversaries(cid, cb) {
  return F.onSnapshot(F.collection(db, 'couples', cid, 'anniversaries'), (s) => cb(list(s)), warn);
}
export const saveAnniversary = (cid, a) => F.setDoc(F.doc(db, 'couples', cid, 'anniversaries', a.id), clean(a));
export const deleteAnniversary = (cid, id) => F.deleteDoc(F.doc(db, 'couples', cid, 'anniversaries', id));

// よく使う予定(テンプレート)。本人だけが読み書きできる
export function watchTemplates(uid, cb) {
  return F.onSnapshot(F.collection(db, 'users', uid, 'templates'), (s) => cb(list(s)), warn);
}
export const saveTemplate = (uid, t) => F.setDoc(F.doc(db, 'users', uid, 'templates', t.id), clean(t));
export const deleteTemplate = (uid, id) => F.deleteDoc(F.doc(db, 'users', uid, 'templates', id));

// 自分だけの記念日(共有していないとき・共有しない記念日)
export function watchMyAnniversaries(uid, cb) {
  return F.onSnapshot(F.collection(db, 'users', uid, 'anniversaries'), (s) => cb(list(s)), warn);
}
export const saveMyAnniversary = (uid, a) => F.setDoc(F.doc(db, 'users', uid, 'anniversaries', a.id), clean(a));
export const deleteMyAnniversary = (uid, id) => F.deleteDoc(F.doc(db, 'users', uid, 'anniversaries', id));

// ---------- 更新履歴(相手への通知) ----------
export function watchActivity(cid, cb) {
  const q = F.query(F.collection(db, 'couples', cid, 'activity'), F.orderBy('at', 'desc'), F.limit(30));
  return F.onSnapshot(q, (s) => cb(list(s)), warn);
}
export const addActivity = (cid, a) => F.setDoc(F.doc(db, 'couples', cid, 'activity', a.id), clean(a));

export function newId() {
  return F.doc(F.collection(db, '_')).id;
}
