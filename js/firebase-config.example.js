// Template for js/firebase-config.js (which is gitignored).
//
// Local testing: copy this file to js/firebase-config.js and fill in the
// values from Firebase console → Project settings → Your apps → Web app.
//
// Netlify: don't create the file by hand. Set these environment variables
// in Site configuration → Environment variables, and the build step
// (tools/write-firebase-config.js) writes the file on every deploy:
//   FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
//   FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID
//
// If the file is missing, the game still works — scores just stay on the phone.
window.FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};
