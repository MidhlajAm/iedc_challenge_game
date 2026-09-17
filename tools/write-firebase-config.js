// Netlify build step: writes js/firebase-config.js from environment variables,
// so the Firebase config never has to be committed to the repo.
// Runs with plain Node — no npm packages. See netlify.toml.
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

const config = {};
const missing = [];
for (const [key, envName] of Object.entries(variables)) {
  if (process.env[envName]) config[key] = process.env[envName];
  else missing.push(envName);
}

const outFile = path.join(__dirname, '..', 'js', 'firebase-config.js');
if (missing.length > 0) {
  // Don't fail the deploy: the game works without online scores.
  console.warn(`Firebase config incomplete (missing ${missing.join(', ')}). Online scores disabled.`);
  fs.writeFileSync(outFile, 'window.FIREBASE_CONFIG = null;\n');
} else {
  fs.writeFileSync(outFile, `window.FIREBASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
  console.log('Wrote js/firebase-config.js for project', config.projectId);
}
