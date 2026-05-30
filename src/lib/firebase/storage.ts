/**
 * Firebase Storage — editor image/file uploads.
 *
 * Uploads land under a per-user, per-document prefix so Storage rules can
 * gate them on `request.auth.uid`. The public download URL is returned
 * and embedded in the document HTML, so the image survives reloads and
 * renders for anyone with read access to the doc.
 *
 * Graceful fallback: if Storage is unreachable or unconfigured, the
 * caller can fall back to an inline data URL (see `fileToDataUrl`) so the
 * image still appears and persists — the writing flow never breaks.
 */

import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import app from "./config";

const storage = getStorage(app);

/** Image MIME types we accept for inline embedding. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

/** Max bytes we'll fall back to a data URL for (keeps doc HTML sane). */
export const MAX_DATA_URL_BYTES = 1_500_000;

export function isUploadableImage(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(file.type) || file.type.startsWith("image/");
}

function safeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "file"
  );
}

/**
 * Upload a file to Storage and return its public download URL. Throws on
 * failure so the caller can decide whether to fall back.
 */
export async function uploadEditorFile(
  userId: string,
  docId: string,
  file: File,
): Promise<string> {
  const path = `user-uploads/${userId}/${docId}/${Date.now()}-${safeName(file.name)}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type || "application/octet-stream" });
  return getDownloadURL(r);
}

/** Read a file as a base64 data URL (the offline / unconfigured fallback). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export interface UploadResult {
  url: string;
  /** True when we fell back to an inline data URL (Storage unavailable). */
  fallback: boolean;
}

/**
 * Upload with graceful fallback: try Storage first; on failure fall back
 * to an inline data URL for small files. Returns null when the file is
 * too large to inline and Storage failed — caller surfaces an error.
 */
export async function uploadImageWithFallback(
  userId: string,
  docId: string,
  file: File,
): Promise<UploadResult | null> {
  try {
    const url = await uploadEditorFile(userId, docId, file);
    return { url, fallback: false };
  } catch (err) {
    console.warn("Storage upload failed; attempting data-URL fallback:", err);
    if (file.size <= MAX_DATA_URL_BYTES) {
      try {
        const url = await fileToDataUrl(file);
        return { url, fallback: true };
      } catch {
        return null;
      }
    }
    return null;
  }
}
