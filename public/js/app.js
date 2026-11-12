import { APP_NAME } from "./config.js";

const qs = new URLSearchParams(location.search);
const DEMO = qs.has("demo");
const B = await import(DEMO ? "./backend-demo.js" : "./backend-firebase.js");

// ---------- dates ----------
const NOW = qs.get("today") ? new Date(qs.get("today") + "T12:00:00") : new Date();
const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = dstr(NOW);
const YM = TODAY.slice(0, 7);
const prevYM = (ym) => { let [y, m] = ym.split("-").map(Number); m--; if (!m) { m = 12; y--; } return `${y}-${pad(m)}`; };
const monthName = (ym) => new Date(ym + "-01T12:00:00").toLocaleString("en-IN", { month: "long", year: "numeric" });
const dayName = (d) => d.toLocaleString("en-IN", { day: "numeric", month: "short" });
const daysInMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };

// ---------- theme ----------
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ---------- state ----------
const S = {
  ready: false, user: null, cid: null, couple: null,
  view: "home", months: {}, goals: [], notes: [], memories: [], entries: {}, photos: [], memTab: "snaps",
  draft: { liked: "", change: "", improve: "", mood: "🥰" },
  sheet: false, newEmoji: "💬", celebrate: null, toast: "", pushMsg: "", expanded: null, err: "",
  compose: null, viewer: null, busy: false, seen: null
};
let unsubs = [];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = (s) => esc(s).replace(/\n/g, "<br>");
const initial = (n) => esc((n || "?").trim().charAt(0).toUpperCase());

const me = () => S.user?.uid;
const partnerId = () => S.couple?.members?.find((u) => u !== me());
const myName = () => S.couple?.names?.[me()] || S.user?.name || "You";
const pName = () => S.couple?.names?.[partnerId()] || "your partner";
const paired = () => (S.couple?.members?.length || 0) === 2;
const reviewDay = () => S.couple?.reviewDay || 19;
const complete = (m) => !!m && paired() && S.couple.members.every((u) => m["s_" + u]);
const iSubmitted = (ym) => !!S.months[ym]?.["s_" + me()];
const pSubmitted = (ym) => !!S.months[ym]?.["s_" + partnerId()];

function cycle() {
  const rd = reviewDay();
  if (NOW.getDate() >= rd) return { ym: YM, open: true };
  const p = prevYM(YM), pd = S.months[p];
  if (pd && Object.keys(pd).some((k) => k.startsWith("s_")) && !complete(pd)) return { ym: p, open: true, late: true };
  return { ym: YM, open: false };
}
function nextReviewDate() {
  const rd = reviewDay();
  let d = new Date(NOW.getFullYear(), NOW.getMonth(), rd, 12);
  if (NOW.getDate() > rd) d = new Date(NOW.getFullYear(), NOW.getMonth() + 1, rd, 12);
  return d;
}
const daysLeft = () => Math.round((nextReviewDate() - new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 12)) / 864e5);

const plant = (ratio) => (ratio >= 0.8 ? "🌸" : ratio >= 0.5 ? "🪴" : ratio >= 0.2 ? "🌿" : "🌱");
function goalStats(g, ym) {
  const days = (g.ticks || []).filter((t) => t.startsWith(ym)).length;
  const elapsed = ym === YM ? NOW.getDate() : daysInMonth(ym);
  return { days, ratio: elapsed ? days / elapsed : 0 };
}
const snapshot = (ym) => S.goals.map((g) => ({ emoji: g.emoji, title: g.title, days: goalStats(g, ym).days }));
function streak() {
  const days = new Set(S.goals.flatMap((g) => g.ticks || []));
  const d = new Date(NOW); let n = 0;
  if (!days.has(dstr(d))) d.setDate(d.getDate() - 1);
  while (days.has(dstr(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ---------- photos (compressed on the phone, stored inside Firestore: free plan) ----------
function loadImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    im.src = url;
  });
}
function shrink(im, maxDim, maxChars) {
  let scale = Math.min(1, maxDim / Math.max(im.naturalWidth, im.naturalHeight));
  for (let tries = 0; tries < 8; tries++) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(im.naturalWidth * scale)); c.height = Math.max(1, Math.round(im.naturalHeight * scale));
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    for (let q = 0.8; q >= 0.4; q -= 0.1) { const u = c.toDataURL("image/jpeg", q); if (u.length <= maxChars) return u; }
    scale *= 0.8;
  }
  throw new Error("image too large");
}
const compressFull = async (f) => shrink(await loadImg(f), 1000, 240000);
async function compressBoth(f) { const im = await loadImg(f); return { full: shrink(im, 1000, 240000), thumb: shrink(im, 360, 32000) }; }

