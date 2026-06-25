/**
 * Firebase web (client) configuration.
 *
 * These NEXT_PUBLIC_* values are shipped in the browser bundle by design — a
 * Firebase web `apiKey` only identifies the project; access is enforced by
 * Firestore Security Rules + App Check, not by hiding this value. We still load
 * it from environment variables (not hardcoded) so the repository stays free of
 * any keys and passes secret scanning cleanly. Set these in `.env` (local) and
 * in your hosting provider's env (e.g. Vercel) — see `.env.example`.
 */
export const firebaseConfig = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
};
