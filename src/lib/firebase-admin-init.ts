import { cert, getApps, initializeApp, type App } from "firebase-admin/app";

let cached: App | null | undefined;

/**
 * Firebase Admin SDK (server-only). Reads service account JSON from
 * `FIREBASE_SERVICE_ACCOUNT_JSON` so API routes can access Firestore without
 * browser auth (avoids PERMISSION_DENIED when rules require `request.auth`).
 */
export function getFirebaseAdminApp(): App | null {
  if (cached !== undefined) return cached;
  if (getApps().length > 0) {
    cached = getApps()[0]!;
    return cached;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    cached = null;
    return null;
  }
  try {
    const cred = JSON.parse(raw) as Record<string, unknown>;
    cached = initializeApp({ credential: cert(cred) });
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