const mkInput = (capture) => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; if (capture) i.capture = capture; i.hidden = true; document.body.appendChild(i); return i; };
const camIn = mkInput("environment"), galIn = mkInput(""), phIn = mkInput("");
camIn.addEventListener("change", () => pickForCompose(camIn));
galIn.addEventListener("change", () => pickForCompose(galIn));
async function pickForCompose(inp) {
  const f = inp.files?.[0]; inp.value = ""; if (!f) return;
  try { S.busy = true; render(); const { full, thumb } = await compressBoth(f); S.compose = { full, thumb, caption: "" }; } catch { toast("Couldn't read that photo"); }
  S.busy = false; render();
}
phIn.addEventListener("change", async () => {
  const f = phIn.files?.[0]; phIn.value = ""; if (!f || S.photos.length >= 3) return;
  document.activeElement?.blur?.();
  try { S.busy = true; render(); S.photos.push(await compressFull(f)); savePhotos(cycle().ym); } catch { toast("Couldn't read that photo"); }
  S.busy = false; render();
});
const phKey = (ym) => `om-ph-${S.cid}-${ym}`;
const savePhotos = (ym) => { try { localStorage.setItem(phKey(ym), JSON.stringify(S.photos)); } catch {} };

// ---------- draft ----------
const draftKey = (ym) => `om-draft-${S.cid}-${ym}`;
function loadDraft(ym) {
  try { const d = JSON.parse(localStorage.getItem(draftKey(ym)) || "null"); if (d) S.draft = { liked: "", change: "", improve: "", mood: "🥰", ...d }; } catch {}
  try { S.photos = JSON.parse(localStorage.getItem(phKey(ym)) || "[]"); } catch { S.photos = []; }
}
function saveDraft(ym) { try { localStorage.setItem(draftKey(ym), JSON.stringify(S.draft)); } catch {} }

// ---------- boot ----------
const root = document.getElementById("app");
await B.init();
B.onAuth(async (u) => {
  unsubs.forEach((f) => f && f()); unsubs = [];
  Object.assign(S, { user: u, cid: null, couple: null, months: {}, goals: [], notes: [], memories: [], entries: {} });
  if (!u) { S.ready = true; return render(); }
  try {
    await B.saveUser(u);
    const ud = await B.getUserDoc(u.uid);
    if (ud?.coupleId) attach(ud.coupleId);
  } catch (e) { S.err = e.message; }
  S.ready = true; render();
});

function attach(cid) {
  S.cid = cid;
  const prevDone = {};
  unsubs.push(B.subscribeCouple(cid, (c) => { S.couple = c; loadDraft(cycle().ym); loadEntries(); render(); }));
  unsubs.push(B.subscribeMonths(cid, (m) => {
    S.months = m;
    for (const [ym, doc] of Object.entries(m)) {
      if (prevDone[ym] === false && complete(doc)) { S.celebrate = ym; S.view = "checkin"; }
      prevDone[ym] = complete(doc);
    }
    loadEntries(); render();
  }));
  unsubs.push(B.subscribeGoals(cid, me(), (g) => { S.goals = g; render(); }));
  unsubs.push(B.subscribeNotes(cid, (n) => { S.notes = n; render(); }));
  unsubs.push(B.subscribeMemories(cid, (m) => { S.memories = m; cleanup(); if (S.viewer?.id && !S.memories.some((x) => x.id === S.viewer.id)) S.viewer = null; render(); }));
}
const HOUR = 36e5, TTL = 24 * HOUR;
const seenKey = () => `om-seenids-${S.cid}`;
const seenSet = () => { if (!S.seen || S.seen.cid !== S.cid) { let a = []; try { a = JSON.parse(lsGet(seenKey(), "[]")); } catch {} S.seen = { cid: S.cid, set: new Set(a) }; } return S.seen.set; };
const markSeen = (id) => { const st = seenSet(); if (st.has(id)) return; st.add(id); lsSet(seenKey(), JSON.stringify([...st].slice(-300))); };
const expired = (m) => !m.saved && Date.now() - m.at > TTL;
const live = () => S.memories.filter((m) => !expired(m));
const isNew = (m) => m.from !== me() && !seenSet().has(m.id);
const unseen = () => live().some(isNew);
const hoursLeft = (m) => Math.max(1, Math.ceil((m.at + TTL - Date.now()) / HOUR));
const gone = new Set();
function cleanup() {
  for (const m of S.memories) {
    if (m.from === me() && expired(m) && !gone.has(m.id)) { gone.add(m.id); B.deleteMemory(S.cid, m.id).catch((e) => { gone.delete(m.id); console.error(e); }); }
  }
}
setInterval(() => { if (S.cid && S.user) { cleanup(); const ae = document.activeElement; if (!(ae && ["TEXTAREA", "INPUT"].includes(ae.tagName)) && !S.viewer && !S.compose) render(); } }, 60000);

