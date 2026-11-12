import { firebaseConfig, VAPID_KEY, FB_VERSION } from "./config.js";
const CDN = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
const { initializeApp } = await import(`${CDN}/firebase-app.js`);
const A = await import(`${CDN}/firebase-auth.js`);
const F = await import(`${CDN}/firebase-firestore.js`);

// On an iPhone home-screen app, sign-in uses a redirect and works best through the hosting domain
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const cfg = { ...firebaseConfig };
if (isIOS() && isStandalone() && /\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) cfg.authDomain = location.host;

const app = initializeApp(cfg);
const auth = A.getAuth(app);
const db = F.getFirestore(app);
const { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, query, where, orderBy, limit, writeBatch, arrayUnion, arrayRemove, serverTimestamp, deleteField } = F;

export async function init() {
  try { await A.getRedirectResult(auth); } catch (e) { console.warn("redirect result", e); }
}
export function onAuth(cb) {
  return A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, name: u.displayName || "Me", photo: u.photoURL || "" } : null));
}
export async function signIn() {
  const p = new A.GoogleAuthProvider();
  if (isIOS() && isStandalone()) return A.signInWithRedirect(auth, p);
  try { await A.signInWithPopup(auth, p); }
  catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) return A.signInWithRedirect(auth, p);
    if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") throw e;
  }
}
export const logout = () => A.signOut(auth);

export async function getUserDoc(uid) {
  const s = await getDoc(doc(db, "users", uid));
  return s.exists() ? s.data() : null;
}
export async function saveUser(user) {
  await setDoc(doc(db, "users", user.uid), { name: user.name, photo: user.photo || "" }, { merge: true });
}

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode() {
  const a = new Uint32Array(8); crypto.getRandomValues(a);
  return [...a].map((n) => ALPHA[n % ALPHA.length]).join("");
}
export async function createCouple(user) {
  const cid = newCode();
  await setDoc(doc(db, "couples", cid), { members: [user.uid], names: { [user.uid]: user.name }, reviewDay: 19, createdAt: serverTimestamp() });
  await setDoc(doc(db, "users", user.uid), { coupleId: cid }, { merge: true });
  return cid;
}
export async function joinCouple(user, rawCode) {
  const cid = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  await updateDoc(doc(db, "couples", cid), { members: arrayUnion(user.uid), ["names." + user.uid]: user.name });
  await setDoc(doc(db, "users", user.uid), { coupleId: cid }, { merge: true });
  return cid;
}
export function subscribeCouple(cid, cb) {
  return onSnapshot(doc(db, "couples", cid), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), (e) => console.error(e));
}
export const updateCouple = (cid, patch) => updateDoc(doc(db, "couples", cid), patch);

export function subscribeMonths(cid, cb) {
  return onSnapshot(collection(db, "couples", cid, "months"), (s) => {
    const o = {}; s.forEach((d) => (o[d.id] = d.data())); cb(o);
  }, (e) => console.error(e));
}
export async function getEntry(cid, ym, uid) {
  try {
    const s = await getDoc(doc(db, "couples", cid, "months", ym, "entries", uid));
    return s.exists() ? s.data() : null;
  } catch (e) { if (e.code === "permission-denied") return null; throw e; }
}
export async function submitEntry(cid, ym, uid, data) {
  const b = writeBatch(db);
  b.set(doc(db, "couples", cid, "months", ym, "entries", uid), { ...data, authorUid: uid, submittedAt: serverTimestamp() });
  b.set(doc(db, "couples", cid, "months", ym), { ["s_" + uid]: serverTimestamp() }, { merge: true });
  await b.commit();
}

export function subscribeGoals(cid, uid, cb) {
  const q = query(collection(db, "couples", cid, "goals"), where("ownerUid", "==", uid));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.error(e));
}
export const addGoal = (cid, uid, g) => addDoc(collection(db, "couples", cid, "goals"), { ownerUid: uid, title: g.title, emoji: g.emoji, ticks: [], createdAt: serverTimestamp() });
export const setTick = (cid, gid, date, on) => updateDoc(doc(db, "couples", cid, "goals", gid), { ticks: on ? arrayUnion(date) : arrayRemove(date) });
export const deleteGoal = (cid, gid) => deleteDoc(doc(db, "couples", cid, "goals", gid));

export function subscribeNotes(cid, cb) {
  const q = query(collection(db, "couples", cid, "notes"), orderBy("createdAt", "desc"), limit(80));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data(), at: d.data().createdAt?.toMillis?.() || Date.now() }))), (e) => console.error(e));
}
export const addNote = (cid, uid, text) => addDoc(collection(db, "couples", cid, "notes"), { from: uid, text, createdAt: serverTimestamp() });

export async function pushStatus() {
  if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) {
    return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
  }
  return Notification.permission; // granted | denied | default
}
export async function enablePush(uid) {
  const status = await pushStatus();
  if (status === "ios-install" || status === "unsupported") return { ok: false, reason: status };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };
  const M = await import(`${CDN}/firebase-messaging.js`);
  if (!(await M.isSupported())) return { ok: false, reason: "unsupported" };
  const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const token = await M.getToken(M.getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) return { ok: false, reason: "no-token" };
  await setDoc(doc(db, "users", uid), { fcmTokens: arrayUnion(token) }, { merge: true });
  return { ok: true };
}

// ---- Memories (photos stored inside Firestore, compressed on the phone: free plan friendly) ----
export function subscribeMemories(cid, cb) {
  const q = query(collection(db, "couples", cid, "memories"), orderBy("createdAt", "desc"), limit(80));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data(), at: d.data().createdAt?.toMillis?.() || Date.now() }))), (e) => console.error(e));
}
export async function addMemory(cid, uid, m) {
  const ref = doc(collection(db, "couples", cid, "memories"));
  const b = writeBatch(db);
  b.set(ref, { from: uid, caption: m.caption || "", thumb: m.thumb, reactions: {}, saved: false, createdAt: serverTimestamp() });
  b.set(doc(db, "couples", cid, "memories", ref.id, "full", "img"), { from: uid, data: m.full });
  await b.commit();
}
export async function getFull(cid, id) {
  const s = await getDoc(doc(db, "couples", cid, "memories", id, "full", "img"));
  return s.exists() ? s.data().data : null;
}
export async function deleteMemory(cid, id) {
  const b = writeBatch(db);
  b.delete(doc(db, "couples", cid, "memories", id, "full", "img"));
  b.delete(doc(db, "couples", cid, "memories", id));
  await b.commit();
}
export const setReaction = (cid, id, uid, emoji) =>
  updateDoc(doc(db, "couples", cid, "memories", id), { ["reactions." + uid]: emoji ? emoji : deleteField() });
export const saveMemory = (cid, id) => updateDoc(doc(db, "couples", cid, "memories", id), { saved: true });
