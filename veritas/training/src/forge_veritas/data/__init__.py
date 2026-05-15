"""Data pipeline for Veritas-R1 training.

Status:
    chat_template.py      — CP3 ✅ (Python mirror of TS CP2 adapter)
    pii.py                — CP3 ✅ (regex PII scrubber)
    firestore_export.py   — CP3 ✅ (Episode → JSONL exporter)
    seed_synth.py         — CP4
    pack.py               — CP5 (dedup + tokenise + train/val split)
    preferences.py        — CP10 (DPO chosen/rejected pairs)
"""

# Re-export the public surface so callers can do
# `from forge_veritas.data import export, SFTExample, trace_to_chatml`
# without remembering submodule paths.
from forge_veritas.data.chat_template import (
    ChatMessage,
    ThoughtStep,
    ThoughtTrace,
    ToolCall,
    chatml_to_trace,
    trace_to_chatml,
)
from forge_veritas.data.firestore_export import (
    SFTExample,
    SourceData,
    episode_to_example,
    export,
    infer_mode,
    iter_examples,
    iter_jsonl,
    load_fixture,
)
from forge_veritas.data.pii import scrub_text

__all__ = [
    "ChatMessage",
    "SFTExample",
    "SourceData",
    "ThoughtStep",
    "ThoughtTrace",
    "ToolCall",
    "chatml_to_trace",
    "episode_to_example",
    "export",
    "infer_mode",
    "iter_examples",
    "iter_jsonl",
    "load_fixture",
    "scrub_text",
    "trace_to_chatml",
]
