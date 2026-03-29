import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  /** Required for Realtime Database. */
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
};

function createFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) {
    return getApp();
  }

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error(
      "Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* keys to .env.local (see .env.example).",
    );
  }

  if (!firebaseConfig.databaseURL) {
    throw new Error(
      "NEXT_PUBLIC_FIREBASE_DATABASE_URL is required (Realtime Database URL from Firebase console).",
    );
  }

  return initializeApp(firebaseConfig);
}

export const app = createFirebaseApp();

export const db: Firestore = getFirestore(app);

export const rtdb: Database = getDatabase(app);
