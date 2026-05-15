"""CP3 smoke + property tests.

Runnable two ways:
    python -m unittest veritas.training.tests.test_data_export
    pytest veritas/training/tests/test_data_export.py

Or as a script for the smoke gate the CP3 exit criterion calls for:
    python veritas/training/tests/test_data_export.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

# Make `forge_veritas` importable when the test file is run directly.
_HERE = Path(__file__).resolve()
_SRC = _HERE.parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from forge_veritas.data import chat_template as ct
from forge_veritas.data import pii
from forge_veritas.data.firestore_export import (
    SFTExample,
    episode_to_example,
    estimate_tokens,
    export,
    infer_mode,
    iter_jsonl,
    load_fixture,
)

FIXTURE_PATH = _HERE.parent / "fixtures" / "episodes_fixture.json"


# ─────────────────────────────────────────────────────────────────────
#  Chat-template — Python ↔ Python round-trip parity with TS contract
# ─────────────────────────────────────────────────────────────────────


def _build_inference_trace() -> ct.ThoughtTrace:
    """Same shape as the TS test in `integration.ts`."""
    return ct.ThoughtTrace(
        steps=[
            ct.ThoughtStep(
                kind="think",
                index=0,
                text="User asks about GLP-1 mortality. Recall first.",
            ),
            ct.ThoughtStep(
                kind="recall",
                index=1,
                text="GLP-1 mortality T2DM",
                recalled_claims=["clm-abc", "clm-def"],
                recalled_episodes=["epi-1"],
            ),
            ct.ThoughtStep(
                kind="think",
                index=2,
                text="Two claims found. Verify the DOI.",
            ),
            ct.ThoughtStep(
                kind="retrieve",
                index=3,
                tool=ct.TOOL_RETRIEVE,
                tool_input={"query": "GLP-1 agonists mortality T2DM", "limit": 5},
                tool_output={"hits": [{"doi": "10.1234/foo", "title": "GLP-1 RCT"}]},
            ),
            ct.ThoughtStep(
                kind="verify",
                index=4,
                tool=ct.TOOL_VERIFY,
                tool_input={"doi": "10.1234/foo"},
                tool_output={"resolved": True, "journal": "NEJM"},
            ),
            ct.ThoughtStep(
                kind="answer",
                index=5,
                text="GLP-1 agonists reduce all-cause mortality in T2DM (NEJM, doi:10.1234/foo).",
            ),
        ]
    )


class ChatTemplateRoundTripTests(unittest.TestCase):
    def test_inference_shape_round_trip(self) -> None:
        trace = _build_inference_trace()
        msgs = ct.trace_to_chatml(trace, user_input="ping", mode="reasoning")
        # System + user + interleaved assistant/tool.
        self.assertEqual(msgs[0].role, "system")
        self.assertEqual(msgs[1].role, "user")
        # recall + retrieve + verify ⇒ 3 tool messages.
        tools = [m for m in msgs if m.role == "tool"]
        self.assertEqual(len(tools), 3)
        # Reasoning content is plain prose — no prefix-syntax artefacts.
        for m in msgs:
            if m.role == "assistant" and m.reasoning_content:
                self.assertNotRegex(m.reasoning_content, r"^(think|decide|recall):")
        recovered = ct.chatml_to_trace([m.to_json() for m in msgs])
        # Compare ignoring index renumbering.
        for orig, got in zip(trace.steps, recovered.steps, strict=True):
            self.assertEqual(orig.kind, got.kind)
            self.assertEqual(orig.text, got.text)
            self.assertEqual(orig.recalled_claims or None, got.recalled_claims)
            self.assertEqual(orig.recalled_episodes or None, got.recalled_episodes)
            self.assertEqual(orig.tool, got.tool)
            self.assertEqual(orig.tool_input, got.tool_input)
            self.assertEqual(orig.tool_output, got.tool_output)
        # Output indexes are dense 0..N-1.
        for i, s in enumerate(recovered.steps):
            self.assertEqual(s.index, i)

    def test_lightning_strips_reasoning(self) -> None:
        trace = _build_inference_trace()
        msgs = ct.trace_to_chatml(trace, user_input="x", mode="lightning")
        for m in msgs:
            if m.role == "assistant":
                self.assertIsNone(m.reasoning_content)

    def test_decide_collapses_to_think(self) -> None:
        trace = ct.ThoughtTrace(
            steps=[
                ct.ThoughtStep(kind="decide", index=0, text="Cite this."),
                ct.ThoughtStep(kind="answer", index=1, text="done"),
            ]
        )
        recovered = ct.chatml_to_trace(
            [m.to_json() for m in ct.trace_to_chatml(trace, user_input="x")]
        )
        self.assertEqual(recovered.steps[0].kind, "think")
        self.assertEqual(recovered.steps[0].text, "Cite this.")

    def test_confidence_dropped_on_wire(self) -> None:
        trace = ct.ThoughtTrace(
            steps=[
                ct.ThoughtStep(kind="think", index=0, text="t", confidence=0.85),
                ct.ThoughtStep(kind="answer", index=1, text="done"),
            ]
        )
        recovered = ct.chatml_to_trace(
            [m.to_json() for m in ct.trace_to_chatml(trace, user_input="x")]
        )
        self.assertIsNone(recovered.steps[0].confidence)

    def test_deterministic_ids(self) -> None:
        trace = _build_inference_trace()
        a = [m.to_json() for m in ct.trace_to_chatml(trace, user_input="x")]
        b = [m.to_json() for m in ct.trace_to_chatml(trace, user_input="x")]
        self.assertEqual(a, b)

    def test_unknown_tool_becomes_generic(self) -> None:
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "u"},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "tc-0",
                        "type": "function",
                        "function": {"name": "exotic_tool", "arguments": "{}"},
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "tc-0",
                "name": "exotic_tool",
                "content": "{}",
            },
            {"role": "assistant", "content": "answer"},
        ]
        recovered = ct.chatml_to_trace(msgs)
        self.assertEqual(recovered.steps[0].kind, "tool-call")
        self.assertEqual(recovered.steps[0].tool, "exotic_tool")


# ─────────────────────────────────────────────────────────────────────
#  PII tests
# ─────────────────────────────────────────────────────────────────────


class PIITests(unittest.TestCase):
    def test_emails_redacted(self) -> None:
        out = pii.scrub_text("Reach me at someone@example.com and bcc team+dev@org.io.")
        self.assertNotIn("@example.com", out)
        self.assertNotIn("team+dev@org.io", out)
        self.assertIn(pii.REDACTION, out)

    def test_phone_redacted(self) -> None:
        out = pii.scrub_text("Call (415) 555-1234 or +1 415.555.0001 anytime.")
        self.assertNotIn("415", out)
        self.assertIn(pii.REDACTION, out)

    def test_api_keys_redacted(self) -> None:
        for key in (
            "sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
            "ghp_abcdefABCDEF0123456789xyzXYZ",
            "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz",
        ):
            out = pii.scrub_text(f"key={key}!")
            self.assertNotIn(key, out)

    def test_idempotent(self) -> None:
        sample = "Email: a@b.co  SSN 111-22-3333"
        once = pii.scrub_text(sample)
        twice = pii.scrub_text(once)
        self.assertEqual(once, twice)


# ─────────────────────────────────────────────────────────────────────
#  Mode inference + token estimate
# ─────────────────────────────────────────────────────────────────────


class HeuristicTests(unittest.TestCase):
    def test_mode_lightning_when_no_trace(self) -> None:
        self.assertEqual(infer_mode(None), "lightning")
        self.assertEqual(infer_mode(ct.ThoughtTrace(steps=[])), "lightning")

    def test_mode_reasoning_when_thinking_only(self) -> None:
        trace = ct.ThoughtTrace(
            steps=[
                ct.ThoughtStep(kind="think", index=0, text="reason"),
                ct.ThoughtStep(kind="answer", index=1, text="done"),
            ]
        )
        self.assertEqual(infer_mode(trace), "reasoning")

    def test_mode_deep_when_tool_calls_present(self) -> None:
        trace = _build_inference_trace()
        self.assertEqual(infer_mode(trace), "deep")

    def test_token_estimate_grows_with_content(self) -> None:
        small = ct.trace_to_chatml(
            ct.ThoughtTrace(steps=[ct.ThoughtStep(kind="answer", index=0, text="hi")]),
            user_input="hi",
        )
        large = ct.trace_to_chatml(_build_inference_trace(), user_input="long?")
        self.assertLess(estimate_tokens(small), estimate_tokens(large))


# ─────────────────────────────────────────────────────────────────────
#  Exporter — fixture-mode smoke + round-trip
# ─────────────────────────────────────────────────────────────────────


class ExporterSmokeTests(unittest.TestCase):
    def test_load_fixture_sorted(self) -> None:
        src = load_fixture(FIXTURE_PATH)
        # Sorted ASC by (projectId, timestamp). The fixture has them already
        # in that order, but verify that downstream contract.
        timestamps = [e["timestamp"] for e in src.episodes]
        self.assertEqual(timestamps, sorted(timestamps))
        # Both referenced claims resolved.
        self.assertIn("clm-glp1", src.claims_by_id)
        self.assertIn("clm-sglt2", src.claims_by_id)

    def test_episode_to_example_rich_episode(self) -> None:
        src = load_fixture(FIXTURE_PATH)
        # Pick the rich episode (has a trace).
        rich = next(e for e in src.episodes if e["id"] == "epi-glp1-mortality")
        ex = episode_to_example(rich, src.claims_by_id)
        self.assertIsNotNone(ex)
        assert ex is not None  # narrowing
        self.assertEqual(ex.mode, "deep")
        self.assertEqual(ex.citations, ["clm-glp1", "clm-sglt2"])
        # Both referenced claims appear in the lookup.
        self.assertEqual(set(ex.claims_context.keys()), {"clm-glp1", "clm-sglt2"})
        # PII scrubbed in the answer text.
        last_assistant = next(m for m in reversed(ex.messages) if m.role == "assistant")
        self.assertNotIn("@example.com", last_assistant.content)
        self.assertIn(pii.REDACTION, last_assistant.content)

    def test_episode_to_example_lightning(self) -> None:
        src = load_fixture(FIXTURE_PATH)
        light = next(e for e in src.episodes if e["id"] == "epi-quick-chat")
        ex = episode_to_example(light, src.claims_by_id)
        self.assertIsNotNone(ex)
        assert ex is not None
        self.assertEqual(ex.mode, "lightning")
        # Lightning mode strips reasoning. None of the assistant messages
        # should carry reasoning_content.
        for m in ex.messages:
            if m.role == "assistant":
                self.assertIsNone(m.reasoning_content)
        # The "415-555-1234" phone in the output must have been redacted.
        last_assistant = next(m for m in reversed(ex.messages) if m.role == "assistant")
        self.assertNotIn("415-555-1234", last_assistant.content)

    def test_malformed_episode_dropped(self) -> None:
        src = load_fixture(FIXTURE_PATH)
        empty = next(e for e in src.episodes if e["id"] == "epi-malformed-empty")
        self.assertIsNone(episode_to_example(empty, src.claims_by_id))

    def test_export_writes_valid_jsonl_shards(self) -> None:
        src = load_fixture(FIXTURE_PATH)
        with tempfile.TemporaryDirectory() as tmpdir:
            stats = export(src, out_dir=tmpdir, shard_size=1, run_id="test-run")
            self.assertEqual(stats.examples_written, 2, "drops the empty-input fixture")
            self.assertEqual(stats.episodes_dropped, 1)
            # shard_size=1 + 2 examples ⇒ 2 shards.
            self.assertEqual(stats.shards_written, 2)

            run_dir = Path(tmpdir) / "test-run"
            shard_files = sorted(run_dir.glob("shard-*.jsonl"))
            self.assertEqual(len(shard_files), 2)

            # Every shard produces parseable JSON, valid SFTExample shape.
            for shard in shard_files:
                lines = list(iter_jsonl(shard))
                self.assertGreater(len(lines), 0)
                for line in lines:
                    self.assertIn("messages", line)
                    self.assertIn("mode", line)
                    self.assertIn("citations", line)
                    self.assertIn("claims_context", line)
                    self.assertIn("schema_version", line)
                    self.assertEqual(line["schema_version"], "v1")
                    # The CP3 round-trip exit criterion: messages parse back
                    # through the same chat-template adapter without loss.
                    recovered = ct.chatml_to_trace(line["messages"])
                    self.assertGreater(len(recovered.steps), 0)
                    # Final step is always the answer.
                    self.assertEqual(recovered.steps[-1].kind, "answer")

            # stats.json written alongside.
            stats_path = run_dir / "stats.json"
            self.assertTrue(stats_path.is_file())
            with open(stats_path, "rb") as fh:
                stats_dict = json.loads(fh.read())
            self.assertEqual(stats_dict["examples_written"], 2)

    def test_export_deterministic_run_id(self) -> None:
        # Same input → same hash-derived run id.
        src = load_fixture(FIXTURE_PATH)
        with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
            s1 = export(src, out_dir=tmp1)
            s2 = export(src, out_dir=tmp2)
            ids1 = sorted(p.name for p in Path(tmp1).iterdir())
            ids2 = sorted(p.name for p in Path(tmp2).iterdir())
            self.assertEqual(ids1, ids2)
            self.assertEqual(s1.examples_written, s2.examples_written)

    def test_export_shard_boundary_no_empty_trailer(self) -> None:
        # With shard_size that exactly divides example count, the last shard
        # must be removed if it's empty (not present in stats either).
        src = load_fixture(FIXTURE_PATH)
        with tempfile.TemporaryDirectory() as tmpdir:
            # 2 valid examples + shard_size=2 → exactly 1 shard, no trailer.
            stats = export(src, out_dir=tmpdir, shard_size=2, run_id="boundary")
            self.assertEqual(stats.shards_written, 1)
            run_dir = Path(tmpdir) / "boundary"
            self.assertEqual(len(list(run_dir.glob("shard-*.jsonl"))), 1)


def main() -> int:
    runner = unittest.TextTestRunner(verbosity=2)
    suite = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
