/**
 * DOI verification + retraction screening.
 *
 * Every citation that flows out of Veritas-R1 is gated on:
 *   1. DOI resolves on Crossref (DOI-validity gate)
 *   2. DOI is not in Retraction Watch DB
 *   3. Publisher is not on the Beall / Cabells predatory list
 *
 * The verifier is retry-safe and returns a structured verdict rather than a
 * boolean so callers can log the failure reason (training signal).
 */

import { crossrefLookupByDoi } from "./crossref";

export type VerdictStatus =
  | "verified"
  | "not-found"
  | "retracted"
  | "suspect-publisher"
  | "error";

export interface VerificationVerdict {
  status: VerdictStatus;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  reason?: string;
  checkedAt: number;
}

export interface Verifier {
  verify(doi: string): Promise<VerificationVerdict>;
}

export interface VerifierOptions {
  /** Domain substrings that mark a publisher as predatory. Override via env or code. */
  predatoryPublishers?: string[];
  /** Set of lower-cased DOIs known to be retracted. Populate from Retraction Watch CSV. */
  retractedDois?: ReadonlySet<string>;
  /** Timeout per lookup, ms. */
  timeoutMs?: number;
}

const DEFAULT_PREDATORY: string[] = [
  // Seeded with publicly-reported problem publishers. Expand via RetractionWatch CSV.
  "omics",
  "scirp",
  "sciencepublishinggroup",
  "academicjournals.org",
];

export function createVerifier(opts: VerifierOptions = {}): Verifier {
  const predatory = (opts.predatoryPublishers ?? DEFAULT_PREDATORY).map((s) => s.toLowerCase());
  const retracted = opts.retractedDois ?? new Set<string>();

  return {
    async verify(doi: string): Promise<VerificationVerdict> {
      const now = Date.now();
      const norm = doi.trim().toLowerCase();
      if (!norm) {
        return { status: "error", reason: "empty-doi", checkedAt: now };
      }

      if (retracted.has(norm)) {
        return {
          status: "retracted",
          doi: norm,
          reason: "present in retraction-watch set",
          checkedAt: now,
        };
      }

      try {
        const source = await crossrefLookupByDoi(norm);
        if (!source) {
          return { status: "not-found", doi: norm, checkedAt: now };
        }
        const pub = source.publisher?.toLowerCase() ?? "";
        if (predatory.some((p) => pub.includes(p))) {
          return {
            status: "suspect-publisher",
            doi: norm,
            title: source.title,
            authors: source.authors,
            year: source.year,
            journal: source.venue,
            publisher: source.publisher,
            reason: `publisher matched predatory list: ${source.publisher}`,
            checkedAt: now,
          };
        }
        return {
          status: "verified",
          doi: norm,
          title: source.title,
          authors: source.authors,
          year: source.year,
          journal: source.venue,
          publisher: source.publisher,
          checkedAt: now,
        };
      } catch (err) {
        return {
          status: "error",
          doi: norm,
          reason: err instanceof Error ? err.message : String(err),
          checkedAt: now,
        };
      }
    },
  };
}
