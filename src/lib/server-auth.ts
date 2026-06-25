import { getAdmin } from '@/lib/firebase-admin';

/**
 * Verifies a Firebase ID token passed from the client to a server action.
 * Throws on missing/invalid token. Returns the caller's UID.
 *
 * Note: verifyIdToken only needs Google's public certs, so it works locally
 * even without FIREBASE_SERVICE_ACCOUNT_KEY (projectId-only Admin init).
 */
export async function requireAuth(idToken: string | undefined | null): Promise<string> {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Unauthorized: missing auth token');
  }
  try {
    const fb = getAdmin();
    const decoded = await fb.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (e) {
    console.warn('Auth token verification failed:', e instanceof Error ? e.message : e);
    throw new Error('Unauthorized: invalid auth token');
  }
}