let loading = false;
async function loadEntries() {
  if (loading || !S.couple) return; loading = true;
  try {
    const pid = partnerId();
    for (const [ym, m] of Object.entries(S.months)) {
      S.entries[ym] ??= {};
      if (m["s_" + me()] && !S.entries[ym].me) S.entries[ym].me = await B.getEntry(S.cid, ym, me());
      if (pid && complete(m) && !S.entries[ym].partner) S.entries[ym].partner = await B.getEntry(S.cid, ym, pid);
    }
  } catch (e) { console.error(e); } finally { loading = false; render(); }
}

// ---------- render ----------
let pending = false;
function render() {
  const ae = document.activeElement;
  if (ae && root.contains(ae) && ["TEXTAREA", "INPUT"].includes(ae.tagName)) { pending = true; return; }
  pending = false;
  root.innerHTML = view() + (DEMO && S.user ? demoPanel() : "");
}
document.addEventListener("focusout", () => { if (pending) setTimeout(render, 80); });
function toast(msg) { S.toast = msg; render(); setTimeout(() => { S.toast = ""; render(); }, 2600); }

function view() {
  if (!S.ready) return `<div class="center"><div class="bigemoji bounce">💌</div><p class="muted">Loading…</p></div>`;
  if (!S.user) return loginView();
  if (!S.cid || !S.couple) return pairView();
  if (!paired()) return inviteView();
  const on = (v) => (S.view === v || (v === "checkin" && S.view === "history") ? "on" : "");
  const body = { home: homeView, checkin: checkinView, goals: goalsView, memories: memoriesView, history: historyView }[S.view]();
  return `
  <header class="top"><div><div class="brand">${APP_NAME}</div><div class="sub">${esc(myName())} 💕 ${esc(pName())}</div></div>
    <button class="icon" data-act="sheet" aria-label="Settings">⚙️</button></header>
  <main class="page">${body}</main>
  <nav class="tabs">
    <button class="${on("home")}" data-act="nav" data-v="home"><span>🏡</span>Home</button>
    <button class="${on("checkin")}" data-act="nav" data-v="checkin"><span>💌</span>Check-in</button>
    <button class="cam" data-act="camera" aria-label="Take a snap"><span>📸</span></button>
    <button class="${on("memories")}" data-act="nav" data-v="memories"><span>🖼️</span>Memories${unseen() ? `<i class="badge"></i>` : ""}</button>
    <button class="${on("goals")}" data-act="nav" data-v="goals"><span>🌱</span>Goals</button>
  </nav>
  ${S.sheet ? settingsView() : ""}${S.compose ? composeView() : ""}${S.viewer ? viewerView() : ""}${S.busy ? `<div class="toast">One moment…</div>` : ""}${S.toast ? `<div class="toast">${esc(S.toast)}</div>` : ""}`;
}

function loginView() {
  return `<div class="center"><div class="bigemoji bounce">💌</div><h1>${APP_NAME}</h1>
  <p class="muted">A tiny private place for just the two of you.<br>Snaps, memories and one honest check-in a month.</p>
  <button class="btn" data-act="signin">Continue with Google</button>${S.err ? `<p class="err">${esc(S.err)}</p>` : ""}${DEMO ? '<p class="muted small">demo mode</p>' : ""}</div>`;
}
function pairView() {
  return `<div class="center"><div class="bigemoji">👩‍❤️‍👨</div><h1>Hi ${esc(S.user.name.split(" ")[0])}!</h1>
  <p class="muted">Let's connect the two of you. One person creates the couple, the other joins with the code.</p>
  <button class="btn" data-act="create">✨ Create our couple</button>
  <div class="or">or join your partner</div>
  <input id="code" class="in" placeholder="Enter partner's code" maxlength="9" autocapitalize="characters" autocomplete="off">
  <button class="btn ghost" data-act="join">Join</button>${S.err ? `<p class="err">${esc(S.err)}</p>` : ""}
  <button class="link" data-act="logout">Sign out</button></div>`;
}
function inviteView() {
  const code = S.cid.replace(/(.{4})(.{4})/, "$1-$2");
  return `<div class="center"><div class="bigemoji bounce">💗</div><h1>Almost there!</h1>
  <p class="muted">Send this code to your partner. They open the app, sign in with Google and choose "Join".</p>
  <div class="code">${code}</div>
  <button class="btn" data-act="share">Share the code</button><button class="btn ghost" data-act="copycode">Copy code</button>
  <p class="muted small">Waiting for them to join…</p><button class="link" data-act="logout">Sign out</button></div>`;
}

