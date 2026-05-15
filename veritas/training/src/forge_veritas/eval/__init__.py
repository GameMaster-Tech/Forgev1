"""Evaluation harness — wraps the TS `VeritasR1BenchRunner` over local vLLM.

Modules ship in CP7 + CP12:
    forgebench.py     — CP7, single-checkpoint eval against ForgeBench-Reason
    ablation.py       — CP12, side-by-side base / SFT / GRPO / DPO scoreboard
"""
