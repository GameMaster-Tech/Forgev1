"""Episode-log → SFT JSONL exporter (CP3).

What this module does
─────────────────────
Pulls Veritas episodes + claims out of Firestore, transforms each episode
into the training-ready chat-message form (using the Python-mirrored CP2
chat template), and writes the result as JSONL shards under
`data/sft/<run-id>/`. CP5 packs these shards into the format SFTTrainer
consumes; CP6 trains on them.

Two operating modes
───────────────────
1. **Live Firestore** (`source="firestore"`) — production path. Uses
   `firebase-admin` to authenticate via a service-account JSON, pulls the
   latest episodes per project, and resolves referenced claim ids in
   batches of 10 (Firestore's `get_all` cap).
2. **Fixture file** (`source="fixture"`) — test + dev path. Reads a JSON
   file with the same shape Firestore would return. Lets us exercise the
   exporter end-to-end without standing up an emulator and is what CP3's
   exit criteria check ("smoke run on emulator dump produces ≥1 valid
   shard") actually tests.

Efficiency budget
─────────────────
    • Streaming JSONL writes — never accumulate full output in memory.
    • Multi-shard output (default 1024 examples/shard) for parallel data
      loading at training time. Smaller shards = better shuffling at SFT.
    • Batched claim fetches — Firestore `get_all` takes up to 10 refs at a
      time; we batch on chunks of 10 and dedupe ids first.
    • orjson when available, stdlib `json` as fallback. orjson is 3-5×
      faster on JSONL workloads of this shape.
    • Deterministic ordering — sort episodes by `(projectId, timestamp)`
      so the same input data produces the same output bytes. Caching +
      dedup at CP5 depend on this.
    • Token estimate via fast char/4 heuristic — accurate enough for the
      sequence-length filtering CP5 does. Skip tiktoken (heavy dep).

PII discipline
──────────────
Every text field that crosses the boundary into JSONL goes through
`pii.scrub_text` first. See `pii.py` for what is and isn't covered.

Output shape — `SFTExample` (mirrored in TS at `training-format/sft-example.ts`)
──────────────────────────────────────────────────────────────────────────────
    {
      "id": "epi-...",                  episode id
      "project_id": "proj-...",         partition key
      "schema_version": "v1",           bump on breaking format change
      "mode": "lightning|reasoning|deep",
      "messages": [...],                ChatMessage[] — what tokenizer eats
      "citations": ["clm-..."],         claim ids the episode referenced
      "claims_context": {               id → atomic_assertion lookup so the
        "clm-...": "..."                trainer can build memory_recall
      },                                tool results from the same source
      "tokens_estimate": 1234,
      "created_at": "2026-04-26T..."    episode timestamp (NOT export time)
    }

Reproducibility — the same inputs (Firestore snapshot or fixture) always
produce identical shards. Run-id is content-hashed unless overridden.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import logging
import os
import sys
import time
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

# orjson is optional — fall back to stdlib json if missing. The test path
# can run without it; production training boxes have it pinned.
try:
    import orjson  # type: ignore[import-not-found]

    _HAVE_ORJSON = True
except ImportError:
    _HAVE_ORJSON = False

from forge_veritas.data import chat_template as ct
from forge_veritas.data import pii

log = logging.getLogger("forge_veritas.firestore_export")

SCHEMA_VERSION = "v1"
DEFAULT_SHARD_SIZE = 1024
FIRESTORE_BATCH_GET_CAP = 10  # Firestore-imposed limit on get_all()


# ─────────────────────────────────────────────────────────────────────
#  Output dataclass
# ─────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class SFTExample:
    id: str
    project_id: str
    mode: Literal["lightning", "reasoning", "deep"]
    messages: list[ct.ChatMessage]
    citations: list[str]
    claims_context: dict[str, str]
    tokens_estimate: int
    created_at: str
    schema_version: str = SCHEMA_VERSION

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "schema_version": self.schema_version,
            "mode": self.mode,
            "messages": [m.to_json() for m in self.messages],
            "citations": list(self.citations),
            "claims_context": dict(self.claims_context),
            "tokens_estimate": self.tokens_estimate,
            "created_at": self.created_at,
        }


# ─────────────────────────────────────────────────────────────────────
#  Mode inference + token estimation — both fast, both deterministic.
# ─────────────────────────────────────────────────────────────────────


def infer_mode(trace: ct.ThoughtTrace | None) -> Literal["lightning", "reasoning", "deep"]:
    """Pick a Forge UI mode for an episode based on its trace shape.

    Heuristic — same one CP14 will use at inference to default-route a
    request when the user hasn't picked a mode explicitly:

    * No trace, or trace with only an answer step → `lightning`
      (chat-only; the SFT mix needs ~30% lightning examples to keep the
      model snappy in the default UI mode).
    * Trace with tool calls OR more than 5 think steps → `deep`
      (long-context synthesis; ≤10% of mix).
    * Everything else → `reasoning` (default; ~60% of mix).
    """
    if trace is None or not trace.steps:
        return "lightning"

    has_tool_call = any(
        s.kind in ("retrieve", "verify", "tool-call", "recall") for s in trace.steps
    )
    think_count = sum(1 for s in trace.steps if s.kind in ("think", "decide"))

    if not has_tool_call and think_count == 0:
        return "lightning"
    if has_tool_call or think_count > 5:
        return "deep"
    return "reasoning"


def estimate_tokens(messages: list[ct.ChatMessage]) -> int:
    """Char/4 heuristic — fast and accurate-enough for sequence-length
    filtering. We measure on the JSON-encoded form because that's what
    the tokenizer's chat template ultimately sees.
    """
    total_chars = 0
    for m in messages:
        total_chars += len(m.role) + 2
        total_chars += len(m.content)
        if m.reasoning_content:
            total_chars += len(m.reasoning_content)
        if m.tool_calls:
            for tc in m.tool_calls:
                total_chars += len(tc.function_name) + len(tc.arguments) + 16
        if m.tool_call_id:
            total_chars += len(m.tool_call_id)
    # +20% safety margin — char/4 underestimates on text with many short tokens.
    return (total_chars // 4) + (total_chars // 20)


# ─────────────────────────────────────────────────────────────────────
#  Episode → SFTExample
# ─────────────────────────────────────────────────────────────────────


def episode_to_example(
    episode: dict[str, Any],
    claims_by_id: dict[str, dict[str, Any]],
    *,
    system_prompt: str | None = None,
    scrub_pii: bool = True,
) -> SFTExample | None:
    """Convert a single Firestore Episode (+ its referenced claims) into an
    SFTExample. Returns None if the episode is malformed or has no useful
    training signal — callers should drop those silently.

    Malformed cases handled:
      • No `input` text → drop
      • No `output` AND no answer step in trace → drop (nothing to learn)
      • Trace contains a step that fails schema's well-formedness guard → drop
    """
    user_input = episode.get("input")
    if not isinstance(user_input, str) or not user_input.strip():
        return None

    raw_trace = episode.get("thoughtTrace")
    trace = _decode_trace(raw_trace) if isinstance(raw_trace, dict) else None

    output = episode.get("output") or ""
    # If the trace doesn't already end in an answer step but we have a
    # standalone `output`, synthesise the closing answer step. This is the
    # common case for episodes recorded before structured tracing landed.
    if trace and trace.steps and trace.steps[-1].kind != "answer" and output:
        trace.steps.append(
            ct.ThoughtStep(kind="answer", text=output, index=len(trace.steps))
        )
    elif not trace and output:
        trace = ct.ThoughtTrace(
            steps=[ct.ThoughtStep(kind="answer", text=output, index=0)]
        )

    if not trace or not trace.steps:
        return None

    mode = infer_mode(trace)
    messages = ct.trace_to_chatml(
        trace, user_input=user_input, system_prompt=system_prompt, mode=mode
    )
    if scrub_pii:
        for m in messages:
            m.content = pii.scrub_text(m.content)
            if m.reasoning_content:
                m.reasoning_content = pii.scrub_text(m.reasoning_content)

    citations = [
        c for c in episode.get("claimsReferenced", []) if isinstance(c, str)
    ]

    claims_context: dict[str, str] = {}
    for cid in citations:
        c = claims_by_id.get(cid)
        if c is None:
            continue
        atomic = c.get("atomicAssertion")
        if isinstance(atomic, str) and atomic:
            claims_context[cid] = pii.scrub_text(atomic) if scrub_pii else atomic

    return SFTExample(
        id=str(episode.get("id", "")),
        project_id=str(episode.get("projectId", "")),
        mode=mode,
        messages=messages,
        citations=citations,
        claims_context=claims_context,
        tokens_estimate=estimate_tokens(messages),
        created_at=str(episode.get("timestamp", "")),
    )


def _decode_trace(raw: dict[str, Any]) -> ct.ThoughtTrace | None:
    """Decode the `ThoughtTrace` object stored on an Episode doc.

    Accepts either the canonical schema shape (`{steps: [{kind, index, ...}]}`)
    or the slight variations Forge wrote in earlier Phase-1 commits.
    """
    raw_steps = raw.get("steps")
    if not isinstance(raw_steps, list):
        return None
    steps: list[ct.ThoughtStep] = []
    for raw_step in raw_steps:
        if not isinstance(raw_step, dict):
            continue
        kind = raw_step.get("kind")
        if kind not in (
            "think",
            "recall",
            "retrieve",
            "verify",
            "tool-call",
            "decide",
            "answer",
        ):
            continue
        steps.append(
            ct.ThoughtStep(
                kind=kind,
                index=int(raw_step.get("index", len(steps))),
                text=raw_step.get("text"),
                recalled_claims=_str_list(raw_step.get("recalledClaims")),
                recalled_episodes=_str_list(raw_step.get("recalledEpisodes")),
                tool=raw_step.get("tool"),
                tool_input=raw_step.get("toolInput"),
                tool_output=raw_step.get("toolOutput"),
                confidence=raw_step.get("confidence"),
            )
        )
    return ct.ThoughtTrace(steps=steps)


def _str_list(v: Any) -> list[str] | None:
    if not isinstance(v, list):
        return None
    out = [x for x in v if isinstance(x, str)]
    return out if out else None


# ─────────────────────────────────────────────────────────────────────
#  Source readers — Firestore + fixture
# ─────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class SourceData:
    """In-memory carrier for whatever the source surfaces.

    Episodes is a sorted list (project_id, timestamp ASC); claims_by_id is
    a dict keyed by claim id covering exactly the claims referenced.
    """

    episodes: list[dict[str, Any]]
    claims_by_id: dict[str, dict[str, Any]]


def load_fixture(path: str | os.PathLike[str]) -> SourceData:
    """Fixture loader — reads a JSON file with shape:

        {
          "episodes": [Episode, ...],
          "claims":   [Claim, ...]
        }

    Used by tests + dev. The Firestore exporter writes its raw dump in the
    same shape so a bad production export can be re-run on a saved snapshot.
    """
    with open(path, "rb") as fh:
        data = _jsonloads(fh.read())
    episodes = data.get("episodes", [])
    claims = data.get("claims", [])
    if not isinstance(episodes, list) or not isinstance(claims, list):
        raise ValueError(f"fixture must have list-shaped episodes/claims: {path}")
    claims_by_id = {c["id"]: c for c in claims if isinstance(c, dict) and "id" in c}
    episodes_sorted = sorted(
        (e for e in episodes if isinstance(e, dict)),
        key=lambda e: (e.get("projectId", ""), e.get("timestamp", "")),
    )
    return SourceData(episodes=episodes_sorted, claims_by_id=claims_by_id)


def load_firestore(
    *,
    project_ids: list[str] | None = None,
    service_account_path: str | None = None,
    after_timestamp: str | None = None,
) -> SourceData:
    """Pull from live Firestore. Imports firebase-admin lazily so the
    module imports cleanly in environments that don't have the SDK
    installed (CI with python -c, this CP3 smoke test, etc.).
    """
    try:
        import firebase_admin  # type: ignore[import-not-found]
        from firebase_admin import credentials, firestore  # type: ignore[import-not-found]
    except ImportError as e:
        raise RuntimeError(
            "firestore_export requires `firebase-admin`. "
            "Install via `pip install firebase-admin` or pass `--source fixture`."
        ) from e

    if not firebase_admin._apps:  # type: ignore[attr-defined]
        if service_account_path:
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
        else:
            # ADC — works on Modal / Cloud Run / explicitly-set GOOGLE_APPLICATION_CREDENTIALS.
            firebase_admin.initialize_app()
    db = firestore.client()

    eps_ref = db.collection("veritasEpisodes")
    query = eps_ref
    if after_timestamp:
        query = query.where("timestamp", ">", after_timestamp)
    # Order so streaming pagination is deterministic.
    query = query.order_by("projectId").order_by("timestamp")

    episodes: list[dict[str, Any]] = []
    project_filter = set(project_ids) if project_ids else None
    for snap in query.stream():
        d = snap.to_dict() or {}
        if "id" not in d:
            d["id"] = snap.id
        if project_filter and d.get("projectId") not in project_filter:
            continue
        episodes.append(d)

    # Collect every referenced claim id, then batch-fetch.
    referenced: set[str] = set()
    for e in episodes:
        for cid in e.get("claimsReferenced", []) or []:
            if isinstance(cid, str):
                referenced.add(cid)
    claims_by_id: dict[str, dict[str, Any]] = {}
    if referenced:
        claims_ref = db.collection("veritasClaims")
        ids = list(referenced)
        for i in range(0, len(ids), FIRESTORE_BATCH_GET_CAP):
            batch_ids = ids[i : i + FIRESTORE_BATCH_GET_CAP]
            refs = [claims_ref.document(cid) for cid in batch_ids]
            for snap in db.get_all(refs):
                if not snap.exists:
                    continue
                d = snap.to_dict() or {}
                claims_by_id[snap.id] = d
    return SourceData(episodes=episodes, claims_by_id=claims_by_id)


# ─────────────────────────────────────────────────────────────────────
#  Streaming shard writer
# ─────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class ExportStats:
    examples_written: int = 0
    episodes_seen: int = 0
    episodes_dropped: int = 0
    shards_written: int = 0
    bytes_written: int = 0
    duration_sec: float = 0.0
    drop_reasons: dict[str, int] = field(default_factory=dict)

    def record_drop(self, reason: str) -> None:
        self.episodes_dropped += 1
        self.drop_reasons[reason] = self.drop_reasons.get(reason, 0) + 1

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


def export(
    source: SourceData,
    out_dir: str | os.PathLike[str],
    *,
    shard_size: int = DEFAULT_SHARD_SIZE,
    system_prompt: str | None = None,
    scrub: bool = True,
    run_id: str | None = None,
) -> ExportStats:
    """Drive the export. Streams to JSONL shards under
    `<out_dir>/<run_id>/shard-NNNNN.jsonl`. Returns aggregate stats.

    Run-id derivation: if not supplied, we hash the input data so the
    same input always lands in the same run-id directory. Caching at CP5
    can short-circuit on this directory existing.
    """
    start = time.perf_counter()
    stats = ExportStats()

    if run_id is None:
        run_id = _hash_inputs(source)

    out_root = Path(out_dir) / run_id
    out_root.mkdir(parents=True, exist_ok=True)

    shard_idx = 0
    in_shard = 0
    shard_path = _shard_path(out_root, shard_idx)
    fh = open(shard_path, "wb")
    try:
        for episode in source.episodes:
            stats.episodes_seen += 1
            example = episode_to_example(
                episode,
                source.claims_by_id,
                system_prompt=system_prompt,
                scrub_pii=scrub,
            )
            if example is None:
                stats.record_drop("malformed_or_empty")
                continue
            line = _jsondumps(example.to_json()) + b"\n"
            fh.write(line)
            stats.examples_written += 1
            stats.bytes_written += len(line)
            in_shard += 1
            if in_shard >= shard_size:
                fh.close()
                stats.shards_written += 1
                shard_idx += 1
                in_shard = 0
                shard_path = _shard_path(out_root, shard_idx)
                fh = open(shard_path, "wb")
    finally:
        fh.close()
        # Final shard — only count it if it actually has examples.
        if in_shard > 0:
            stats.shards_written += 1
        elif stats.examples_written > 0:
            # Empty trailing shard from a clean shard_size boundary — remove
            # so directory listings reflect real shard count.
            try:
                Path(shard_path).unlink()
            except OSError:
                pass

    # Write a stats file alongside the shards — handy for debugging and a
    # cheap sanity gate at CP5 ("did the export actually produce anything?").
    stats.duration_sec = round(time.perf_counter() - start, 3)
    (out_root / "stats.json").write_bytes(_jsondumps(stats.to_dict()))

    log.info(
        "export complete: %d examples / %d shards in %.2fs",
        stats.examples_written,
        stats.shards_written,
        stats.duration_sec,
    )
    return stats


def _shard_path(root: Path, idx: int) -> Path:
    return root / f"shard-{idx:05d}.jsonl"


def _hash_inputs(source: SourceData) -> str:
    """Content-hash the input data. Same source bytes ⇒ same run-id."""
    h = hashlib.blake2b(digest_size=8)
    for e in source.episodes:
        h.update(e.get("id", "").encode("utf-8"))
        h.update(b"|")
        h.update(e.get("timestamp", "").encode("utf-8"))
        h.update(b";")
    return h.hexdigest()


# ─────────────────────────────────────────────────────────────────────
#  JSON helpers — orjson when available, stdlib json fallback
# ─────────────────────────────────────────────────────────────────────


def _jsondumps(obj: Any) -> bytes:
    if _HAVE_ORJSON:
        # ORJSON: SORT_KEYS for canonical output → cache-friendly downstream.
        return orjson.dumps(obj, option=orjson.OPT_SORT_KEYS)  # type: ignore[no-any-return]
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def _jsonloads(b: bytes) -> Any:
    if _HAVE_ORJSON:
        return orjson.loads(b)
    return json.loads(b.decode("utf-8"))


# ─────────────────────────────────────────────────────────────────────
#  Iteration helpers — exposed for tests / downstream packers
# ─────────────────────────────────────────────────────────────────────


def iter_examples(
    source: SourceData,
    *,
    system_prompt: str | None = None,
    scrub: bool = True,
) -> Iterator[SFTExample]:
    for episode in source.episodes:
        example = episode_to_example(
            episode,
            source.claims_by_id,
            system_prompt=system_prompt,
            scrub_pii=scrub,
        )
        if example is not None:
            yield example


def iter_jsonl(path: str | os.PathLike[str]) -> Iterator[dict[str, Any]]:
    """Iterate JSON objects from a single shard. Used by CP5 packer + tests."""
    with open(path, "rb") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            yield _jsonloads(line)


# ─────────────────────────────────────────────────────────────────────
#  CLI entry point
# ─────────────────────────────────────────────────────────────────────


def _build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="forge_veritas.firestore_export",
        description="Export Veritas episodes to SFT-ready JSONL shards.",
    )
    p.add_argument(
        "--source",
        choices=("firestore", "fixture"),
        default="fixture",
        help="Where to pull data from. Default fixture so the smoke test works offline.",
    )
    p.add_argument("--fixture", help="Path to the fixture JSON file (when --source=fixture).")
    p.add_argument("--out", required=True, help="Output directory for the shards.")
    p.add_argument(
        "--shard-size",
        type=int,
        default=DEFAULT_SHARD_SIZE,
        help=f"Examples per shard (default {DEFAULT_SHARD_SIZE}).",
    )
    p.add_argument("--service-account", help="Firestore service-account JSON path.")
    p.add_argument(
        "--project-ids",
        nargs="*",
        help="Restrict export to these project ids (Firestore mode only).",
    )
    p.add_argument(
        "--after",
        help="Only pull episodes with timestamp > this ISO string (Firestore mode).",
    )
    p.add_argument("--no-scrub", action="store_true", help="Disable PII scrubbing.")
    p.add_argument("--run-id", help="Override the auto-derived run id.")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_argparser().parse_args(list(argv) if argv is not None else None)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.source == "fixture":
        if not args.fixture:
            log.error("--fixture path required when --source=fixture")
            return 2
        source = load_fixture(args.fixture)
    else:
        source = load_firestore(
            project_ids=args.project_ids,
            service_account_path=args.service_account,
            after_timestamp=args.after,
        )

    stats = export(
        source,
        out_dir=args.out,
        shard_size=args.shard_size,
        scrub=not args.no_scrub,
        run_id=args.run_id,
    )
    if stats.examples_written == 0:
        log.warning("export produced 0 examples — check fixture / Firestore data.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
