/**
 * Applies CORS configuration to the Firebase Storage bucket so the web app
 * (https://just-contacts.vercel.app) can upload avatars from the browser.
 *
 * Why this is needed: browser uploads via the Firebase JS SDK send a CORS
 * preflight; without an allowed origin on the bucket the upload is blocked
 * ("blocked by CORS policy"). This is configured on the bucket, not in code.
 *
 * Usage (needs the Firebase Admin service account, which already powers the bot):
 *   # Option A — service account JSON in an env var (same value as in Vercel):
 *   FIREBASE_SERVICE_ACCOUNT_KEY='{...}' node scripts/set-storage-cors.js
 *
 *   # Option B — path to a downloaded service account key file:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/set-storage-cors.js
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const BUCKET = 'studio-1762313498-49470.firebasestorage.app';
const cors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'storage-cors.json'), 'utf8'));

let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY));
} else {
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / application default credentials.
  credential = admin.credential.applicationDefault();
}

admin.initializeApp({ credential, storageBucket: BUCKET });

admin
  .storage()
  .bucket()
  .setCorsConfiguration(cors)
  .then(() => {
    console.log('✅ CORS applied to gs://' + BUCKET);
    console.log(JSON.stringify(cors, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error('❌ Failed to set CORS:', e.message || e);
    process.exit(1);
  });
