/**
 * Firebase Admin SDK — server-side only.
 *
 * Lazy initializer that survives Next.js dev hot-reload (which re-evaluates
 * module top-level code on every change). The admin SDK auto-detects
 * credentials via the standard chain:
 *   1. GOOGLE_APPLICATION_CREDENTIALS env pointing at a service-account JSON
 *   2. Workload Identity (Cloud Run / GKE)
 *   3. gcloud user creds (local dev)
 *
 * Server-only — never import this from a client component or `"use client"` file.
 * The runtime asserts via the `import 'server-only'` pragma when bundled.
 */

import "server-only";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let _app: App | null = null;

export function getAdminApp(): App {
  if (_app) return _app;
  const existing = getApps();
  if (existing.length > 0) {
    _app = existing[0];
    return _app;
  }
  // Inline service account via env (fallback for envs without
  // GOOGLE_APPLICATION_CREDENTIALS). Useful for Vercel / Fly.
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    const parsed = JSON.parse(inline) as ServiceAccount;
    _app = initializeApp({
      credential: cert(parsed),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
    return _app;
  }
  // ADC chain (recommended in production).
  _app = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
  return _app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}
