"""Stage-1 before/after eval — run held-out contradiction-detection prompts
on the base model AND on the adapter-augmented model, side-by-side.
Reports loss and qualitative samples.

Why this is a stage-1 eval, not a benchmark
───────────────────────────────────────────
ForgeBench-Reason is the real eval (CP12). This script's job is to give
fast feedback on whether Stage-1 training produced *any* signal at all
— measurable per-prompt loss delta and a human-readable verdict diff
on the contradiction-detection task we just trained for.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

log = logging.getLogger("forge_veritas.smoke_eval")


# Five hand-rolled (claim, evidence) pairs covering each verdict class —
# selected to be unambiguous so that a model that has actually learned the
# Stage-1 behaviour produces the right verdict. None of these come from
# Vitamin-C's training split.
HELD_OUT_CASES = [
    {
        "claim": "Mount Everest is the tallest mountain on Earth.",
        "evidence": "Mount Everest, located in the Himalayas on the border between Nepal and China, has an elevation of 8,848.86 metres above sea level, the highest of any peak.",
        "expected_verdict": "SUPPORT",
    },
    {
        "claim": "Albert Einstein was born in France.",
        "evidence": "Albert Einstein was born in Ulm, in the Kingdom of Württemberg in the German Empire, on 14 March 1879.",
        "expected_verdict": "CONTRADICT",
    },
    {
        "claim": "The Pacific Ocean is larger than the Atlantic Ocean.",
        "evidence": "The Pacific Ocean covers approximately 165 million square kilometres, while the Atlantic Ocean covers roughly 106 million square kilometres.",
        "expected_verdict": "SUPPORT",
    },
    {
        "claim": "Penguins can fly long distances.",
        "evidence": "Penguins are flightless seabirds; their wings have evolved into flippers that enable swimming rather than flight.",
        "expected_verdict": "CONTRADICT",
    },
    {
        "claim": "The current population of Tuvalu is exactly 11,432.",
        "evidence": "Tuvalu is a small island nation in the Pacific Ocean.",
        "expected_verdict": "NOT_ENOUGH_INFO",
    },
]


def _format_user(case: dict) -> str:
    return (
        f"Claim: {case['claim']}\n\n"
        f"Evidence: {case['evidence']}\n\n"
        "Does the evidence support, contradict, or fail to settle the claim? "
        "Reply with one of SUPPORT / CONTRADICT / NOT_ENOUGH_INFO and "
        "a one-sentence rationale."
    )


# Backward-compat alias — older callers passed simple strings.
HELD_OUT_PROMPTS = [_format_user(c) for c in HELD_OUT_CASES]


def _load_base(model_id: str):
    tok = AutoTokenizer.from_pretrained(model_id)
    if tok.pad_token is None:
        tok.pad_token = tok.unk_token or "<|pad|>"
    model = AutoModelForCausalLM.from_pretrained(model_id)
    model.eval()
    return tok, model


def _load_with_adapter(model_id: str, adapter_dir: str):
    tok, base = _load_base(model_id)
    model = PeftModel.from_pretrained(base, adapter_dir)
    model.eval()
    return tok, model


SYSTEM_PROMPT_EVAL = (
    "You are Veritas-R1, a verification-first research assistant. "
    "Decide whether the given evidence supports, contradicts, or is "
    "insufficient for the claim, and explain in one sentence."
)


def _generate(model, tok, prompt: str, max_new_tokens: int = 96) -> str:
    """Greedy generation — keeps the comparison deterministic. Real eval
    would use temperature 0.2 + multiple samples, but on a 135M model,
    sampling adds noise that hides the signal we care about.
    """
    msgs = [
        {"role": "system", "content": SYSTEM_PROMPT_EVAL},
        {"role": "user", "content": prompt},
    ]
    input_ids = tok.apply_chat_template(msgs, return_tensors="pt", add_generation_prompt=True)
    with torch.no_grad():
        out = model.generate(
            input_ids,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            pad_token_id=tok.pad_token_id,
        )
    completion_ids = out[0, input_ids.shape[1] :]
    return tok.decode(completion_ids, skip_special_tokens=True).strip()


def _extract_verdict(text: str) -> str:
    """Pull the model's verdict label out of its free-text response. We're
    forgiving — the trained format is `VERDICT: rationale` but the base
    model often paraphrases. We accept any of the three labels appearing
    anywhere in the response.
    """
    upper = text.upper()
    # NOT_ENOUGH_INFO must be checked BEFORE 'CONTRADICT' / 'SUPPORT' since
    # the rationale text may contain those words.
    for label in ("NOT_ENOUGH_INFO", "NOT ENOUGH INFO", "CONTRADICT", "SUPPORT"):
        if label in upper:
            # Normalise both not-enough-info spellings.
            return "NOT_ENOUGH_INFO" if "ENOUGH" in label else label
    return "UNKNOWN"


def _avg_nll(model, tok, prompt: str, target: str) -> float:
    """Negative-log-likelihood the model assigns to a "good" completion
    (its own greedy output). Lower NLL ⇒ more confident in this answer
    shape. Trends correctly across training even without a labelled ref.
    """
    msgs = [
        {"role": "system", "content": SYSTEM_PROMPT_EVAL},
        {"role": "user", "content": prompt},
        {"role": "assistant", "content": target},
    ]
    text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
    enc = tok(text, return_tensors="pt", add_special_tokens=False)
    input_ids = enc["input_ids"]
    # Mask the system+user prefix so we score just the assistant tokens.
    prefix_msgs = msgs[:-1]
    prefix_text = tok.apply_chat_template(
        prefix_msgs, tokenize=False, add_generation_prompt=True
    )
    prefix_ids = tok(prefix_text, return_tensors="pt", add_special_tokens=False)["input_ids"]
    labels = input_ids.clone()
    labels[:, : prefix_ids.shape[1]] = -100
    with torch.no_grad():
        out = model(input_ids=input_ids, labels=labels)
    return float(out.loss.item())


def run_eval(
    *,
    base_model: str,
    adapter_dir: str,
    out_path: str,
) -> dict:
    log.info("loading base model id=%s", base_model)
    tok_b, m_base = _load_base(base_model)
    log.info("loading adapter dir=%s", adapter_dir)
    tok_a, m_after = _load_with_adapter(base_model, adapter_dir)

    rows = []
    base_nll_sum = 0.0
    after_nll_sum = 0.0
    base_correct = 0
    after_correct = 0
    base_format_ok = 0
    after_format_ok = 0
    for i, case in enumerate(HELD_OUT_CASES):
        prompt = _format_user(case)
        expected = case["expected_verdict"]
        log.info("[%d/%d] expected=%s claim=%s", i + 1, len(HELD_OUT_CASES), expected, case["claim"][:40])
        before = _generate(m_base, tok_b, prompt)
        after = _generate(m_after, tok_a, prompt)
        before_nll = _avg_nll(m_base, tok_b, prompt, before)
        after_nll = _avg_nll(m_after, tok_a, prompt, after)
        before_verdict = _extract_verdict(before)
        after_verdict = _extract_verdict(after)
        base_nll_sum += before_nll
        after_nll_sum += after_nll
        if before_verdict == expected:
            base_correct += 1
        if after_verdict == expected:
            after_correct += 1
        if before_verdict != "UNKNOWN":
            base_format_ok += 1
        if after_verdict != "UNKNOWN":
            after_format_ok += 1
        rows.append(
            {
                "claim": case["claim"],
                "evidence": case["evidence"],
                "expected": expected,
                "before_text": before,
                "before_verdict": before_verdict,
                "before_correct": before_verdict == expected,
                "after_text": after,
                "after_verdict": after_verdict,
                "after_correct": after_verdict == expected,
                "before_nll": round(before_nll, 4),
                "after_nll": round(after_nll, 4),
                "delta_nll": round(after_nll - before_nll, 4),
            }
        )
    n = len(HELD_OUT_CASES)
    summary = {
        "base_model": base_model,
        "adapter_dir": adapter_dir,
        "num_prompts": n,
        "verdict_accuracy_before": round(base_correct / n, 3),
        "verdict_accuracy_after": round(after_correct / n, 3),
        "format_compliance_before": round(base_format_ok / n, 3),
        "format_compliance_after": round(after_format_ok / n, 3),
        "avg_nll_before": round(base_nll_sum / n, 4),
        "avg_nll_after": round(after_nll_sum / n, 4),
        "avg_delta_nll": round((after_nll_sum - base_nll_sum) / n, 4),
        "rows": rows,
    }
    Path(out_path).write_text(json.dumps(summary, indent=2))
    log.info(
        "eval done: verdict_acc %s -> %s | format %s -> %s | nll %s -> %s",
        summary["verdict_accuracy_before"],
        summary["verdict_accuracy_after"],
        summary["format_compliance_before"],
        summary["format_compliance_after"],
        summary["avg_nll_before"],
        summary["avg_nll_after"],
    )
    return summary


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base-model", required=True)
    p.add_argument("--adapter", required=True)
    p.add_argument("--out", required=True, help="Path to write the JSON report.")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    summary = run_eval(
        base_model=args.base_model,
        adapter_dir=args.adapter,
        out_path=args.out,
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
