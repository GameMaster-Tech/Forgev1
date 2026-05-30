"use client";

/**
 * Voice chat persistence — every Aria turn (what the user said + what Aria
 * replied + which actions ran) is saved so the conversation is never lost.
 *
 * Reads are equality-only on userId (Firestore's automatic single-field index)
 * with client-side sort, so history loads even before the composite index is
 * deployed — but the composite index (userId, createdAt) is declared in
 * firestore.indexes.json for the chronological server query.
 */

import {
  addDoc,
  collection,
  getDocs,
  limit as fbLimit,
  query,
  serverTimestamp,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./config";

export interface VoiceMessage {
  id: string;
  userId: string;
  transcript: string;
  reply: string;
  actions: string[];
  createdAt: Timestamp | null;
}

/** Save one Aria exchange. Best-effort — never throws into the voice flow. */
export async function saveVoiceMessage(
  userId: string,
  data: { transcript: string; reply: string; actions?: string[] },
): Promise<void> {
  if (!userId || !data.transcript.trim()) return;
  try {
    await addDoc(collection(db, "voiceMessages"), {
      userId,
      transcript: data.transcript.slice(0, 2000),
      reply: data.reply.slice(0, 4000),
      actions: (data.actions ?? []).slice(0, 20),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[voiceChats] save failed:", err);
  }
}

/** Load recent voice history (newest first), index-free. */
export async function getVoiceMessages(userId: string, max = 100): Promise<VoiceMessage[]> {
  if (!userId) return [];
  try {
    const snap = await getDocs(
      query(collection(db, "voiceMessages"), where("userId", "==", userId), fbLimit(300)),
    );
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VoiceMessage);
    const ms = (m: VoiceMessage) => {
      const ts = m.createdAt as { toMillis?: () => number } | null;
      return typeof ts?.toMillis === "function" ? ts.toMillis() : 0;
    };
    rows.sort((a, b) => ms(b) - ms(a));
    return rows.slice(0, max);
  } catch (err) {
    console.warn("[voiceChats] read failed:", err);
    return [];
  }
}
