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

// ---------- state ----------
const S = {
  ready: false, user: null, cid: null, couple: null,
  view: "home", months: {}, goals: [], notes: [], entries: {},
  draft: { liked: "", change: "", improve: "", mood: "🥰" },
  sheet: false, newEmoji: "💬", celebrate: null, toast: "", pushMsg: "", expanded: null, err: ""
};
let unsubs = [];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = (s) => esc(s).replace(/\n/g, "<br>");

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

// ---------- draft ----------
const draftKey = (ym) => `om-draft-${S.cid}-${ym}`;
function loadDraft(ym) {
  try { const d = JSON.parse(localStorage.getItem(draftKey(ym)) || "null"); if (d) S.draft = { liked: "", change: "", improve: "", mood: "🥰", ...d }; } catch {}
}
function saveDraft(ym) { try { localStorage.setItem(draftKey(ym), JSON.stringify(S.draft)); } catch {} }

// ---------- boot ----------
const root = document.getElementById("app");
await B.init();
B.onAuth(async (u) => {
  unsubs.forEach((f) => f && f()); unsubs = [];
  Object.assign(S, { user: u, cid: null, couple: null, months: {}, goals: [], notes: [], entries: {} });
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
}

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
  const tabs = [["home", "🏡", "Home"], ["checkin", "💌", "Check-in"], ["goals", "🌱", "Goals"], ["notes", "💬", "Notes"], ["history", "📖", "Past"]];
  const body = { home: homeView, checkin: checkinView, goals: goalsView, notes: notesView, history: historyView }[S.view]();
  return `
  <header class="top"><div><div class="brand">${APP_NAME}</div><div class="sub">${esc(myName())} 💕 ${esc(pName())}</div></div>
    <button class="icon" data-act="sheet" aria-label="Settings">⚙️</button></header>
  <main class="page">${body}</main>
  <nav class="tabs">${tabs.map(([k, e, l]) => `<button class="${S.view === k ? "on" : ""}" data-act="nav" data-v="${k}"><span>${e}</span>${l}</button>`).join("")}</nav>
  ${S.sheet ? settingsView() : ""}${S.toast ? `<div class="toast">${esc(S.toast)}</div>` : ""}`;
}

