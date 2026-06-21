"""Export ft submodels with TIMCSY's exact contract: forward(mix, mag_real).

timcsy's working-on-WebGPU model takes a REAL magnitude spectrogram
[1,4,2048,336] (= view_as_real of the complex STFT, channels [Lr,Li,Rr,Ri])
and the raw mix; it does NOT do _spec or _magnitude internally (those are in JS),
so there is ZERO complex op in the graph. This avoids the dynamo decomposition of
view_as_real/_magnitude that the ORT-web WebGPU EP miscomputes to NaN.

We wrap the gianlourbano-modified HTDemucs to skip _magnitude (feed mag directly).
Exported with LEGACY exporter (dynamo=False) for timcsy-identical WebGPU-safe ops.
"""
import sys, math, torch, torch.onnx
import torch.nn as nn
import torch.nn.functional as F
from demucs.pretrained import get_model
from demucs.hdemucs import pad1d
from demucs.spec import spectro

SOURCES = ['drums', 'bass', 'other', 'vocals']
TRAIN = 343980


def make_mag(mix, hl=1024, nfft=4096):
    """Replicate _spec + _magnitude(cac=True): complex STFT -> real [1,4,2048,336]."""
    le = int(math.ceil(mix.shape[-1] / hl)); pad = hl // 2 * 3
    x = pad1d(mix, (pad, pad + le * hl - mix.shape[-1]), mode="reflect")
    z = spectro(x, nfft, hl)[..., :-1, :][..., 2:2 + le]  # complex [1,2,2048,336]
    # _magnitude cac=True: view_as_real -> permute -> reshape [B, C*2, Fr, T]
    B, C, Fr, T = z.shape
    m = torch.view_as_real(z).permute(0, 1, 4, 2, 3).reshape(B, C * 2, Fr, T)
    return m  # [1,4,2048,336] real


class MagInputModel(nn.Module):
    """HTDemucs forward that takes the REAL magnitude directly (skips _magnitude),
    reproducing the active forward(mix,spec) body from x=mag onward."""
    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, mix, mag):
        m = self.m
        length = mix.shape[-1]
        x = mag  # already the magnitude; skip _spec/_magnitude (done in JS)
        B, C, Fq, T = x.shape
        # fp16-SAFE normalization: torch.std (unbiased) decomposes to mean((x-mu)^2)*N,
        # and N ~ C*Fq*T ~ 2.8M overflows fp16 (max 65504) -> Inf -> NaN on WebGPU.
        # Use BIASED std = sqrt(mean((x-mu)^2)); for large N the unbiased correction
        # N/(N-1) is ~1.0000004 (negligible), and this never forms the N-scaled sum.
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = ((x - mean) ** 2).mean(dim=(1, 2, 3), keepdim=True).clamp_min(0).sqrt()
        x = (x - mean) / (1e-5 + std)
        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = ((xt - meant) ** 2).mean(dim=(1, 2), keepdim=True).clamp_min(0).sqrt()
        xt = (xt - meant) / (1e-5 + stdt)
        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)
        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = x.reshape(b, c, f * t)
                x = m.channel_upsampler(x)
                x = x.reshape(b, x.shape[1], f, t)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                x = x.reshape(b, x.shape[1], f * t)
                x = m.channel_downsampler(x)
                x = x.reshape(b, x.shape[1], f, t)
                xt = m.channel_downsampler_t(xt)
        for idx, decode in enumerate(m.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    pre = pre[:, :, 0]
                    xt, _ = tdec(pre, None, length_t)
                else:
                    skip = saved_t.pop(-1)
                    xt, _ = tdec(xt, skip, length_t)
        S = len(m.sources)
        x = x.view(B, S, -1, Fq, T)
        x = x * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, length)
        xt = xt * stdt[:, None] + meant[:, None]
        return x, xt


def main():
    idx = int(sys.argv[1])
    sub = get_model('htdemucs_ft').models[idx]
    sub.eval()
    wrapped = MagInputModel(sub).eval()
    mix = torch.randn(1, 2, TRAIN)
    mag = make_mag(mix)
    print(f"  [{idx}] {SOURCES[idx]}: mix={tuple(mix.shape)} mag={tuple(mag.shape)} (real)")
    with torch.no_grad():
        x, xt = wrapped(mix, mag)
    print(f"  forward OK x={tuple(x.shape)} xt={tuple(xt.shape)}")
    out = f"htdemucs_ft_{SOURCES[idx]}_ts.onnx"
    torch.onnx.export(
        wrapped, (mix, mag), out, export_params=True, opset_version=17, dynamo=False,
        input_names=['mix', 'mag'], output_names=['x', 'xt'],
    )
    import os
    print(f"  EXPORTED {out}: {os.path.getsize(out)/1e6:.0f}MB (legacy opset17, real mag input = timcsy contract)")


if __name__ == '__main__':
    main()
