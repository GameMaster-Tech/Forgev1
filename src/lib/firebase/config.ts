import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, setLogLevel } from "firebase/firestore";

/**
 * Firebase client init.
 *
 * In normal operation the seven NEXT_PUBLIC_FIREBASE_* env vars are
 * supplied via `.env.local`. For local dev without those, or for E2E
 * runs that intercept all Firebase traffic via Playwright routes, we
 * fall through to a placeholder config so module evaluation doesn't
 * throw — the SDK still loads, calls just no-op or get stubbed.
 *
 * Set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` to connect the Auth +
 * Firestore SDKs to local emulators (default ports 9099 + 8080).
 */

const FALLBACK_API_KEY = "demo-api-key-for-local-or-e2e";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || FALLBACK_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "forge-demo",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "forge-demo.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "0",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:0:web:demo",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

if (process.env.NODE_ENV === "development") {
  setLogLevel("silent");
}

export const auth = getAuth(app);
export const db = getFirestore(app);

// Hook up to local Firebase emulators when asked. Wrapped in
// try/catch because `connect*Emulator` throws if the SDK has already
// performed a network call — safe in dev, paranoid in case of HMR.
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
  try {
    const authHost = process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST ?? "http://localhost:9099";
    const fsHost = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? "localhost:8080";
    const [fsHostname, fsPort] = fsHost.split(":");
    connectAuthEmulator(auth, authHost, { disableWarnings: true });
    connectFirestoreEmulator(db, fsHostname, Number(fsPort) || 8080);
  } catch {
    /* already connected; ignore */
  }
}

export default app;
