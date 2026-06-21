#!/usr/bin/env python3
"""
Shared device resolution for Loukai Creator Python runners.

Maps a requested device string (auto/rocm/cuda/mps/cpu/directml) onto a real,
working torch device, ALWAYS falling back to a runnable device and NEVER raising.
Emits a human-readable note to stderr when it falls back, so the Creator console
shows why (e.g. "requested rocm but no HIP build; fell back to cpu").

Note on ROCm: ROCm presents to PyTorch AS a 'cuda' device (torch.cuda.is_available()
is True and torch.version.hip is set), so 'rocm' resolves to the 'cuda' code path
after verifying torch.version.hip.
"""

import sys


def _note(msg):
    print(f"DEVICE: {msg}", file=sys.stderr, flush=True)


def _cascade(torch):
    """Default auto-detect: cuda/rocm -> mps -> cpu."""
    if torch.cuda.is_available():
        if getattr(torch.version, "hip", None):
            return "cuda", f"ROCm/HIP {torch.version.hip}"
        try:
            return "cuda", torch.cuda.get_device_name(0)
        except Exception:
            return "cuda", "CUDA GPU"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps", "Apple Silicon GPU"
    return "cpu", "CPU"


def resolve_device(requested):
    """
    Return (device_str, device_name). Never raises.
    requested: 'auto' | 'rocm' | 'cuda' | 'mps' | 'directml' | 'cpu' | None
    """
    import torch

    req = (requested or "auto").lower()

    if req in ("auto", ""):
        dev, name = _cascade(torch)
        _note(f"auto -> {dev} ({name})")
        return dev, name

    if req == "cpu":
        return "cpu", "CPU"

    if req in ("rocm", "cuda"):
        # ROCm and CUDA both run on the 'cuda' device in torch.
        if torch.cuda.is_available():
            is_hip = bool(getattr(torch.version, "hip", None))
            if req == "rocm" and not is_hip:
                dev, name = _cascade(torch)
                _note(f"requested rocm but torch is not a HIP build; fell back to {dev} ({name})")
                return dev, name
            if req == "cuda" and is_hip:
                _note("requested cuda but torch is a ROCm/HIP build; using it (HIP presents as cuda)")
            try:
                name = (
                    f"ROCm/HIP {torch.version.hip}" if is_hip else torch.cuda.get_device_name(0)
                )
            except Exception:
                name = "GPU"
            return "cuda", name
        dev, name = _cascade(torch)
        _note(f"requested {req} but no CUDA/ROCm GPU available; fell back to {dev} ({name})")
        return dev, name

    if req == "mps":
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps", "Apple Silicon GPU"
        dev, name = _cascade(torch)
        _note(f"requested mps but unavailable; fell back to {dev} ({name})")
        return dev, name

    if req == "directml":
        try:
            import torch_directml  # noqa: F401

            return torch_directml.device(), "DirectML GPU"
        except Exception as e:
            dev, name = _cascade(torch)
            _note(f"requested directml but unavailable ({e}); fell back to {dev} ({name})")
            return dev, name

    # Unknown value: fall back to auto cascade.
    dev, name = _cascade(torch)
    _note(f"unknown device '{requested}'; using {dev} ({name})")
    return dev, name


def run_with_cpu_fallback(device, fn):
    """
    Run fn(device). If it fails on a GPU device (vulkan/rocm/cuda/mps op gaps),
    retry once on CPU. Returns (result, actual_device_used). Never silently hides
    the fallback — emits a note.
    """
    import torch  # noqa: F401

    try:
        return fn(device), device
    except Exception as e:
        if device != "cpu":
            _note(f"op failed on {device} ({str(e)[:120]}); retrying on cpu")
            return fn("cpu"), "cpu"
        raise
