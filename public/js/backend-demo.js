// Offline demo backend: same API as backend-firebase.js, stored in localStorage.
// Used with ?demo=1 so the screens can be previewed without Firebase.
const KEY = "ourmonthly-demo-v1";
const ME = { uid: "u_me", name: "You", photo: "" };
const PARTNER = { uid: "u_partner", name: "Your Love" };
let st = null;
try { st = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
if (!st) st = { signedIn: false, couple: null, months: {}, entries: {}, goals: [], notes: [], memories: [], fulls: {} };
st.memories ??= []; st.fulls ??= {};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
const subs = { auth: [], couple: [], months: [], goals: [], notes: [], memories: [] };
const fire = (k) => subs[k].forEach((f) => f());
const sub = (k, f) => { subs[k].push(f); setTimeout(f, 0); return () => (subs[k] = subs[k].filter((x) => x !== f)); };

export async function init() {}
export function onAuth(cb) { return sub("auth", () => cb(st.signedIn ? ME : null)); }
export async function signIn() { st.signedIn = true; save(); fire("auth"); }
export async function logout() { st = { signedIn: false, couple: null, months: {}, entries: {}, goals: [], notes: [], memories: [], fulls: {} }; save(); fire("auth"); }
export async function getUserDoc() { return st.couple ? { coupleId: st.couple.id } : null; }
export async function saveUser() {}
export async function createCouple() {
  st.couple = { id: "DEMO1234", members: [ME.uid], names: { [ME.uid]: ME.name }, reviewDay: 19 };
  save(); fire("couple"); return st.couple.id;
}
export async function joinCouple() { return createCouple(); }
export const subscribeCouple = (cid, cb) => sub("couple", () => cb(st.couple ? JSON.parse(JSON.stringify(st.couple)) : null));
export async function updateCouple(cid, patch) { Object.assign(st.couple, patch); save(); fire("couple"); }
export const subscribeMonths = (cid, cb) => sub("months", () => cb(JSON.parse(JSON.stringify(st.months))));
export async function getEntry(cid, ym, uid) {
  const e = st.entries[ym + "/" + uid]; if (!e) return null;
  const mine = st.entries[ym + "/" + ME.uid];
  if (uid !== ME.uid && !mine) return null;
  return e;
}
export async function submitEntry(cid, ym, uid, data) {
  st.entries[ym + "/" + uid] = { ...data, authorUid: uid };
  st.months[ym] = { ...(st.months[ym] || {}), ["s_" + uid]: Date.now() };
  save(); fire("months");
}
export const subscribeGoals = (cid, uid, cb) => sub("goals", () => cb(JSON.parse(JSON.stringify(st.goals))));
export async function addGoal(cid, uid, g) { st.goals.push({ id: "g" + Date.now(), ownerUid: uid, ticks: [], ...g }); save(); fire("goals"); }
export async function setTick(cid, gid, date, on) {
  const g = st.goals.find((x) => x.id === gid); const s = new Set(g.ticks); on ? s.add(date) : s.delete(date); g.ticks = [...s]; save(); fire("goals");
}
export async function deleteGoal(cid, gid) { st.goals = st.goals.filter((g) => g.id !== gid); save(); fire("goals"); }
export const subscribeNotes = (cid, cb) => sub("notes", () => cb([...st.notes].sort((a, b) => b.at - a.at)));
export async function addNote(cid, uid, text) { st.notes.push({ id: "n" + Date.now(), from: uid, text, at: Date.now() }); save(); fire("notes"); }
export const subscribeMemories = (cid, cb) => sub("memories", () => cb([...st.memories].sort((a, b) => b.at - a.at)));
export async function addMemory(cid, uid, m) {
  const id = "m" + Date.now();
  st.memories.push({ id, from: uid, caption: m.caption || "", thumb: m.thumb, reactions: {}, saved: false, at: Date.now() }); st.fulls[id] = m.full;
  try { save(); } catch {} fire("memories");
}
export async function setReaction(cid, id, uid, emoji) {
  const m = st.memories.find((x) => x.id === id); if (!m) return; m.reactions ||= {}; if (emoji) m.reactions[uid] = emoji; else delete m.reactions[uid]; save(); fire("memories");
}
export async function saveMemory(cid, id) { const m = st.memories.find((x) => x.id === id); if (m) { m.saved = true; save(); fire("memories"); } }
export async function getFull(cid, id) { return st.fulls[id] || null; }
export async function deleteMemory(cid, id) { st.memories = st.memories.filter((m) => m.id !== id); delete st.fulls[id]; save(); fire("memories"); }
export async function pushStatus() { return "default"; }
export async function enablePush() { return { ok: true }; }

// ---- demo-only helpers ----
export const demo = {
  partner: PARTNER,
  joinPartner() {
    if (!st.couple) return;
    st.couple.members = [ME.uid, PARTNER.uid]; st.couple.names[PARTNER.uid] = PARTNER.name; save(); fire("couple");
  },
  partnerSubmit(ym) {
    st.entries[ym + "/" + PARTNER.uid] = {
      liked: "You made our Sunday so special. The surprise coffee and how you listened to my rant without checking your phone.",
      change: "I wish we planned weekends earlier so I'm not guessing. Also, less last-minute cancelling please.",
      improve: "I'll be more patient when I'm tired and say it kindly instead of going quiet.",
      mood: "🥰",
      tracker: [{ emoji: "📵", title: "Phone away at dinner", days: 12 }, { emoji: "💬", title: "Reply faster", days: 9 }],
      authorUid: PARTNER.uid
    };
    st.months[ym] = { ...(st.months[ym] || {}), ["s_" + PARTNER.uid]: Date.now() }; save(); fire("months");
  },
  partnerMemory(ageHours) {
    const c = document.createElement("canvas"); c.width = 900; c.height = 1200; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 900, 1200); g.addColorStop(0, "#ff9a8b"); g.addColorStop(1, "#7f5cff"); x.fillStyle = g; x.fillRect(0, 0, 900, 1200);
    x.font = "300px serif"; x.textAlign = "center"; x.fillText("🌅", 450, 700);
    const full = c.toDataURL("image/jpeg", 0.7); const t = document.createElement("canvas"); t.width = 300; t.height = 400; t.getContext("2d").drawImage(c, 0, 0, 300, 400);
    const id = "m" + Date.now(); st.memories.push({ id, from: PARTNER.uid, caption: "Sunset with you 🌅", thumb: t.toDataURL("image/jpeg", 0.6), reactions: {}, saved: false, at: Date.now() - (ageHours || 0) * 36e5 }); st.fulls[id] = full; try { save(); } catch {} fire("memories");
  },
  partnerReact() { const m = [...st.memories].filter((x) => x.from === ME.uid).sort((a, b) => b.at - a.at)[0]; if (m) { m.reactions ||= {}; m.reactions[PARTNER.uid] = "🔥"; save(); fire("memories"); } },
  ageOwn(hours) { st.memories.filter((x) => x.from === ME.uid).forEach((x) => (x.at = Date.now() - hours * 36e5)); save(); fire("memories"); },
  partnerNote() { st.notes.push({ id: "n" + Date.now(), from: PARTNER.uid, text: "Thinking of you 💕", at: Date.now() }); save(); fire("notes"); },
  reset() { localStorage.removeItem(KEY); location.reload(); }
};
