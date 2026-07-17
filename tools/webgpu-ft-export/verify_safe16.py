#!/usr/bin/env python3
"""Verify the safe16 (fp16) htdemucs_ft ONNX models are faithful to PyTorch.

Feeds an IDENTICAL (mix, mag) input to both:
  - the PyTorch MagInputModel wrapper (the exact graph we exported, fp32), and
  - the safe16 ONNX (fp16, what ships),
then compares the raw model outputs x (freq mask) and xt (time) at the SAME boundary
(before any iSTFT/mask/combine — those are identical JS math on both sides, so this
isolates the question that matters for safe16: did the fp16 export preserve the model?).

Pass criterion: per-stem correlation ~1.0 and small max-abs error. Anything lower means
the fp16 conversion degraded the model and safe16 should be re-exported (e.g. with an
op_block_list keeping precision-sensitive ops in fp32).

Usage:
  python verify_safe16.py /path/to/webgpu-models    # dir holding htdemucs_ft_*_safe16.onnx

Needs: torch, demucs==4.0.1, onnxruntime, numpy. Run with the same env as the export.
"""
import sys
import math
import importlib.util
import os

import numpy as np
import torch


def main():
    if len(sys.argv) < 2:
        print("usage: python verify_safe16.py <models-dir>")
        sys.exit(1)
    models_dir = sys.argv[1]

    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("exp", os.path.join(here, "export_ft_onnx.py"))
    exp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exp)

    import onnxruntime as ort
    from demucs.pretrained import get_model

    sources = exp.SOURCES
    TRAIN = exp.TRAIN
    model = get_model("htdemucs_ft")

    # A musical-ish stereo proxy (tones + noise). Deterministic seed for reproducibility.
    torch.manual_seed(7)
    t = torch.arange(TRAIN) / 44100.0
    mix = torch.stack([
        0.3 * torch.sin(2 * math.pi * 220 * t) + 0.2 * torch.sin(2 * math.pi * 440 * t) + 0.05 * torch.randn(TRAIN),
        0.3 * torch.sin(2 * math.pi * 223 * t) + 0.05 * torch.randn(TRAIN),
    ])[None]
    mag = exp.make_mag(mix)

    def corr(a, b):
        a = a.flatten().astype(np.float64)
        b = b.flatten().astype(np.float64)
        return float(np.corrcoef(a, b)[0, 1])

    print(f"{'stem':8s} {'x corr':>10s} {'xt corr':>10s} {'x maxErr':>10s} {'xt maxErr':>10s}")
    worst = 1.0
    for i, name in enumerate(sources):
        wrapped = exp.MagInputModel(model.models[i].eval()).eval()
        with torch.no_grad():
            px, pxt = wrapped(mix, mag)
        path = os.path.join(models_dir, f"htdemucs_ft_{name}_safe16.onnx")
        sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        outs = sess.run(None, {"mix": mix.numpy().astype(np.float32), "mag": mag.numpy().astype(np.float32)})
        named = {o.name: a for o, a in zip(sess.get_outputs(), outs)}
        ox = named.get("x", next((a for a in outs if a.ndim == 5), None))
        oxt = named.get("xt", next((a for a in outs if a.ndim == 4), None))
        cx, cxt = corr(px.numpy(), ox), corr(pxt.numpy(), oxt)
        ex = float(np.max(np.abs(px.numpy() - ox)))
        ext = float(np.max(np.abs(pxt.numpy() - oxt)))
        worst = min(worst, cx, cxt)
        print(f"{name:8s} {cx:10.5f} {cxt:10.5f} {ex:10.4f} {ext:10.4f}")

    print()
    ok = worst >= 0.999
    print(f"{'PASS' if ok else 'FAIL'}: worst correlation = {worst:.5f} "
          f"({'safe16 is faithful to PyTorch (fp16 fine)' if ok else 'fp16 export degraded — re-export needed'})")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
