// Sends the monthly reminder notifications. Runs once a day on GitHub Actions (free).
//   node send.mjs          -> normal daily run
//   node send.mjs --test   -> sends a test notification to every registered phone
import admin from "firebase-admin";

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const TEST = process.argv.includes("--test");

// "Today" in India (IST = UTC+5:30), whatever the server's clock says
const ist = new Date(Date.now() + 5.5 * 3600e3);
const day = ist.getUTCDate();
const tomorrowDay = new Date(ist.getTime() + 864e5).getUTCDate();
const ym = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
console.log(`IST date: ${ym}-${String(day).padStart(2, "0")}${TEST ? " (test mode)" : ""}`);

async function push(uids, title, body) {
  for (const uid of uids) {
    const ref = db.collection("users").doc(uid);
    const tokens = (await ref.get()).data()?.fcmTokens || [];
    if (!tokens.length) { console.log(`  ${uid}: no phone registered`); continue; }
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: { fcmOptions: { link: "/" }, notification: { icon: "/icons/icon-192.png" } }
    });
    const dead = [];
    res.responses.forEach((r, i) => {
      if (!r.success && ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(r.error?.code)) dead.push(tokens[i]);
    });
    if (dead.length) await ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead) });
    console.log(`  ${uid}: sent ${res.successCount}/${tokens.length}`);
  }
}

const couples = await db.collection("couples").get();
for (const c of couples.docs) {
  const { members = [], reviewDay = 19 } = c.data();
  if (members.length < 2) continue;
  console.log(`couple ${c.id} (check-in day ${reviewDay})`);
  if (TEST) { await push(members, "Our Monthly 💌", "Test notification: reminders are working!"); continue; }

  if (tomorrowDay === reviewDay) {
    await push(members, "Tomorrow is our check-in day 💌", "Take a minute to think about what you loved and what to improve.");
  } else if (day === reviewDay) {
    await push(members, "It's check-in day! 💞", "Share your thoughts. You'll both see each other's once you've both sealed yours.");
  } else if (day > reviewDay && day <= reviewDay + 3) {
    const m = (await c.ref.collection("months").doc(ym).get()).data() || {};
    const waiting = members.filter((u) => !m["s_" + u]);
    const sealed = members.filter((u) => m["s_" + u]);
    if (waiting.length) {
      await push(waiting, sealed.length ? "Your partner is waiting for you 💌" : "Don't forget our check-in 💌",
        sealed.length ? "They've already sealed theirs. Share yours to unlock both." : "It only takes a few minutes.");
    }
  }
}
console.log("done");
