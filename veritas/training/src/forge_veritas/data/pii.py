"""PII scrubbing — regex pass before training data leaves Firestore.

Why this lives in the data pipeline (not in Firestore rules)
────────────────────────────────────────────────────────────
Forge users WILL paste private context into their research workspace —
collaborator emails, session URLs with tokens, sometimes OpenAI keys.
Storing those in Firestore is fine (the user owns them; rules enforce per-
project access). Training a foundation model on them is **not** — once
weights memorise an email address it's effectively impossible to extract.

So we scrub at the export boundary. This is the production-stack pattern:
OpenAI's pretraining pipeline does it, AI2's OLMo-3 data prep does it,
Anthropic's data pipeline does it. The scrub is **best-effort** — we use
permissive regexes and tolerate false positives (replacing a string that
isn't really an email is harmless) over false negatives (leaking a real one).

Patterns covered
────────────────
    • Email addresses
    • US phone numbers (loose)
    • US SSN
    • API-key-shaped strings (sk-…, ghp_…, etc.)
    • IPv4 + IPv6 addresses
    • JWT-shaped tokens (3 dot-separated base64 segments)
    • Credit-card-shaped digit runs

Patterns deliberately NOT covered
─────────────────────────────────
    • Person names — would scrub author names from cited papers, which
      destroys training value. We accept the residual risk; user-tagged
      PII fields go through a separate review workflow at CP10.
    • Postal addresses — too noisy without a real NER model.
"""

from __future__ import annotations

import re
from typing import Final

# Token used to replace each PII match. Chose a UTF-8-safe sentinel that's
# unlikely to appear in research prose so the trainer can use it as a soft
# signal of "redacted information was here, don't try to fill it in."
REDACTION: Final[str] = "[REDACTED]"


# Order matters — earlier patterns shadow later ones. Email > phone is
# important because phone-shaped digits inside an email's username should
# stay part of the email match.
_PII_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Email
    re.compile(
        r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}\b"
    ),
    # JWT-shaped (header.payload.signature, all base64url)
    re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]{10,}\b"),
    # OpenAI / GitHub / Anthropic / generic api keys.
    # The trailing class allows underscores and hyphens so vendor formats
    # like `sk-ant-api03-…` and `github_pat_…_…` match in one shot.
    re.compile(
        r"\b(?:sk|pk|gho|ghp|ghs|gh[aor]|github_pat|sk-ant|ak|aws|api[_-]?key)[_-][A-Za-z0-9_\-]{20,}\b",
        re.IGNORECASE,
    ),
    # Bearer tokens written inline
    re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{20,}\b", re.IGNORECASE),
    # SSN
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    # Credit card — 13-19 digit runs with optional separators
    re.compile(r"\b(?:\d[ -]?){13,19}\b"),
    # US phone — loose
    re.compile(r"\b(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b"),
    # IPv4
    re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    # IPv6 (loose — covers most real cases without false-positive disasters)
    re.compile(r"\b(?:[A-Fa-f0-9]{1,4}:){5,7}[A-Fa-f0-9]{1,4}\b"),
)


def scrub_text(text: str) -> str:
    """Return the input with every PII match replaced by `REDACTION`.

    Idempotent — `scrub_text(scrub_text(x)) == scrub_text(x)`.
    """
    if not text:
        return text
    for pat in _PII_PATTERNS:
        text = pat.sub(REDACTION, text)
    return text


def scrub_in_place(obj: object) -> None:
    """Walk a JSON-serialisable structure mutating every string value."""
    if isinstance(obj, dict):
        for k, v in list(obj.items()):
            if isinstance(v, str):
                obj[k] = scrub_text(v)
            else:
                scrub_in_place(v)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, str):
                obj[i] = scrub_text(v)
            else:
                scrub_in_place(v)