function ring() {
  const c = cycle(), left = daysLeft(), r = 52, circ = 2 * Math.PI * r;
  const prog = c.open ? 1 : Math.max(0.04, 1 - left / 30);
  return `<div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="rt"/><circle cx="60" cy="60" r="${r}" class="rp" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - prog)}"/></svg>
  <div class="rin">${c.open ? `<div class="bigemoji sm">💌</div>` : `<b>${left}</b><span>${left === 1 ? "day" : "days"}</span>`}</div></div>`;
}
function pills(ym) {
  const m = (ok, who) => `<div class="pill ${ok ? "ok" : ""}">${ok ? "✅" : "⏳"} ${esc(who)}</div>`;
  return `<div class="pills">${m(iSubmitted(ym), "You")}${m(pSubmitted(ym), pName())}</div>`;
}
function homeView() {
  const c = cycle(), left = daysLeft(), sk = streak();
  const iOSHint = /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone && !DEMO
    ? `<div class="card soft small">📱 On iPhone: tap <b>Share → Add to Home Screen</b>, then open the app from your home screen to get reminders.</div>` : "";
  const lastNote = S.notes.find((n) => n.from !== me());
  const done = complete(S.months[c.ym]);
  const msg = c.open ? (done ? "You both shared! Read it again in Check-in 💞" : iSubmitted(c.ym) ? `Sealed! Waiting for ${esc(pName())}…` : "It's check-in time! Share your thoughts 💌")
    : left === 1 ? "Tomorrow is our check-in day! Get your thoughts ready 💭" : `Next check-in: <b>${dayName(nextReviewDate())}</b>`;
  const cta = c.open && !iSubmitted(c.ym) ? `<button class="btn" data-act="nav" data-v="checkin">Write my check-in</button>`
    : !c.open ? `<button class="btn ghost" data-act="nav" data-v="checkin">Start drafting</button>` : "";
  return `${iOSHint}
  <div class="stories">
    <button class="story" data-act="nav" data-v="memories"><div class="av">${initial(myName())}</div>You</button>
    <button class="story" data-act="nav" data-v="memories"><div class="av ${unseen() ? "ring2" : ""}">${initial(pName())}</div>${esc(pName())}</button>
    <div class="streak">🔥 ${sk}<small>day streak</small></div>
  </div>
  <section class="card hero">${ring()}<p class="msg">${msg}</p>${pills(c.ym)}${cta}</section>
  <section class="card"><h3>🌱 My goals this month</h3>${S.goals.length ? S.goals.map((g) => { const s = goalStats(g, YM); return `<div class="row"><span class="gi">${esc(g.emoji)}</span><span class="grow">${esc(g.title)}</span><span class="pl">${plant(s.ratio)}</span></div>`; }).join("") : `<p class="muted small">Add things you're working on for each other.</p>`}
  <button class="link" data-act="nav" data-v="goals">Open goals →</button></section>
  ${lastNote ? `<section class="card note"><div class="small muted">Latest note from ${esc(pName())}</div><p>${nl(lastNote.text)}</p></section>` : ""}`;
}

function field(key, label, ph) {
  return `<label class="lbl">${label}</label><textarea class="in ta" data-f="${key}" rows="4" placeholder="${ph}">${esc(S.draft[key])}</textarea>`;
}
function snapChips(arr) {
  if (!arr?.length) return `<p class="muted small">No goals tracked this month.</p>`;
  return `<div class="chips">${arr.map((t) => `<span class="chip">${esc(t.emoji)} ${esc(t.title)} <b>${t.days}d</b></span>`).join("")}</div>`;
}
function entryCard(title, e, cls) {
  if (!e) return "";
  return `<section class="card reveal ${cls}"><h3>${title} ${esc(e.mood || "")}</h3>
  <div class="q">💗 What I loved</div><p>${nl(e.liked)}</p>
  <div class="q">🌧️ What I'd like to change</div><p>${nl(e.change)}</p>
  <div class="q">🌱 What I'll improve / handle differently</div><p>${nl(e.improve)}</p>
  <div class="q">✅ What I worked on for us</div>${snapChips(e.tracker)}
  ${e.photos?.length ? `<div class="q">📷 Moments</div><div class="phs">${e.photos.map((p) => `<img src="${p}" data-act="zoomimg" alt="">`).join("")}</div>` : ""}</section>`;
}
function checkinView() {
  const c = cycle(), ym = c.ym, mine = S.entries[ym]?.me, theirs = S.entries[ym]?.partner;
  const head = `<h2>${monthName(ym)}${c.late ? " <small>(still open)</small>" : ""}</h2>`;
  const pastBtn = `<button class="btn ghost" data-act="nav" data-v="history">📖 Past months</button>`;
  if (complete(S.months[ym])) {
    return `${head}${S.celebrate === ym ? `<div class="confetti">🎉💞✨🎊💗</div>` : ""}<p class="muted">You both shared. Here's what each of you wrote 💞</p>
    ${entryCard(`What ${esc(pName())} shared`, theirs, "theirs")}${entryCard("What I shared", mine, "mine")}${!theirs ? `<p class="muted">Opening…</p>` : ""}${pastBtn}`;
  }
  if (iSubmitted(ym)) {
    return `${head}<section class="card hero"><div class="bigemoji bounce">💌</div><h3>Sealed &amp; sent</h3>
    <p class="muted">Your thoughts are locked. They open the moment ${esc(pName())} shares theirs too, so neither of you sees anything early.</p>${pills(ym)}</section>
    ${mine ? `<details class="card"><summary>Peek at what I wrote</summary>${entryCard("My check-in", mine, "mine").replace('class="card reveal mine"', 'class="plain"')}</details>` : ""}${pastBtn}`;
  }
  const open = c.open, p = esc(pName());
  return `${head}${!open ? `<div class="card soft">✍️ Check-in opens on <b>${dayName(nextReviewDate())}</b>. You can already write your draft, it saves on this phone.</div>` : `<div class="card soft">Be honest and kind. Once you seal it, ${p} can't read it until you've both shared, and you can't edit it.</div>`}
  <section class="card">${field("liked", "💗 What did I love about us this month?", `Things ${p} did that made me smile…`)}
  ${field("change", "🌧️ What would I like to change?", "Something that bothered me, said gently…")}
  ${field("improve", "🌱 What can I improve or handle differently?", "My side of it…")}
  <label class="lbl">📷 Moments from the month (optional, up to 3)</label>
  <div class="ph">${S.photos.map((ph, i) => `<div class="phb"><img src="${ph}" alt=""><button data-act="rmphoto" data-i="${i}" aria-label="Remove">✕</button></div>`).join("")}${S.photos.length < 3 ? `<button class="phadd" data-act="addphoto" aria-label="Add photo">＋</button>` : ""}</div>
  <label class="lbl">How was the month for me?</label><div class="moods">${["🥰", "😊", "😐", "😔", "😤"].map((m) => `<button class="mood ${S.draft.mood === m ? "on" : ""}" data-act="mood" data-m="${m}">${m}</button>`).join("")}</div></section>
  <section class="card"><h3>✅ My goals snapshot</h3>${snapChips(snapshot(ym))}<p class="muted small">${p} will see this when you both share.</p></section>
  <button class="btn" data-act="submit" ${open ? "" : "disabled"}>${open ? "Seal &amp; share 💌" : "Opens on " + dayName(nextReviewDate())}</button>${pastBtn}`;
}

function goalsView() {
  const emojis = ["💬", "📵", "🤗", "⏰", "🥗", "🧘", "📚", "💪", "🙏", "🌷"];
  const dim = daysInMonth(YM);
  return `<h2>My goals for us</h2><p class="muted">Little things you're working on for your partner. Tap to tick today and keep your 🔥 streak. ${esc(pName())} sees your month on check-in day.</p>
  ${S.goals.map((g) => { const s = goalStats(g, YM), done = (g.ticks || []).includes(TODAY);
    return `<section class="card"><div class="row"><span class="gi">${esc(g.emoji)}</span><b class="grow">${esc(g.title)}</b><span class="pl big">${plant(s.ratio)}</span></div>
    <div class="bar"><i style="width:${Math.round(Math.min(1, s.days / dim) * 100)}%"></i></div>
    <div class="row"><span class="muted small">${s.days} day${s.days === 1 ? "" : "s"} this month</span><span class="grow"></span>
    <button class="chipbtn ${done ? "on" : ""}" data-act="tick" data-g="${g.id}" data-on="${done ? 0 : 1}">${done ? "✅ Done today" : "Tick today"}</button>
    <button class="link small" data-act="delgoal" data-g="${g.id}">remove</button></div></section>`; }).join("") || `<div class="card soft">No goals yet. Add your first one below 👇</div>`}
  <section class="card"><h3>➕ New goal</h3><div class="moods">${emojis.map((e) => `<button class="mood ${S.newEmoji === e ? "on" : ""}" data-act="emoji" data-e="${e}">${e}</button>`).join("")}</div>
  <input id="gtitle" class="in" maxlength="60" placeholder="e.g. Put my phone away at dinner"><button class="btn" data-act="addgoal">Add goal</button></section>`;
}

const RX = ["❤️", "😂", "😮", "🥺", "🔥"];
const rxText = (m) => Object.entries(m.reactions || {}).map(([u, e]) => `${e} ${u === me() ? "You" : esc(pName())}`).join("  ·  ");
function tile(m) {
  const mine = m.from === me(), rx = Object.values(m.reactions || {}).join("");
  return `<button class="tile" data-act="openmem" data-id="${m.id}"><img src="${m.thumb}" alt="">${isNew(m) ? `<span class="dot"></span>` : ""}<span class="who">${mine ? "You" : esc(pName())}</span><span class="tag">${m.saved ? "💾" : "⏳ " + hoursLeft(m) + "h"}</span>${rx ? `<span class="rx">${rx}</span>` : ""}</button>`;
}
function memoriesView() {
  const T = S.memTab;
  const seg = `<div class="seg"><button class="${T === "snaps" ? "on" : ""}" data-act="memtab" data-t="snaps">📸 Snaps</button><button class="${T === "saved" ? "on" : ""}" data-act="memtab" data-t="saved">💾 Saved</button><button class="${T === "notes" ? "on" : ""}" data-act="memtab" data-t="notes">💬 Notes</button></div>`;
  if (T === "notes") {
    return `<h2>Little notes</h2>${seg}<section class="card"><textarea id="ntext" class="in ta" rows="3" maxlength="500" placeholder="Say something sweet…"></textarea><button class="btn" data-act="sendnote">Send 💕</button></section>
    ${S.notes.map((n) => `<div class="bubble ${n.from === me() ? "me" : "them"}">${nl(n.text)}<div class="small muted">${n.from === me() ? "You" : esc(pName())} · ${new Date(n.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div></div>`).join("") || `<p class="muted center-t">No notes yet.</p>`}`;
  }
  const all = live(), list = all.filter((m) => (T === "saved" ? m.saved : !m.saved));
  const empty = T === "saved" ? `<div class="card soft">Nothing saved yet. Open a snap and tap 💾 Save to keep it forever.</div>` : `<div class="card soft">No snaps right now. Tap the big camera button to share one 📸<br>Snaps disappear after 24 hours unless you save them.</div>`;
  return `<h2>Our memories</h2>${seg}
  ${T === "snaps" ? `<div class="row"><button class="btn" style="margin:0" data-act="camera">📸 Take a snap</button><button class="btn ghost" style="margin:0" data-act="gallery">🖼️ Gallery</button></div>` : ""}
  ${list.length ? `<div class="grid">${list.map(tile).join("")}</div>` : empty}`;
}
function composeView() {
  return `<div class="compose"><img src="${S.compose.full}" alt=""><div class="vbar"><button class="vbtn" data-act="cancelcompose">✕ Cancel</button></div>
  <input id="cap" class="capin" maxlength="120" placeholder="Add a caption…" value="${esc(S.compose.caption)}">
  <div class="sendbar"><button class="btn" data-act="sendsnap">Send to ${esc(pName())} ➤</button></div></div>`;
}
function viewerView() {
  const v = S.viewer, m = v.id ? S.memories.find((x) => x.id === v.id) : null;
  if (!m) return `<div class="viewer"><img src="${v.src}" alt=""><div class="vbar"><button class="vbtn" data-act="closeviewer">✕ Close</button></div></div>`;
  const mineRx = m.reactions?.[me()], own = m.from === me();
  return `<div class="viewer"><img src="${v.src}" alt=""><div class="vbar"><button class="vbtn" data-act="closeviewer">✕ Close</button>
  <span style="display:flex;gap:8px">${m.saved ? `<span class="vbtn on">💾 Saved</span>` : `<button class="vbtn" data-act="savemem" data-id="${m.id}">💾 Save</button>`}${own ? `<button class="vbtn" data-act="delmem" data-id="${m.id}">🗑</button>` : ""}</span></div>
  ${m.caption ? `<div class="cap">${esc(m.caption)}</div>` : ""}
  <div class="vfoot">${rxText(m) ? `<div class="rxlist">${rxText(m)}</div>` : ""}
  <div class="rxrow">${RX.map((e) => `<button class="rxb ${mineRx === e ? "on" : ""}" data-act="react" data-id="${m.id}" data-e="${e}">${e}</button>`).join("")}</div>
  <div class="vinfo">${m.saved ? "Saved forever" : "Disappears in " + hoursLeft(m) + "h · tap 💾 to keep"}</div></div></div>`;
}

function historyView() {
  const list = Object.keys(S.months).filter((ym) => complete(S.months[ym])).sort().reverse();
  return `<button class="link" data-act="nav" data-v="checkin">← Back</button><h2>Our past months</h2>${list.length ? list.map((ym) => `<section class="card"><button class="acc" data-act="expand" data-ym="${ym}"><b>${monthName(ym)}</b><span>${S.expanded === ym ? "▲" : "▼"}</span></button>
  ${S.expanded === ym ? `${entryCard(`What ${esc(pName())} shared`, S.entries[ym]?.partner, "theirs")}${entryCard("What I shared", S.entries[ym]?.me, "mine")}` : ""}</section>`).join("") : `<div class="card soft">Your shared months will be saved here after your first check-in together 📖</div>`}`;
}

function settingsView() {
  const code = S.cid.replace(/(.{4})(.{4})/, "$1-$2");
  return `<div class="sheetbg" data-act="sheet"></div><div class="sheet"><h3>Settings</h3>
  <label class="lbl">Check-in day each month</label><select id="rday" class="in">${Array.from({ length: 28 }, (_, i) => `<option ${i + 1 === reviewDay() ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
  <button class="btn ghost" data-act="push">🔔 Turn on reminders on this phone</button>${S.pushMsg ? `<p class="small muted">${esc(S.pushMsg)}</p>` : ""}
  <p class="small muted">Reminders come the day before and on check-in day.</p>
  <p class="small muted">Couple code: <b>${code}</b></p>
  <button class="btn ghost" data-act="logout">Sign out</button><button class="link" data-act="sheet">Close</button></div>`;
}

function demoPanel() {
  return `<div class="demo"><b>demo</b><button data-act="d-join">partner joins</button><button data-act="d-submit">partner submits</button><button data-act="d-note">partner note</button><button data-act="d-snap">partner snap</button><button data-act="d-snap-old">old snap</button><button data-act="d-react">react</button><button data-act="d-age">age mine</button><button data-act="d-reset">reset</button></div>`;
}

// ---------- events ----------
const act = {
  nav: (t) => { S.view = t.dataset.v; if (S.view !== "checkin") S.celebrate = null; render(); window.scrollTo(0, 0); },
  signin: async () => { try { S.err = ""; await B.signIn(); } catch (e) { S.err = e.message; render(); } },
  logout: async () => { S.sheet = false; await B.logout(); },
  create: async () => { try { S.err = ""; const cid = await B.createCouple(S.user); attach(cid); } catch (e) { S.err = e.message; render(); } },
  join: async () => {
    const v = document.getElementById("code")?.value || ""; if (v.replace(/[^A-Za-z0-9]/g, "").length !== 8) { S.err = "Please enter the 8-character code."; return render(); }
    try { S.err = ""; const cid = await B.joinCouple(S.user, v); attach(cid); } catch (e) { S.err = "Couldn't join with that code. Check it and try again."; console.error(e); render(); }
  },
  copycode: async () => { await navigator.clipboard?.writeText(S.cid.replace(/(.{4})(.{4})/, "$1-$2")); toast("Code copied 💗"); },
  share: async () => {
    const code = S.cid.replace(/(.{4})(.{4})/, "$1-$2"), text = `Join me on ${APP_NAME} 💌 Open ${location.origin} and use code ${code}`;
    if (navigator.share) { try { await navigator.share({ text }); } catch {} } else { await navigator.clipboard?.writeText(text); toast("Invite copied 💗"); }
  },
  sheet: () => { S.sheet = !S.sheet; S.pushMsg = ""; render(); },
  mood: (t) => { S.draft.mood = t.dataset.m; saveDraft(cycle().ym); render(); },
  emoji: (t) => { S.newEmoji = t.dataset.e; render(); },
  addphoto: () => phIn.click(),
  rmphoto: (t) => { S.photos.splice(Number(t.dataset.i), 1); savePhotos(cycle().ym); render(); },
  submit: async () => {
    const c = cycle(); if (!c.open) return;
    const d = { ...S.draft };
    if (![d.liked, d.change, d.improve].some((x) => x.trim().length > 1)) return toast("Write something first 💭");
    if (!confirm(`Seal your ${monthName(c.ym)} check-in?\n\nYou won't be able to edit it. ${pName()} will only see it once you've both shared.`)) return;
    try {
      const data = { liked: d.liked.trim(), change: d.change.trim(), improve: d.improve.trim(), mood: d.mood, tracker: snapshot(c.ym) };
      if (S.photos.length) data.photos = [...S.photos];
      S.busy = true; render();
      await B.submitEntry(S.cid, c.ym, me(), data);
      try { localStorage.removeItem(draftKey(c.ym)); localStorage.removeItem(phKey(c.ym)); } catch {}
      S.photos = []; S.entries[c.ym] = {}; S.busy = false; await loadEntries(); toast("Sealed 💌");
    } catch (e) { console.error(e); S.busy = false; toast("Couldn't save. Please try again."); }
  },
  tick: async (t) => { try { await B.setTick(S.cid, t.dataset.g, TODAY, t.dataset.on === "1"); } catch (e) { toast("Couldn't update"); } },
  addgoal: async () => {
    const el = document.getElementById("gtitle"), v = el.value.trim(); if (!v) return toast("Give your goal a name");
    await B.addGoal(S.cid, me(), { title: v, emoji: S.newEmoji }); el.value = ""; toast("Goal added 🌱");
  },
  delgoal: async (t) => { if (confirm("Remove this goal?")) await B.deleteGoal(S.cid, t.dataset.g); },
  memtab: (t) => { S.memTab = t.dataset.t; render(); },
  sendnote: async () => { const el = document.getElementById("ntext"), v = el.value.trim(); if (!v) return; await B.addNote(S.cid, me(), v); el.value = ""; },
  camera: () => camIn.click(),
  gallery: () => galIn.click(),
  cancelcompose: () => { S.compose = null; render(); },
  sendsnap: async () => {
    const c = S.compose; if (!c) return; const cap = document.getElementById("cap"); if (cap) c.caption = cap.value;
    try { S.busy = true; render(); await B.addMemory(S.cid, me(), { caption: c.caption.trim(), thumb: c.thumb, full: c.full }); S.compose = null; S.view = "memories"; S.memTab = "snaps"; S.busy = false; toast("Snap sent 📸"); }
    catch (e) { console.error(e); S.busy = false; toast("Couldn't send. Please try again."); }
  },
  openmem: async (t) => {
    const m = S.memories.find((x) => x.id === t.dataset.id); if (!m) return;
    markSeen(m.id); S.viewer = { id: m.id, src: m.thumb }; render();
    try { const full = await B.getFull(S.cid, m.id); if (full && S.viewer?.id === m.id) { S.viewer.src = full; render(); } } catch (e) { console.error(e); }
  },
  react: async (t) => {
    const m = S.memories.find((x) => x.id === t.dataset.id); if (!m) return;
    const cur = m.reactions?.[me()], next = cur === t.dataset.e ? null : t.dataset.e;
    try { await B.setReaction(S.cid, m.id, me(), next); } catch (e) { console.error(e); toast("Couldn't react"); }
  },
  savemem: async (t) => { try { await B.saveMemory(S.cid, t.dataset.id); toast("Saved 💾"); } catch (e) { console.error(e); toast("Couldn't save"); } },
  zoomimg: (t) => { S.viewer = { src: t.src }; render(); },
  closeviewer: () => { S.viewer = null; render(); },
  delmem: async (t) => { if (!confirm("Delete this snap for both of you?")) return; try { gone.add(t.dataset.id); await B.deleteMemory(S.cid, t.dataset.id); S.viewer = null; render(); } catch { toast("Couldn't delete"); } },
  expand: (t) => { S.expanded = S.expanded === t.dataset.ym ? null : t.dataset.ym; render(); },
  push: async () => {
    const r = await B.enablePush(me());
    S.pushMsg = r.ok ? "Reminders are on for this phone ✅" : { "ios-install": "On iPhone, first tap Share → Add to Home Screen, open the app from there, then tap this again.", denied: "Notifications are blocked. Allow them in your phone settings for this app.", unsupported: "This browser doesn't support reminders." }[r.reason] || "Couldn't turn on reminders.";
    render();
  },
  "d-join": () => { B.demo.joinPartner(); }, "d-submit": () => B.demo.partnerSubmit(cycle().ym), "d-note": () => B.demo.partnerNote(), "d-snap": () => B.demo.partnerMemory(), "d-snap-old": () => B.demo.partnerMemory(25), "d-react": () => B.demo.partnerReact(), "d-age": () => B.demo.ageOwn(25), "d-reset": () => B.demo.reset()
};
document.addEventListener("click", (e) => { const t = e.target.closest("[data-act]"); if (t && act[t.dataset.act]) { e.preventDefault(); act[t.dataset.act](t); } });
document.addEventListener("input", (e) => {
  const f = e.target.dataset?.f; if (f) { S.draft[f] = e.target.value; saveDraft(cycle().ym); }
  if (e.target.id === "cap" && S.compose) S.compose.caption = e.target.value;
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "rday") { try { await B.updateCouple(S.cid, { reviewDay: Number(e.target.value) }); toast("Check-in day updated 📅"); } catch { toast("Couldn't update"); } }
});
render();
