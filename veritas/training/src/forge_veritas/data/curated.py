"""Curated public-dataset pipeline — the **primary** cold-start data path.

What this module does
─────────────────────
Pulls public, commercially-trainable datasets from the Hugging Face Hub,
runs each row through a per-source pure-function adapter, and emits the
same `SFTExample` shape as `firestore_export.py`. The output JSONL shards
are interchangeable with what the Firestore exporter would produce — CP5
(pack + dedup) and CP6 (SFT trainer) read them the same way.

Why this is CP3's primary path (and not Firestore)
──────────────────────────────────────────────────
Forge has zero production users at the time of CP3. The `firestore_export.py`
module is the right tool for the moment users start producing real
episodes (Phase 4 continual learning loop). Until then, the cold-start
SFT data has to come from curated public sources.

The canonical inventory of which datasets, in what proportions, with what
licenses, is locked in `docs/CURATED_DATASETS.md`. This file is the
runtime that produces shards from that inventory.

Architecture
────────────
    DatasetSpec              — one entry per source: hf_id, license,
                               target_count, mode, adapter callable
    REGISTRY                 — list of DatasetSpec, frozen at import
    iter_examples(spec, raw) — applies the adapter to each row, yielding
                               SFTExamples
    export(...)              — driver: pulls each source, runs adapter,
                               streams JSONL shards, writes
                               `licenses.json` for the CP6 hard gate

Efficiency choices
──────────────────
    • Streaming HF datasets (`load_dataset(..., streaming=True)`) — never
      load full splits into memory.
    • Per-source caps enforced lazily — stop iterating each source once
      `target_count` valid examples have been emitted. Saves wall-clock
      on huge datasets like OpenHermes-2.5 (1M rows) where we want 10K.
    • orjson when available, stdlib fallback, same as `firestore_export.py`.
    • Multi-shard output (default 1024/shard) for parallel CP5 packing.
    • Deterministic ordering — sources processed in `REGISTRY` order; rows
      within a source in HF iteration order. Same source revisions ⇒ byte-
      identical shards.

Adapter contract
────────────────
Every adapter is a pure function:

    def adapter(row: dict, *, source: DatasetSpec) -> SFTExample | None

Returning None drops the row (malformed / out-of-scope). The driver
counts drops per source for the licenses.json summary. Adapters MUST NOT
do network I/O; HF row fetching happens in the driver.

PII discipline
──────────────
Every text field crossing into the output passes through `pii.scrub_text`.
Public datasets aren't PII-free — PubMedQA carries author names, HotpotQA
sometimes leaks contact info from Wikipedia excerpts. Same regex pass as
the Firestore path.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import time
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from forge_veritas.data import chat_template as ct
from forge_veritas.data import pii
from forge_veritas.data.firestore_export import (
    SCHEMA_VERSION,
    SFTExample,
    estimate_tokens,
    _jsondumps,  # noqa: PLC2701 — single-source-of-truth JSON helper
    _shard_path,  # noqa: PLC2701
)

log = logging.getLogger("forge_veritas.curated")

Mode = Literal["lightning", "reasoning", "deep"]

# Adapter callable type — see docstring above for the contract.
Adapter = Callable[[dict[str, Any], "DatasetSpec"], SFTExample | None]


# ─────────────────────────────────────────────────────────────────────
#  Spec + registry
# ─────────────────────────────────────────────────────────────────────


@dataclass(slots=True, frozen=True)
class DatasetSpec:
    """One row per source in `docs/CURATED_DATASETS.md`."""

    name: str
    hf_id: str
    config: str | None         # HF dataset config (e.g. "pqa_labeled")
    split: str
    license: str
    target_count: int
    mode: Mode
    adapter: Adapter
    # Optional: rename a row's tool functions onto Forge canon (memory_recall,
    # retrieve, verify_citation). Keys are case-insensitive substrings.
    tool_rename_map: tuple[tuple[str, str], ...] = ()


# ─────────────────────────────────────────────────────────────────────
#  Helpers used by adapters
# ─────────────────────────────────────────────────────────────────────


def _user_then_assistant(
    *,
    source: DatasetSpec,
    user_input: str,
    assistant_content: str,
    reasoning: str | None = None,
    tool_calls_messages: list[ct.ChatMessage] | None = None,
    citations: list[str] | None = None,
    claims_context: dict[str, str] | None = None,
    row_id: str,
) -> SFTExample | None:
    """Common builder used by adapters that fit the `(user → assistant)`
    or `(user → tool calls → assistant)` shape. Centralises PII scrub +
    token estimation + SFTExample construction so adapters stay tiny.
    """
    user_input = (user_input or "").strip()
    assistant_content = (assistant_content or "").strip()
    if not user_input or (not assistant_content and not tool_calls_messages):
        return None

    # Build the trace explicitly so we get the exact chat-template shape
    # without round-tripping through `episode_to_example`. This keeps the
    # adapter's emitted SFTExample byte-for-byte deterministic.
    trace_steps: list[ct.ThoughtStep] = []
    idx = 0
    if reasoning:
        for paragraph in [p.strip() for p in reasoning.split("\n\n") if p.strip()]:
            trace_steps.append(ct.ThoughtStep(kind="think", text=paragraph, index=idx))
            idx += 1
    trace_steps.append(
        ct.ThoughtStep(kind="answer", text=assistant_content, index=idx)
    )
    trace = ct.ThoughtTrace(steps=trace_steps)

    messages = ct.trace_to_chatml(trace, user_input=user_input, mode=source.mode)

    # If the source carries tool calls (Hermes-FC, xlam, etc.), splice them
    # into the assistant turn before the final answer. We do this surgically
    # because chat-template rules require the answer to come AFTER its tool
    # results.
    if tool_calls_messages:
        # The first assistant message is the one trace_to_chatml just built;
        # we replace it with the tool-call sequence + a closing assistant
        # message carrying the answer.
        # Locate first assistant index.
        first_a = next(i for i, m in enumerate(messages) if m.role == "assistant")
        head = messages[:first_a]
        tail = messages[first_a + 1 :]  # skip the placeholder assistant
        final_answer = ct.ChatMessage(
            role="assistant", content=assistant_content
        )
        messages = head + tool_calls_messages + [final_answer] + tail

    # Scrub PII across every text field.
    for m in messages:
        m.content = pii.scrub_text(m.content)
        if m.reasoning_content:
            m.reasoning_content = pii.scrub_text(m.reasoning_content)

    safe_citations = [c for c in (citations or []) if isinstance(c, str)]
    safe_context: dict[str, str] = {}
    if claims_context:
        for k, v in claims_context.items():
            if isinstance(k, str) and isinstance(v, str):
                safe_context[k] = pii.scrub_text(v)

    return SFTExample(
        id=f"{source.name}:{row_id}",
        project_id=f"curated:{source.name}",
        mode=source.mode,
        messages=messages,
        citations=safe_citations,
        claims_context=safe_context,
        tokens_estimate=estimate_tokens(messages),
        created_at="",  # curated rows have no real timestamp
        schema_version=SCHEMA_VERSION,
    )


def _stable_row_id(*parts: object) -> str:
    """Hash arbitrary row contents into a stable id. Same row → same id
    across re-runs, so dedup at CP5 collapses identical examples even if
    the upstream HF revision shuffled rows.
    """
    h = hashlib.blake2b(digest_size=8)
    for p in parts:
        h.update(repr(p).encode("utf-8"))
        h.update(b"|")
    return h.hexdigest()


# ─────────────────────────────────────────────────────────────────────
#  Adapters — one per concrete source.
#  Five concrete adapters here cover every behaviour group; the rest of
#  the inventory in CURATED_DATASETS.md slot in as the same shape.
# ─────────────────────────────────────────────────────────────────────


def ultrachat_to_sft(row: dict[str, Any], source: DatasetSpec) -> SFTExample | None:
    """UltraChat 200K — multi-turn chat. Each row has `messages: [{role,content}]`.
    We collapse to a single (user → assistant) pair using the LAST user
    turn + last assistant turn, since cold-start lightning training values
    response quality more than dialog tracking.
    """
    msgs = row.get("messages") or row.get("data") or []
    if not isinstance(msgs, list) or len(msgs) < 2:
        return None
    user_text: str | None = None
    asst_text: str | None = None
    # Walk backwards to find the last assistant turn and its preceding user turn.
    for i in range(len(msgs) - 1, -1, -1):
        m = msgs[i]
        if not isinstance(m, dict):
            continue
        if asst_text is None and m.get("role") == "assistant":
            asst_text = m.get("content")
            continue
        if asst_text is not None and m.get("role") == "user":
            user_text = m.get("content")
            break
    if not user_text or not asst_text:
        return None
    return _user_then_assistant(
        source=source,
        user_input=str(user_text),
        assistant_content=str(asst_text),
        row_id=_stable_row_id(row.get("prompt_id"), row.get("id"), user_text[:64]),
    )


def openhermes_to_sft(row: dict[str, Any], source: DatasetSpec) -> SFTExample | None:
    """OpenHermes-2.5 — diverse instruction tuning, conversation-shaped.
    Rows have `conversations: [{from, value}]` with `from in {system,human,gpt,tool}`.
    """
    conv = row.get("conversations") or []
    if not isinstance(conv, list):
        return None
    user_text: str | None = None
    asst_text: str | None = None
    for turn in conv:
        if not isinstance(turn, dict):
            continue
        role = turn.get("from")
        if role == "human" and user_text is None:
            user_text = turn.get("value")
        elif role == "gpt" and user_text is not None:
            asst_text = turn.get("value")
            break
    if not user_text or not asst_text:
        return None
    return _user_then_assistant(
        source=source,
        user_input=str(user_text),
        assistant_content=str(asst_text),
        row_id=_stable_row_id(row.get("id"), user_text[:64]),
    )


def openthoughts_to_sft(row: dict[str, Any], source: DatasetSpec) -> SFTExample | None:
    """OpenThoughts-114k — DeepSeek-R1-distilled reasoning traces.
    Rows have `system`, `conversations: [{from, value}]`. The assistant turn
    embeds `<|begin_of_thought|>...<|end_of_thought|><|begin_of_solution|>...
    <|end_of_solution|>` markers. We split into reasoning_content + content.
    """
    conv = row.get("conversations") or []
    if not isinstance(conv, list):
        return None
    user_text: str | None = None
    asst_text: str | None = None
    for turn in conv:
        if not isinstance(turn, dict):
            continue
        if turn.get("from") in ("user", "human") and user_text is None:
            user_text = turn.get("value")
        elif turn.get("from") in ("assistant", "gpt") and user_text is not None:
            asst_text = turn.get("value")
            break
    if not user_text or not asst_text:
        return None

    reasoning, answer = _split_openthoughts_assistant(asst_text)
    if not answer:
        return None
    return _user_then_assistant(
        source=source,
        user_input=str(user_text),
        assistant_content=answer,
        reasoning=reasoning,
        row_id=_stable_row_id(row.get("conversation_id"), user_text[:64]),
    )


_BEGIN_THOUGHT = "<|begin_of_thought|>"
_END_THOUGHT = "<|end_of_thought|>"
_BEGIN_SOLUTION = "<|begin_of_solution|>"
_END_SOLUTION = "<|end_of_solution|>"


def _split_openthoughts_assistant(text: str) -> tuple[str | None, str]:
    """Pull reasoning + answer out of OpenThoughts' delimited assistant turn.
    Falls back gracefully when delimiters are missing — we keep the whole
    string as the answer in that case rather than dropping the row.
    """
    if _BEGIN_THOUGHT in text and _END_THOUGHT in text:
        thought = text.split(_BEGIN_THOUGHT, 1)[1].split(_END_THOUGHT, 1)[0].strip()
    else:
        thought = None
    if _BEGIN_SOLUTION in text and _END_SOLUTION in text:
        answer = text.split(_BEGIN_SOLUTION, 1)[1].split(_END_SOLUTION, 1)[0].strip()
    elif _END_THOUGHT in text:
        # Some rows omit the solution tags; everything after end-of-thought is the answer.
        answer = text.split(_END_THOUGHT, 1)[1].strip()
    else:
        answer = text.strip()
    return thought, answer


def hermes_function_calling_to_sft(
    row: dict[str, Any], source: DatasetSpec
) -> SFTExample | None:
    """NousResearch hermes-function-calling-v1 — tool-call training data.
    Rows have `conversations: [{from, value}]` where assistant turns may
    contain `<tool_call>{...}</tool_call>` blocks and `tool` rows carry
    results. We extract the first user → tool-call → tool-result → assistant
    sequence and convert to our chat-message form.
    """
    conv = row.get("conversations") or []
    if not isinstance(conv, list) or len(conv) < 3:
        return None

    user_text: str | None = None
    tool_calls_msgs: list[ct.ChatMessage] = []
    final_answer: str | None = None
    pending_call_name: str | None = None
    pending_call_id: str | None = None
    tc_counter = 0

    for turn in conv:
        if not isinstance(turn, dict):
            continue
        role = turn.get("from")
        value = str(turn.get("value") or "")
        if not value:
            continue
        if role in ("user", "human") and user_text is None:
            user_text = value
            continue
        if role in ("assistant", "gpt"):
            if "<tool_call>" in value:
                # Extract first tool call.
                payload = value.split("<tool_call>", 1)[1].split("</tool_call>", 1)[0].strip()
                try:
                    parsed = json.loads(payload)
                except (json.JSONDecodeError, ValueError):
                    return None
                name = parsed.get("name")
                if not isinstance(name, str):
                    return None
                # Apply Forge canonical-name renaming.
                canon = _apply_tool_rename(name, source.tool_rename_map)
                args = parsed.get("arguments") or parsed.get("args") or {}
                tc_counter += 1
                tc_id = f"tc-{tc_counter}"
                pending_call_name = canon
                pending_call_id = tc_id
                tool_calls_msgs.append(
                    ct.ChatMessage(
                        role="assistant",
                        content="",
                        tool_calls=[
                            ct.ToolCall(
                                id=tc_id,
                                function_name=canon,
                                arguments=json.dumps(args, sort_keys=True, separators=(",", ":")),
                            )
                        ],
                    )
                )
            else:
                final_answer = value
                break
            continue
        if role == "tool" and pending_call_id is not None:
            tool_calls_msgs.append(
                ct.ChatMessage(
                    role="tool",
                    content=value,
                    tool_call_id=pending_call_id,
                    name=pending_call_name,
                )
            )
            pending_call_id = None
            pending_call_name = None
            continue

    if not user_text or not final_answer or not tool_calls_msgs:
        return None
    return _user_then_assistant(
        source=source,
        user_input=user_text,
        assistant_content=final_answer,
        tool_calls_messages=tool_calls_msgs,
        row_id=_stable_row_id(row.get("id"), user_text[:64]),
    )


def pubmedqa_to_sft(row: dict[str, Any], source: DatasetSpec) -> SFTExample | None:
    """PubMedQA — biomedical QA with paper context. We render the context
    as a `memory_recall` tool result, which trains the exact behaviour
    Veritas-R1 uses at inference (recall claims → answer over them).
    """
    question = row.get("question") or row.get("QUESTION")
    long_answer = row.get("long_answer") or row.get("LONG_ANSWER")
    contexts = row.get("contexts") or row.get("CONTEXTS")
    if not isinstance(question, str) or not isinstance(long_answer, str):
        return None
    if not isinstance(contexts, list):
        return None
    context_text = "\n\n".join(c for c in contexts if isinstance(c, str))
    if not context_text:
        return None

    pmid = row.get("pubid") or row.get("PMID") or _stable_row_id(question[:64])
    claim_id = f"pmid-{pmid}"

    # Synthesise a (user → memory_recall → assistant) trace.
    tc_id = "tc-0"
    recall_call = ct.ChatMessage(
        role="assistant",
        content="",
        tool_calls=[
            ct.ToolCall(
                id=tc_id,
                function_name=ct.TOOL_MEMORY_RECALL,
                arguments=json.dumps({"query": question}, sort_keys=True, separators=(",", ":")),
            )
        ],
    )
    recall_result = ct.ChatMessage(
        role="tool",
        content=json.dumps(
            {"claims": [claim_id], "episodes": []},
            sort_keys=True,
            separators=(",", ":"),
        ),
        tool_call_id=tc_id,
        name=ct.TOOL_MEMORY_RECALL,
    )
    return _user_then_assistant(
        source=source,
        user_input=question,
        assistant_content=long_answer,
        tool_calls_messages=[recall_call, recall_result],
        citations=[claim_id],
        claims_context={claim_id: context_text[:4000]},  # cap to keep tokens reasonable
        row_id=str(pmid),
    )


def vitaminc_to_sft(row: dict[str, Any], source: DatasetSpec) -> SFTExample | None:
    """Vitamin-C — contrastive evidence. Each row has `claim`, `evidence`,
    `label` ∈ {SUPPORTS, REFUTES, NOT ENOUGH INFO}. Repurpose into a
    Forge-style "does this evidence contradict the claim?" task.
    """
    claim = row.get("claim")
    evidence = row.get("evidence")
    label = row.get("label")
    if not all(isinstance(x, str) and x for x in (claim, evidence, label)):
        return None
    label_norm = label.upper()
    if label_norm not in ("SUPPORTS", "REFUTES", "NOT ENOUGH INFO"):
        return None

    user_text = (
        f"Claim: {claim}\n\n"
        f"Evidence: {evidence}\n\n"
        "Does the evidence contradict the claim? Answer SUPPORT, CONTRADICT, "
        "or NOT_ENOUGH_INFO and explain in one sentence."
    )
    if label_norm == "SUPPORTS":
        verdict = "SUPPORT"
        rationale = "The evidence directly supports the claim."
    elif label_norm == "REFUTES":
        verdict = "CONTRADICT"
        rationale = "The evidence contradicts the claim."
    else:
        verdict = "NOT_ENOUGH_INFO"
        rationale = "The evidence is insufficient to decide either way."
    answer = f"{verdict}: {rationale}"
    return _user_then_assistant(
        source=source,
        user_input=user_text,
        assistant_content=answer,
        row_id=_stable_row_id(row.get("unique_id"), claim[:64]),
    )


def _apply_tool_rename(name: str, rename_map: Iterable[tuple[str, str]]) -> str:
    """Map a foreign tool name onto Forge's canonical surface where the
    semantics match. Case-insensitive substring match — kept loose because
    upstream tool names vary in casing/punctuation across datasets.
    """
    low = name.lower()
    for needle, replacement in rename_map:
        if needle.lower() in low:
            return replacement
    return name


# ─────────────────────────────────────────────────────────────────────
#  Registry — single source of truth for what we train on.
#  Every entry must match a row in CURATED_DATASETS.md §2.
# ─────────────────────────────────────────────────────────────────────

REGISTRY: tuple[DatasetSpec, ...] = (
    DatasetSpec(
        name="ultrachat_200k",
        hf_id="HuggingFaceH4/ultrachat_200k",
        config=None,
        split="train_sft",
        license="MIT",
        target_count=12_000,
        mode="lightning",
        adapter=ultrachat_to_sft,
    ),
    DatasetSpec(
        name="openhermes_2_5",
        hf_id="teknium/OpenHermes-2.5",
        config=None,
        split="train",
        license="Apache-2.0",
        target_count=10_000,
        mode="reasoning",
        adapter=openhermes_to_sft,
    ),
    DatasetSpec(
        name="openthoughts_114k",
        hf_id="open-thoughts/OpenThoughts-114k",
        config=None,
        split="train",
        license="Apache-2.0",
        target_count=25_000,
        mode="deep",
        adapter=openthoughts_to_sft,
    ),
    DatasetSpec(
        name="hermes_function_calling_v1",
        hf_id="NousResearch/hermes-function-calling-v1",
        config=None,
        split="train",
        license="Apache-2.0",
        target_count=5_000,
        mode="reasoning",
        adapter=hermes_function_calling_to_sft,
        # Map common dataset tool names onto Forge canon. Loose substring match.
        tool_rename_map=(
            ("memory", ct.TOOL_MEMORY_RECALL),
            ("recall", ct.TOOL_MEMORY_RECALL),
            ("search", ct.TOOL_RETRIEVE),
            ("retriev", ct.TOOL_RETRIEVE),
            ("crossref", ct.TOOL_RETRIEVE),
            ("doi", ct.TOOL_VERIFY),
            ("verify", ct.TOOL_VERIFY),
        ),
    ),
    DatasetSpec(
        name="pubmedqa",
        hf_id="bigbio/pubmed_qa",
        config="pubmed_qa_labeled_fold0_source",
        split="train",
        license="MIT",
        target_count=8_000,
        mode="deep",
        adapter=pubmedqa_to_sft,
    ),
    DatasetSpec(
        name="vitaminc",
        hf_id="tals/vitaminc",
        config=None,
        split="train",
        license="MIT",
        target_count=3_000,
        mode="reasoning",
        adapter=vitaminc_to_sft,
    ),
)


def lookup_spec(name: str) -> DatasetSpec | None:
    for spec in REGISTRY:
        if spec.name == name:
            return spec
    return None


# ─────────────────────────────────────────────────────────────────────
#  Driver — pulls each source, runs adapter, writes shards
# ─────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class CuratedExportStats:
    examples_written: int = 0
    rows_seen: int = 0
    rows_dropped: int = 0
    shards_written: int = 0
    bytes_written: int = 0
    duration_sec: float = 0.0
    per_source: dict[str, dict[str, int]] = field(default_factory=dict)
    licenses: dict[str, str] = field(default_factory=dict)

    def record_drop(self, source: str) -> None:
        self.rows_dropped += 1
        bucket = self.per_source.setdefault(source, {"written": 0, "dropped": 0})
        bucket["dropped"] += 1

    def record_write(self, source: str) -> None:
        self.examples_written += 1
        bucket = self.per_source.setdefault(source, {"written": 0, "dropped": 0})
        bucket["written"] += 1

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


def export_curated(
    out_dir: str | Path,
    *,
    sources: Iterable[DatasetSpec] | None = None,
    shard_size: int = 1024,
    run_id: str | None = None,
    row_iters: dict[str, Iterable[dict[str, Any]]] | None = None,
) -> CuratedExportStats:
    """Drive the curated export.

    Parameters
    ----------
    out_dir : root directory for shards
    sources : restrict to a subset of `REGISTRY` (default: full registry)
    shard_size : examples per shard
    run_id : override the auto-derived run id
    row_iters : **test injection point** — a dict mapping `source.name` to
                an iterable of raw rows. When provided, the driver uses
                these instead of pulling from HuggingFace. This is how the
                test suite exercises the full pipeline without network.
    """
    start = time.perf_counter()
    specs = tuple(sources) if sources is not None else REGISTRY
    stats = CuratedExportStats()
    stats.licenses = {s.name: s.license for s in specs}

    if run_id is None:
        run_id = "curated-" + hashlib.blake2b(
            ("|".join(f"{s.name}={s.target_count}" for s in specs)).encode("utf-8"),
            digest_size=6,
        ).hexdigest()

    out_root = Path(out_dir) / run_id
    out_root.mkdir(parents=True, exist_ok=True)

    shard_idx = 0
    in_shard = 0
    shard_path = _shard_path(out_root, shard_idx)
    fh = open(shard_path, "wb")
    try:
        for spec in specs:
            log.info("source=%s target=%d", spec.name, spec.target_count)
            iterator = (
                row_iters.get(spec.name) if row_iters else None
            ) or _load_rows(spec)
            written_for_source = 0
            for raw in iterator:
                stats.rows_seen += 1
                ex = spec.adapter(raw, spec)
                if ex is None:
                    stats.record_drop(spec.name)
                    continue
                line = _jsondumps(ex.to_json()) + b"\n"
                fh.write(line)
                stats.record_write(spec.name)
                stats.bytes_written += len(line)
                in_shard += 1
                written_for_source += 1
                if in_shard >= shard_size:
                    fh.close()
                    stats.shards_written += 1
                    shard_idx += 1
                    in_shard = 0
                    shard_path = _shard_path(out_root, shard_idx)
                    fh = open(shard_path, "wb")
                if written_for_source >= spec.target_count:
                    break
    finally:
        fh.close()
        if in_shard > 0:
            stats.shards_written += 1
        elif stats.examples_written > 0:
            try:
                Path(shard_path).unlink()
            except OSError:
                pass

    stats.duration_sec = round(time.perf_counter() - start, 3)

    # licenses.json — the CP6 hard gate. CP6 will refuse to start training
    # if this file is missing or any source on it lists an NC license.
    (out_root / "licenses.json").write_bytes(_jsondumps(stats.licenses))
    (out_root / "stats.json").write_bytes(_jsondumps(stats.to_dict()))
    log.info(
        "curated export: %d examples / %d shards in %.2fs",
        stats.examples_written,
        stats.shards_written,
        stats.duration_sec,
    )
    return stats


def _load_rows(spec: DatasetSpec) -> Iterator[dict[str, Any]]:
    """Lazy HF dataset iterator. Imported lazily so the module stays usable
    without `datasets` installed (tests use injected `row_iters` instead).
    """
    try:
        from datasets import load_dataset  # type: ignore[import-not-found]
    except ImportError as e:
        raise RuntimeError(
            f"`datasets` package required to pull {spec.hf_id}. "
            "Install with `pip install datasets` or pass `row_iters=` for offline tests."
        ) from e

    kwargs: dict[str, Any] = {"streaming": True}
    if spec.config:
        kwargs["name"] = spec.config
    ds = load_dataset(spec.hf_id, split=spec.split, **kwargs)
    for row in ds:
        yield dict(row)


# ─────────────────────────────────────────────────────────────────────
#  CLI entry point
# ─────────────────────────────────────────────────────────────────────


def _build_argparser():
    import argparse

    p = argparse.ArgumentParser(
        prog="forge_veritas.curated",
        description="Pull curated public datasets and emit SFT-ready JSONL shards.",
    )
    p.add_argument("--out", required=True, help="Output directory.")
    p.add_argument("--shard-size", type=int, default=1024)
    p.add_argument("--run-id", help="Override the auto-derived run id.")
    p.add_argument(
        "--only",
        nargs="*",
        help="Restrict to these source names (default: full registry).",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_argparser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    sources = REGISTRY
    if args.only:
        keep = set(args.only)
        sources = tuple(s for s in REGISTRY if s.name in keep)
        if not sources:
            log.error("no registry entries match --only %s", args.only)
            return 2
    stats = export_curated(
        args.out,
        sources=sources,
        shard_size=args.shard_size,
        run_id=args.run_id,
    )
    return 0 if stats.examples_written > 0 else 1


if __name__ == "__main__":
    import sys

    sys.exit(main(sys.argv[1:]))
