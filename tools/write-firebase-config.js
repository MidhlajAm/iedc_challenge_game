// Firebase settings from environment variables, so the config never has
// to be committed to the repo. tools/build.js writes the result into
// dist/js/firebase-config.js on every deploy.
//
// Run directly (`node tools/write-firebase-config.js`) to write the local
// js/firebase-config.js instead. Plain Node, no npm packages.
const fs = require('fs');
const path = require('path');

const variables = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
  appId: 'FIREBASE_APP_ID',
};

/** The contents of firebase-config.js for the current environment. */
function firebaseConfigFile() {
  const config = {};
  const missing = [];
  for (const [key, envName] of Object.entries(variables)) {
    if (process.env[envName]) config[key] = process.env[envName];
    else missing.push(envName);
  }

  if (missing.length > 0) {
    // Don't fail the deploy: the game works without online scores.
    console.warn(`Firebase config incomplete (missing ${missing.join(', ')}). Online scores disabled.`);
    return 'window.FIREBASE_CONFIG = null;\n';
  }
  console.log('Firebase config written for project', config.projectId);
  return `window.FIREBASE_CONFIG = ${JSON.stringify(config)};\n`;
}

module.exports = { firebaseConfigFile };

// Called directly: write the local file used by `python -m http.server`
if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, '..', 'js', 'firebase-config.js'), firebaseConfigFile());
}