function loginView() {
  return `<div class="center"><div class="bigemoji bounce">💌</div><h1>${APP_NAME}</h1>
  <p class="muted">A tiny private place for just the two of you.<br>Share what you loved, what to change and how you're growing, once a month.</p>
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
  const c = cycle(), left = daysLeft();
  const iOSHint = /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone && !DEMO
    ? `<div class="card soft small">📱 On iPhone: tap <b>Share → Add to Home Screen</b>, then open the app from your home screen to get reminders.</div>` : "";
  const lastNote = S.notes.find((n) => n.from !== me());
  const done = complete(S.months[c.ym]);
  let msg = c.open ? (done ? "You both shared! Read it again in Check-in 💞" : iSubmitted(c.ym) ? `Sealed! Waiting for ${esc(pName())}…` : "It's check-in time! Share your thoughts 💌")
    : left === 1 ? "Tomorrow is our check-in day! Get your thoughts ready 💭" : `Next check-in: <b>${dayName(nextReviewDate())}</b>`;
  const cta = c.open && !iSubmitted(c.ym) ? `<button class="btn" data-act="nav" data-v="checkin">Write my check-in</button>`
    : !c.open ? `<button class="btn ghost" data-act="nav" data-v="checkin">Start drafting</button>` : "";
  return `${iOSHint}<section class="card hero">${ring()}<p class="msg">${msg}</p>${pills(c.ym)}${cta}</section>
  <section class="card"><h3>🌱 My goals this month</h3>${S.goals.length ? S.goals.map((g) => { const s = goalStats(g, YM); return `<div class="row"><span class="gi">${esc(g.emoji)}</span><span class="grow">${esc(g.title)}</span><span class="pl">${plant(s.ratio)}</span></div>`; }).join("") : `<p class="muted small">Add things you're working on for each other.</p>`}
  <button class="link" data-act="nav" data-v="goals">Open goals →</button></section>
  ${lastNote ? `<section class="card note"><div class="small muted">Latest from ${esc(pName())}</div><p>${nl(lastNote.text)}</p></section>` : ""}`;
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
  <div class="q">✅ What I worked on for us</div>${snapChips(e.tracker)}</section>`;
}
function checkinView() {
  const c = cycle(), ym = c.ym, mine = S.entries[ym]?.me, theirs = S.entries[ym]?.partner;
  const head = `<h2>${monthName(ym)}${c.late ? " <small>(still open)</small>" : ""}</h2>`;
  if (complete(S.months[ym])) {
    return `${head}${S.celebrate === ym ? `<div class="confetti">🎉💞✨🎊💗</div>` : ""}<p class="muted">You both shared. Here's what each of you wrote 💞</p>
    ${entryCard(`What ${esc(pName())} shared`, theirs, "theirs")}${entryCard("What I shared", mine, "mine")}${!theirs ? `<p class="muted">Opening…</p>` : ""}`;
  }
  if (iSubmitted(ym)) {
    return `${head}<section class="card hero"><div class="bigemoji bounce">💌</div><h3>Sealed &amp; sent</h3>
    <p class="muted">Your thoughts are locked. They open the moment ${esc(pName())} shares theirs too, so neither of you sees anything early.</p>${pills(ym)}</section>
    ${mine ? `<details class="card"><summary>Peek at what I wrote</summary>${entryCard("My check-in", mine, "mine").replace('class="card reveal mine"', 'class="plain"')}</details>` : ""}`;
  }
  const open = c.open, p = esc(pName());
  return `${head}${!open ? `<div class="card soft">✍️ Check-in opens on <b>${dayName(nextReviewDate())}</b>. You can already write your draft, it saves on this phone.</div>` : `<div class="card soft">Be honest and kind. Once you seal it, ${p} can't read it until you've both shared, and you can't edit it.</div>`}
  <section class="card">${field("liked", "💗 What did I love about us this month?", `Things ${p} did that made me smile…`)}
  ${field("change", "🌧️ What would I like to change?", "Something that bothered me, said gently…")}
  ${field("improve", "🌱 What can I improve or handle differently?", "My side of it…")}
  <label class="lbl">How was the month for me?</label><div class="moods">${["🥰", "😊", "😐", "😔", "😤"].map((m) => `<button class="mood ${S.draft.mood === m ? "on" : ""}" data-act="mood" data-m="${m}">${m}</button>`).join("")}</div></section>
  <section class="card"><h3>✅ My goals snapshot</h3>${snapChips(snapshot(ym))}<p class="muted small">${p} will see this when you both share.</p></section>
  <button class="btn" data-act="submit" ${open ? "" : "disabled"}>${open ? "Seal &amp; share 💌" : "Opens on " + dayName(nextReviewDate())}</button>`;
}

function goalsView() {
  const emojis = ["💬", "📵", "🤗", "⏰", "🥗", "🧘", "📚", "💪", "🙏", "🌷"];
  const dim = daysInMonth(YM);
  return `<h2>My goals for us</h2><p class="muted">Little things you're working on for your partner. Tap a day to tick it. ${esc(pName())} sees your month on check-in day.</p>
  ${S.goals.map((g) => { const s = goalStats(g, YM), done = (g.ticks || []).includes(TODAY);
    return `<section class="card"><div class="row"><span class="gi">${esc(g.emoji)}</span><b class="grow">${esc(g.title)}</b><span class="pl big">${plant(s.ratio)}</span></div>
    <div class="bar"><i style="width:${Math.round(Math.min(1, s.days / dim) * 100)}%"></i></div>
    <div class="row"><span class="muted small">${s.days} day${s.days === 1 ? "" : "s"} this month</span><span class="grow"></span>
    <button class="chipbtn ${done ? "on" : ""}" data-act="tick" data-g="${g.id}" data-on="${done ? 0 : 1}">${done ? "✅ Done today" : "Tick today"}</button>
    <button class="link small" data-act="delgoal" data-g="${g.id}">remove</button></div></section>`; }).join("") || `<div class="card soft">No goals yet. Add your first one below 👇</div>`}
  <section class="card"><h3>➕ New goal</h3><div class="moods">${emojis.map((e) => `<button class="mood ${S.newEmoji === e ? "on" : ""}" data-act="emoji" data-e="${e}">${e}</button>`).join("")}</div>
  <input id="gtitle" class="in" maxlength="60" placeholder="e.g. Put my phone away at dinner"><button class="btn" data-act="addgoal">Add goal</button></section>`;
}

function notesView() {
  return `<h2>Little notes</h2><section class="card"><textarea id="ntext" class="in ta" rows="3" maxlength="500" placeholder="Say something sweet…"></textarea><button class="btn" data-act="sendnote">Send 💕</button></section>
  ${S.notes.map((n) => `<div class="bubble ${n.from === me() ? "me" : "them"}">${nl(n.text)}<div class="small muted">${n.from === me() ? "You" : esc(pName())} · ${new Date(n.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div></div>`).join("") || `<p class="muted center-t">No notes yet.</p>`}`;
}

function historyView() {
  const list = Object.keys(S.months).filter((ym) => complete(S.months[ym])).sort().reverse();
  return `<h2>Our past months</h2>${list.length ? list.map((ym) => `<section class="card"><button class="acc" data-act="expand" data-ym="${ym}"><b>${monthName(ym)}</b><span>${S.expanded === ym ? "▲" : "▼"}</span></button>
  ${S.expanded === ym ? `${entryCard(`What ${esc(pName())} shared`, S.entries[ym]?.partner, "theirs")}${entryCard("What I shared", S.entries[ym]?.me, "mine")}` : ""}</section>`).join("") : `<div class="card soft">Your shared months will be saved here after your first check-in together 📖</div>`}`;
}

function settingsView() {
  const code = S.cid.replace(/(.{4})(.{4})/, "$1-$2");
  return `<div class="sheetbg" data-act="sheet"></div><div class="sheet"><h3>Settings</h3>
  <label class="lbl">Check-in day each month</label><select id="rday" class="in" data-act-change="setday">${Array.from({ length: 28 }, (_, i) => `<option ${i + 1 === reviewDay() ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
  <button class="btn ghost" data-act="push">🔔 Turn on reminders on this phone</button>${S.pushMsg ? `<p class="small muted">${esc(S.pushMsg)}</p>` : ""}
  <p class="small muted">Reminders come the day before and on check-in day.</p>
  <p class="small muted">Couple code: <b>${code}</b></p>
  <button class="btn ghost" data-act="logout">Sign out</button><button class="link" data-act="sheet">Close</button></div>`;
}

function demoPanel() {
  const c = cycle().ym;
  return `<div class="demo"><b>demo</b><button data-act="d-join">partner joins</button><button data-act="d-submit">partner submits</button><button data-act="d-note">partner note</button><button data-act="d-reset">reset</button></div>`;
}

// ---------- events ----------
const act = {
  nav: (t) => { S.view = t.dataset.v; S.celebrate = S.view === "checkin" ? S.celebrate : null; render(); window.scrollTo(0, 0); },
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
  submit: async () => {
    const c = cycle(); if (!c.open) return;
    const d = { ...S.draft };
    if (![d.liked, d.change, d.improve].some((x) => x.trim().length > 1)) return toast("Write something first 💭");
    if (!confirm(`Seal your ${monthName(c.ym)} check-in?\n\nYou won't be able to edit it. ${pName()} will only see it once you've both shared.`)) return;
    try {
      await B.submitEntry(S.cid, c.ym, me(), { liked: d.liked.trim(), change: d.change.trim(), improve: d.improve.trim(), mood: d.mood, tracker: snapshot(c.ym) });
      localStorage.removeItem(draftKey(c.ym)); S.entries[c.ym] = {}; await loadEntries(); toast("Sealed 💌");
    } catch (e) { console.error(e); toast("Couldn't save. Please try again."); }
  },
  tick: async (t) => { try { await B.setTick(S.cid, t.dataset.g, TODAY, t.dataset.on === "1"); } catch (e) { toast("Couldn't update"); } },
  addgoal: async () => {
    const el = document.getElementById("gtitle"), v = el.value.trim(); if (!v) return toast("Give your goal a name");
    await B.addGoal(S.cid, me(), { title: v, emoji: S.newEmoji }); el.value = ""; toast("Goal added 🌱");
  },
  delgoal: async (t) => { if (confirm("Remove this goal?")) await B.deleteGoal(S.cid, t.dataset.g); },
  sendnote: async () => { const el = document.getElementById("ntext"), v = el.value.trim(); if (!v) return; await B.addNote(S.cid, me(), v); el.value = ""; },
  expand: (t) => { S.expanded = S.expanded === t.dataset.ym ? null : t.dataset.ym; render(); },
  push: async () => {
    const r = await B.enablePush(me());
    S.pushMsg = r.ok ? "Reminders are on for this phone ✅" : { "ios-install": "On iPhone, first tap Share → Add to Home Screen, open the app from there, then tap this again.", denied: "Notifications are blocked. Allow them in your phone settings for this app.", unsupported: "This browser doesn't support reminders." }[r.reason] || "Couldn't turn on reminders.";
    render();
  },
  "d-join": () => { B.demo.joinPartner(); }, "d-submit": () => B.demo.partnerSubmit(cycle().ym), "d-note": () => B.demo.partnerNote(), "d-reset": () => B.demo.reset()
};
root.addEventListener("click", (e) => { const t = e.target.closest("[data-act]"); if (t && act[t.dataset.act]) { e.preventDefault(); act[t.dataset.act](t); } });
root.addEventListener("input", (e) => { const f = e.target.dataset?.f; if (f) { S.draft[f] = e.target.value; saveDraft(cycle().ym); } });
root.addEventListener("change", async (e) => {
  if (e.target.id === "rday") { try { await B.updateCouple(S.cid, { reviewDay: Number(e.target.value) }); toast("Check-in day updated 📅"); } catch { toast("Couldn't update"); } }
});
render();
