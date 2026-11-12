# Our Monthly: setup guide

Everything here runs on Firebase's **free (Spark) plan**. Do not upgrade to a paid plan.

## 0. Check your Firebase console (once)
In https://console.firebase.google.com open your project "Monthly App":
1. **Build > Authentication > Sign-in method**: Google must be **Enabled**.
2. **Build > Firestore Database**: the database must exist (location asia-south1).

## 1. Put the app online (on your computer)
1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal / command prompt inside this folder (the one containing `firebase.json`) and run:
   ```
   npm install -g firebase-tools
   firebase login
   firebase deploy --only hosting,firestore:rules
   ```
3. When it finishes it prints a **Hosting URL** like `https://monthly-app-3ed7f.web.app`. That is your app.
   - If it says the Hosting site doesn't exist: Console > Build > Hosting > "Get started" > click through, then run the deploy again.
4. To update the app later after any change, just run the same deploy command again.

## 2. Install it on both phones
- **Android (you):** open the URL in Chrome > menu (⋮) > **Install app** / Add to Home screen.
- **iPhone (her):** open the URL in **Safari** > Share button > **Add to Home Screen**. Always open the app from the home screen icon (needed for iPhone reminders; iOS 16.4 or newer).
- One of you taps **Create our couple** and sends the code. The other signs in and taps **Join**.

## 3. Turn on reminders (both phones)
In the app: ⚙️ > **Turn on reminders on this phone** > Allow.

### 3b. The scheduled reminder job (free, via GitHub)
Reminders on the 18th and 19th are sent by a small daily job on GitHub Actions.
1. Create a free GitHub account and a **private** repository. Upload this whole folder to it.
2. Firebase console > ⚙️ Project settings > **Service accounts** > **Generate new private key**. A JSON file downloads.
   - Treat it like a password. Never send it to anyone (including me) or put it in the code.
3. GitHub repo > Settings > Secrets and variables > Actions > **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: paste the **entire contents** of the JSON file.
4. GitHub repo > **Actions** tab > "Monthly reminders" > **Run workflow**, tick **test**, run. Both phones should get "Test notification".
5. After that it runs by itself every day at 9:00 AM India time. It only sends on the day before and on check-in day, plus a nudge for up to 3 days to whoever hasn't sealed yet.

## 4. Check that the lock really works (5 minutes, please do this once)
Use two different Google accounts (your own + a second one, or you and her):
1. Both join the same couple. Write your check-in on **your** phone and tap **Seal**.
2. On **her** phone, open Check-in: she must see **nothing** of yours, just "waiting".
3. Now she seals hers. Both phones should immediately show each other's answers.
4. Extra proof: Console > Firestore Database > Rules > **Rules playground**. Simulate a `get` on
   `/databases/(default)/documents/couples/<CODE>/months/<YYYY-MM>/entries/<her uid>` as authenticated as **your** uid before she has sealed. It must be **denied**.

## Notes
- Preview the screens without any setup: open `index.html` through a local server with `?demo=1` (e.g. `?demo=1&today=2026-11-19`). Demo data stays on that device only.
- Check-in day defaults to the 19th. Change it in ⚙️ (1 to 28).
- Check-in unlocks to *submit* on the check-in day; before that you can write a draft (saved on the phone).
- Sealed check-ins can't be edited or deleted by either of you (by design).
