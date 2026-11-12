// Receives reminder notifications when the app is closed.
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC6fgzk_-lISHfOMne7GVwU1nRcMYV6e2s",
  authDomain: "monthly-app-3ed7f.firebaseapp.com",
  projectId: "monthly-app-3ed7f",
  storageBucket: "monthly-app-3ed7f.firebasestorage.app",
  messagingSenderId: "62886532672",
  appId: "1:62886532672:web:868babffe969327fcc31a5"
});
// Messages sent with a "notification" payload are shown automatically by the browser.
firebase.messaging();
