import admin from 'firebase-admin';

// Overridable per-deployment; falls back to the original project for local/dev use.
const EXPECTED_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'studio-1762313498-49470';

/**
 * Initializes and returns the Firebase Admin SDK singleton.
 * Shared between auth and bot webhook routes.
 */
export function getAdmin() {
  if (admin.apps.length === 0) {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (serviceAccountKey) {
      try {
        const serviceAccount = JSON.parse(serviceAccountKey);
        console.log('Firebase Admin: initializing with service account for project:', serviceAccount.project_id);
        
        if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
          console.error(
            `⚠️ SERVICE ACCOUNT PROJECT MISMATCH! Expected "${EXPECTED_PROJECT_ID}" but got "${serviceAccount.project_id}".`
          );
        }
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } catch (e) {
        console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e);
        admin.initializeApp({ projectId: EXPECTED_PROJECT_ID });
      }
    } else {
      try {
        admin.initializeApp();
      } catch {
        admin.initializeApp({ projectId: EXPECTED_PROJECT_ID });
      }
    }
  }
  return admin;
}

/**
 * Derives the Firebase UID from a Telegram user ID.
 * Must match the format used in auth/telegram/route.ts.
 */
export function telegramIdToUid(telegramId: number | string): string {
  return `tg_${telegramId}`;
}
