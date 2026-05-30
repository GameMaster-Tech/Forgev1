"use client";

/**
 * Aria stream parser — separates Aria's natural-language speech from the inline
 * `<<do:TYPE {json}>>` action directives as tokens stream in. Directives are
 * emitted the instant they're complete (so the client can execute optimistically
 * mid-stream); a trailing partial opener is held back until more arrives, so a
 * directive split across chunks is never mis-spoken.
 */

import { ALL_ACTION_TYPES, type VoiceAction, type VoiceActionType } from "./types";

const OPENER = "<<do:";
const CLOSER = ">>";

const KNOWN: VoiceActionType[] = ALL_ACTION_TYPES;

export interface ParseChunk {
  /** Clean speech text safe to display / speak now. */
  text: string;
  /** Complete directives parsed in this chunk, in order. */
  directives: VoiceAction[];
}

function parseToken(token: string): VoiceAction | null {
  const m = /^([a-z_]+)\s*(\{[\s\S]*\})?$/i.exec(token.trim());
  if (!m) return null;
  const type = m[1] as VoiceActionType;
  if (!KNOWN.includes(type)) return null;
  let params: Record<string, unknown> = {};
  if (m[2]) {
    try {
      params = JSON.parse(m[2]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return { type, ...params } as VoiceAction;
}

/** Largest length safe to emit without cutting a trailing partial opener. */
function safeEmitLen(buf: string): number {
  for (let k = Math.min(OPENER.length - 1, buf.length); k > 0; k--) {
    if (buf.endsWith(OPENER.slice(0, k))) return buf.length - k;
  }
  return buf.length;
}

export class DirectiveParser {
  private buf = "";

  push(chunk: string): ParseChunk {
    this.buf += chunk;
    let text = "";
    const directives: VoiceAction[] = [];

    for (;;) {
      const start = this.buf.indexOf(OPENER);
      if (start === -1) {
        const safe = safeEmitLen(this.buf);
        text += this.buf.slice(0, safe);
        this.buf = this.buf.slice(safe);
        break;
      }
      text += this.buf.slice(0, start);
      const end = this.buf.indexOf(CLOSER, start + OPENER.length);
      if (end === -1) {
        // Incomplete directive — wait for more.
        this.buf = this.buf.slice(start);
        break;
      }
      const token = this.buf.slice(start + OPENER.length, end);
      const dir = parseToken(token);
      if (dir) directives.push(dir);
      this.buf = this.buf.slice(end + CLOSER.length);
    }

    return { text, directives };
  }

  /** Emit whatever remains (drop any dangling partial opener). */
  flush(): ParseChunk {
    const remaining = this.buf;
    this.buf = "";
    const start = remaining.indexOf(OPENER);
    const text = start === -1 ? remaining : remaining.slice(0, start);
    return { text, directives: [] };
  }
}
