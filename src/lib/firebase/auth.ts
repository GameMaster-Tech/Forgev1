import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./config";

const googleProvider = new GoogleAuthProvider();

/**
 * Build a per-call provider so we can attach `login_hint` for the
 * multi-account switcher without mutating the shared singleton.
 * Google's OAuth honours `login_hint` — when the hinted email is
 * already in the browser's Google session cookies, the chooser
 * skips the picker and lands the user directly. When it isn't,
 * Google asks for the password.
 */
function googleProviderFor(loginHint?: string): GoogleAuthProvider {
  if (!loginHint) return googleProvider;
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ login_hint: loginHint });
  return p;
}

export async function signUp(email: string, password: string, name: string, discipline: string) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: name });
  await setDoc(doc(db, "users", credential.user.uid), {
    name,
    email,
    discipline,
    plan: "free",
    createdAt: serverTimestamp(),
  });
  return credential.user;
}

export async function signIn(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function signInWithGoogle(loginHint?: string) {
  const credential = await signInWithPopup(auth, googleProviderFor(loginHint));
  const user = credential.user;
  // Create user doc if first sign-in
  await setDoc(
    doc(db, "users", user.uid),
    {
      name: user.displayName || "",
      email: user.email || "",
      plan: "free",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return user;
}

export async function signOut() {
  await firebaseSignOut(auth);
}

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(auth, email);
}

export type { User };
