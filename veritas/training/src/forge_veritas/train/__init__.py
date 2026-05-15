"""Training entry points.

Modules ship across CP6, CP9, CP11, CP15:
    sft.py     — CP6, Unsloth + TRL SFTTrainer
    grpo.py    — CP9, TRL GRPOTrainer with verifiable rewards
    dpo.py     — CP11, TRL DPOTrainer
    distill.py — CP15, KL distillation 14B → 3B
"""
