"""Python port of the CP2 TS chat-template adapter.

Source of truth is `src/lib/veritas/training-format/chat-template.ts` — this
module exists because the training pipeline runs in Python on rented GPU
and can't reach into the TS app at training time. The two implementations
share the same contract; the TS integration test (`integration.ts`) verifies
the wire format the Python exporter produces is parseable by the TS parser.

Why mirror instead of shelling out to Node?
    Two reasons. (1) Performance — millions of episodes will pass through
    this module across SFT + GRPO + DPO. Subprocess overhead of ~50ms per
    episode would add hours to a single export run. (2) No Node on training
    boxes by default — keeping Python self-contained avoids one more thing
    that can go wrong at training time.

Production-grade contract — same as the TS file:
    • reasoning_content is **plain natural-language prose**, no prefix syntax
    • memory recall is a **first-class tool call** (`memory_recall`)
    • tool calls follow the OpenAI shape exactly
    • round-trip is lossless for what Veritas-R1 emits at inference
    • `decide` collapses to `think`, `confidence` is dropped on the wire
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

# Tool-name canon — single source of truth for both training (this file)
# and serving (CP14 vLLM config). MUST match `TOOL_NAMES` in the TS adapter.
TOOL_MEMORY_RECALL = "memory_recall"
TOOL_RETRIEVE = "retrieve"
TOOL_VERIFY = "verify_citation"

ChatRole = Literal["system", "user", "assistant", "tool"]
ThoughtKind = Literal[
    "think", "recall", "retrieve", "verify", "tool-call", "decide", "answer"
]
Mode = Literal["lightning", "reasoning", "deep"]

DEFAULT_SYSTEM_PROMPT = (
    "You are Veritas-R1, Forge's verification-first research assistant. "
    "Ground every answer in the provided claims, episodes, and contradictions. "
    "Prefer abstention to fabrication when evidence is insufficient."
)


# ─────────────────────────────────────────────────────────────────────
#  Message types — match the OpenAI / Qwen3 chat shape exactly
# ─────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class ToolCall:
    """One assistant tool call. `arguments` is a JSON string per OpenAI shape."""

    id: str
    function_name: str
    arguments: str
    type: str = "function"

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "function": {"name": self.function_name, "arguments": self.arguments},
        }


@dataclass(slots=True)
class ChatMessage:
    """A single chat message. We keep all roles in one dataclass for fast
    construction and uniform JSON encoding — discriminated unions are nice
    in TS but cost real memory in Python at the volumes we're shipping.
    """

    role: ChatRole
    content: str = ""
    reasoning_content: str | None = None
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None
    name: str | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.reasoning_content:
            out["reasoning_content"] = self.reasoning_content
        if self.tool_calls:
            out["tool_calls"] = [tc.to_json() for tc in self.tool_calls]
        if self.tool_call_id is not None:
            out["tool_call_id"] = self.tool_call_id
        if self.name is not None:
            out["name"] = self.name
        return out


@dataclass(slots=True)
class ThoughtStep:
    """Schema mirror of `ThoughtStep` in `src/lib/veritas/memory/schema.ts`.

    Fields beyond `kind` + `index` are conditional per-kind — this matches the
    TS interface exactly. `confidence` is preserved on the dataclass for
    in-process use (UI annotations, training-time reward shaping) but is
    stripped on the chat-template wire format, same as the TS impl.
    """

    kind: ThoughtKind
    index: int
    text: str | None = None
    recalled_claims: list[str] | None = None
    recalled_episodes: list[str] | None = None
    tool: str | None = None
    tool_input: Any = None
    tool_output: Any = None
    confidence: float | None = None


@dataclass(slots=True)
class ThoughtTrace:
    steps: list[ThoughtStep] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────
#  Encoding — ThoughtTrace → ChatMessage[]
# ─────────────────────────────────────────────────────────────────────


def trace_to_chatml(
    trace: ThoughtTrace,
    *,
    user_input: str,
    system_prompt: str | None = None,
    mode: Mode = "reasoning",
) -> list[ChatMessage]:
    """Encode a ThoughtTrace into Qwen3 chat messages.

    Mirrors the TS `traceToChatML` algorithm step-for-step. We deliberately
    keep this implementation byte-for-byte deterministic — same trace, same
    messages, every call. That's the contract CP5 dataset deduplication
    relies on.
    """
    messages: list[ChatMessage] = [
        ChatMessage(role="system", content=system_prompt or DEFAULT_SYSTEM_PROMPT),
        ChatMessage(role="user", content=user_input),
    ]

    strip_reasoning = mode == "lightning"
    reasoning_buf: list[str] = []
    tool_call_counter = 0

    # Walk steps in declared `index` order — schema contract.
    steps = sorted(trace.steps, key=lambda s: s.index)

    def flush_assistant(final_content: str, tool_call: ToolCall | None = None) -> None:
        nonlocal reasoning_buf
        msg = ChatMessage(role="assistant", content=final_content)
        if not strip_reasoning and reasoning_buf:
            # Blank-line separation so multi-paragraph thoughts round-trip.
            msg.reasoning_content = "\n\n".join(reasoning_buf)
        if tool_call is not None:
            msg.tool_calls = [tool_call]
        messages.append(msg)
        reasoning_buf = []

    for step in steps:
        if step.kind in ("think", "decide"):
            if strip_reasoning:
                continue
            text = (step.text or "").strip()
            if text:
                reasoning_buf.append(text)
            continue

        if step.kind == "recall":
            tc_id = f"tc-{tool_call_counter}"
            tool_call_counter += 1
            call = ToolCall(
                id=tc_id,
                function_name=TOOL_MEMORY_RECALL,
                arguments=_jsondumps({"query": step.text or ""}),
            )
            flush_assistant("", call)
            messages.append(
                ChatMessage(
                    role="tool",
                    content=_jsondumps(
                        {
                            "claims": step.recalled_claims or [],
                            "episodes": step.recalled_episodes or [],
                        }
                    ),
                    tool_call_id=tc_id,
                    name=TOOL_MEMORY_RECALL,
                )
            )
            continue

        if step.kind in ("retrieve", "verify", "tool-call"):
            tc_id = f"tc-{tool_call_counter}"
            tool_call_counter += 1
            name = step.tool or _canonical_tool_name(step.kind)
            call = ToolCall(
                id=tc_id,
                function_name=name,
                arguments=_jsondumps(step.tool_input),
            )
            flush_assistant("", call)
            messages.append(
                ChatMessage(
                    role="tool",
                    content=_jsondumps(step.tool_output),
                    tool_call_id=tc_id,
                    name=name,
                )
            )
            continue

        if step.kind == "answer":
            flush_assistant(step.text or "")
            continue

    if reasoning_buf:
        # Trailing reasoning without a closing answer — emit anyway.
        flush_assistant("")

    return messages


def _canonical_tool_name(kind: str) -> str:
    if kind == "retrieve":
        return TOOL_RETRIEVE
    if kind == "verify":
        return TOOL_VERIFY
    return "tool"


# ─────────────────────────────────────────────────────────────────────
#  Decoding — ChatMessage[] → ThoughtTrace
# ─────────────────────────────────────────────────────────────────────


def chatml_to_trace(messages: list[ChatMessage] | list[dict[str, Any]]) -> ThoughtTrace:
    """Reverse direction. Accepts either dataclasses or JSON dicts so callers
    can decode straight from a JSONL line without an extra `from_dict` step.
    """
    msgs = [_coerce_message(m) for m in messages]
    steps: list[ThoughtStep] = []
    idx = 0

    # Index tool-result messages by tool_call_id for O(1) pairing.
    tool_results: dict[str, ChatMessage] = {}
    for m in msgs:
        if m.role == "tool" and m.tool_call_id is not None:
            tool_results[m.tool_call_id] = m

    for m in msgs:
        if m.role != "assistant":
            continue

        # 1) Reasoning prose → one `think` step per blank-line-separated paragraph.
        if m.reasoning_content:
            for raw in _split_paragraphs(m.reasoning_content):
                steps.append(ThoughtStep(kind="think", text=raw, index=idx))
                idx += 1

        # 2) Tool calls — `memory_recall` decodes to `recall`; rest by name.
        if m.tool_calls:
            for tc in m.tool_calls:
                result = tool_results.get(tc.id)
                parsed_output = _jsonloads(result.content) if result else None
                if tc.function_name == TOOL_MEMORY_RECALL:
                    out = parsed_output if isinstance(parsed_output, dict) else {}
                    rc = _string_array(out.get("claims"))
                    re = _string_array(out.get("episodes"))
                    # Recover the query text from the tool call args — preserves
                    # `step.text` on round-trip when a query was supplied.
                    parsed_args = _jsonloads(tc.arguments)
                    query_text: str | None = None
                    if isinstance(parsed_args, dict):
                        q = parsed_args.get("query")
                        if isinstance(q, str) and q:
                            query_text = q
                    step = ThoughtStep(kind="recall", index=idx)
                    if query_text:
                        step.text = query_text
                    if rc:
                        step.recalled_claims = rc
                    if re:
                        step.recalled_episodes = re
                    steps.append(step)
                    idx += 1
                    continue
                steps.append(
                    ThoughtStep(
                        kind=_canonicalise_tool_kind(tc.function_name),
                        index=idx,
                        tool=tc.function_name,
                        tool_input=_jsonloads(tc.arguments),
                        tool_output=parsed_output,
                    )
                )
                idx += 1

        # 3) Final answer text — only if non-empty.
        if m.content:
            steps.append(ThoughtStep(kind="answer", text=m.content, index=idx))
            idx += 1

    return ThoughtTrace(steps=steps)


def _coerce_message(m: ChatMessage | dict[str, Any]) -> ChatMessage:
    if isinstance(m, ChatMessage):
        return m
    tool_calls: list[ToolCall] | None = None
    if m.get("tool_calls"):
        tool_calls = []
        for raw in m["tool_calls"]:
            fn = raw.get("function", {})
            tool_calls.append(
                ToolCall(
                    id=raw.get("id", ""),
                    function_name=fn.get("name", ""),
                    arguments=fn.get("arguments", "{}"),
                    type=raw.get("type", "function"),
                )
            )
    return ChatMessage(
        role=m.get("role", "user"),
        content=m.get("content", ""),
        reasoning_content=m.get("reasoning_content"),
        tool_calls=tool_calls,
        tool_call_id=m.get("tool_call_id"),
        name=m.get("name"),
    )


def _canonicalise_tool_kind(name: str) -> ThoughtKind:
    if name == TOOL_RETRIEVE:
        return "retrieve"
    if name == TOOL_VERIFY:
        return "verify"
    # Heuristics — keep schema kind faithful when the model emits a more
    # specific name (mirrored from the TS adapter for parity).
    low = name.lower()
    if "verify" in low or "doi" in low:
        return "verify"
    if any(t in low for t in ("retrieve", "search", "crossref", "openalex", "arxiv", "pubmed")):
        return "retrieve"
    return "tool-call"


_PARAGRAPH_SPLIT = "\n\n"


def _split_paragraphs(s: str) -> list[str]:
    # Same semantics as the TS `split(/\n\s*\n/)` — split on any blank line,
    # strip whitespace, drop empties.
    parts: list[str] = []
    cur: list[str] = []
    for line in s.split("\n"):
        if line.strip() == "":
            if cur:
                parts.append("\n".join(cur).strip())
                cur = []
        else:
            cur.append(line)
    if cur:
        parts.append("\n".join(cur).strip())
    return [p for p in parts if p]


# ─────────────────────────────────────────────────────────────────────
#  Tiny JSON helpers — never throw, always emit deterministic strings.
#  Determinism matters because identical traces must produce identical
#  messages for dataset dedup at training time.
# ─────────────────────────────────────────────────────────────────────


def _jsondumps(value: Any) -> str:
    if value is None:
        return "{}"
    try:
        # `sort_keys=True` is the cheapest way to make the output canonical
        # without pulling in orjson — same hash across Python builds.
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return "{}"


def _jsonloads(s: str | None) -> Any:
    if not s:
        return None
    try:
        return json.loads(s)
    except (TypeError, ValueError, json.JSONDecodeError):
        # Surface the raw string rather than dropping data — same as TS.
        return s


def _string_array(v: Any) -> list[str]:
    if not isinstance(v, list):
        return []
    return [x for x in v if isinstance(x, str)]
