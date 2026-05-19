/**
 * JSON adapter — lossless. The manifest is the source of truth, so
 * we just round-trip it.
 */

import type { ExportAdapter, ExportManifest } from "./types";

export async function serialiseJson(manifest: ExportManifest): Promise<string> {
  return JSON.stringify(manifest, null, 2);
}

export async function parseJson(raw: string): Promise<ExportManifest> {
  return JSON.parse(raw) as ExportManifest;
}

export const jsonAdapter: ExportAdapter = {
  format: "json",
  contentType: "application/json",
  extension: "json",
  serialise: serialiseJson,
  parse: parseJson,
};
