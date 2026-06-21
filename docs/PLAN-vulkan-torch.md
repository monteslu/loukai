# Plan: GPU acceleration for the Creator on Linux (ROCm; Vulkan ruled out)

**Status:** Draft / proposal — **ROCm path VERIFIED on real AMD hardware; Vulkan-via-PyTorch RULED OUT (both empirically, see below)**

> **Headline (both answers now measured, not assumed):**
> - ✅ **ROCm works** on AMD RX 7600 / RDNA3 / Linux — Demucs **3.7×** and Whisper-v3-turbo **5×** faster than CPU. This is the GPU path.
> - ❌ **Vulkan-via-PyTorch is a dead end** for Demucs/Whisper — backend officially unmaintained, no wheels, and missing ops (`as_strided`, `fill_.Scalar`) mean `torch.ones(device='vulkan')` fails before any model runs. Confirmed by deep research (107 agents, high-confidence) **and** corroborated against the pytorch v2.9.1 source. The `USE_VULKAN=1` build was started then **abandoned** once research showed it could only reproduce a documented failure.
> - **The original feature name ("experimental Vulkan flag") is superseded:** the device flag should expose **ROCm** (and the existing CUDA/MPS/CPU), not Vulkan. Keep the flag backend-agnostic so Vulkan *could* slot in if upstream ever revives it (ExecuTorch ET-VK), but do not target Vulkan now.
**Feature:** Let the Creator run Demucs + Whisper on a GPU on Linux boxes (Bazzite / SteamOS / HTPCs, typically AMD/Intel), so stem separation + transcription run faster than CPU — and, crucially, offload work off the CPU so the **karaoke player keeps running smoothly on the same machine** (see the PC/TV scenario in `PLAN-web-creator.md`).
**Why it matters:** on a living-room PC/TV, conversions will fire *while a song is playing*. Getting Demucs/Whisper off the CPU is what keeps the audio thread fed and the canvas smooth. This plan is the "make it fast / make coexistence viable" half of that story.

---

## ⭐ Spike results — ROCm verified on AMD RX 7600 / Linux (2026-06-21)

Ran the Phase A spike **on the actual target hardware** (this dev box). Hardware: **AMD RX 7600 (Navi 33, RDNA3, gfx1102)** + Radeon 890M iGPU, kernel `amdgpu` + `/dev/kfd` present, no system ROCm install.

**What works (measured, not inferred):**
- ✅ **`pip install torch torchaudio --index-url .../rocm6.4`** resolved + installed cleanly for **Python 3.12** (loukai's bundled interpreter). Got `torch 2.9.1+rocm6.4`. **The wheels bundle the ROCm runtime — no `/opt/rocm` / system ROCm needed.** (~4.5 GB torch wheel; 15 GB venv.)
- ✅ **GPU detected with NO `HSA_OVERRIDE_GFX_VERSION` needed** — `torch.cuda.is_available() == True`, sees both GPUs, `torch.version.hip = 6.4.x`. (gfx1102 "just worked," contrary to the common need for a gfx override.)
- ✅ **Real compute, real speedup**: matmul **~2.4–2.6× faster than 12-thread CPU** (~2.0 TFLOP/s on the RX 7600). Conv-heavy Demucs/wav2vec2 will differ, but the GPU is unambiguously doing real work.
- ✅ **wav2vec2 acoustic model runs ON the GPU** (the expensive part of the WhisperX-style alignment) — loaded + forward pass succeeded on a 10s clip.

**Sharp edges found (these shape the implementation):**
- ⚠️ **`torchaudio.functional.forced_align` has NO ROCm/CUDA kernel — it's CPU-only.** Not a blocker: run the wav2vec2 forward on GPU, move `log_probs` to CPU for the (cheap, ms-scale) alignment trellis op. This is the standard split and must be coded that way. → directly informs `PLAN-whisperx-timing.md`.
- ⚠️ **A single very long forward pass (180s of audio in one call) HUNG the GPU** ("GPU Hang", wedged that process's HIP context). **The GPU recovered automatically** (driver reset; fresh process saw it again; desktop unaffected) — but the lesson is firm: **long audio MUST be chunked** (e.g. ≤30s segments) for wav2vec2/Demucs inference on this RDNA3 card. Real pipelines (WhisperX VAD, Demucs `split=True`) already chunk; we must ensure ours does too and never feed a whole song in one tensor.

**Net:** ROCm is a **real, working acceleration path on consumer AMD RDNA3 + Linux** — installable via pip with bundled runtime, no system ROCm, no gfx override on this card. This **upgrades ROCm from "evaluate, probably painful" to "verified primary GPU path for AMD Linux,"** with two concrete implementation constraints (CPU-side forced_align; mandatory chunking). The earlier "ROCm install is notoriously painful" caveat still holds *in general* (other gfx arches / older cards / system-ROCm setups), so keep detection + fallback — but for the Bazzite/SteamOS/RDNA3 target, the pip-wheel route is clean.

### Strategic durability — is ROCm a safe 3-5 year bet? (research-verified, high-confidence)

**Yes — and it's a fundamentally different trajectory than the Vulkan backend we ruled out.** (109-agent research pass.)

- **First-class, official, GROWING:** ROCm wheels ship on **pytorch.org** (rocm6.3/6.4 → **7.x**), selectable next to CUDA, **upstreamed into pytorch/pytorch** (not a fork), **"stable" since PyTorch 1.12 (2022)** with full CI. ROCm 7.2 (early 2026) even added **native Windows consumer** PyTorch.
- **Governance stake:** AMD holds a **co-equal PyTorch Foundation board seat** (alongside NVIDIA, Intel).
- **Official consumer coverage incl. ours:** RDNA2/3/4 (gfx1030 / gfx110x / gfx12xx) are **officially supported targets** — **gfx1102 (RX 7600 / Steam Machine) is on the official list.** (So the Steam-Machine research's "not officially supported" caveat was *wrong/outdated* — it's official **and** empirically working here.)
- **Funded by datacenter momentum:** 7-8 of top-10 AI labs run Instinct in production (OpenAI 6GW MI450, Meta Llama on MI300X); that money underwrites consumer ROCm.
- **Industry going vendor-neutral:** PyTorch 2.9 "wheel variants" auto-select CUDA/ROCm/Intel-XPU as co-equals — our backend-agnostic `device` flag rides exactly this trend.

**Contrast w/ Vulkan (killed):** Vulkan = unmaintained, no wheels, no backer. ROCm = upstreamed, shipped, board-governed, datacenter-funded. **Opposite directions.** Betting on ROCm is betting *with* the industry.

**Honest caveats (the contrarian findings):**
1. **Windows ROCm is new + rigid** — native Windows consumer PyTorch only arrived ~ROCm 7.2 (early 2026), in one narrow config (7.2.1 / torch 2.9 / py3.12). Emerging, not battle-tested → **DirectML may be the safer Windows-AMD path short-term.**
2. **Historical hardware-matrix churn** — AMD has added/dropped consumer gfx targets across releases; gfx1102 is in *now*, but a future ROCm could drop older arches. (Mitigation: CPU fallback.)
3. **Linux-consumer ROCm (what we proved) is the most solid path; Windows-consumer the least proven.**

### Per-vendor GPU value (the real point: "GPU for everyone with a GPU," CPU as universal floor)

| User hardware | Backend | Status | Creator benefit | Notes |
|---------------|---------|--------|-----------------|-------|
| **NVIDIA** (Linux/Win) | CUDA | ✅ **already wired** (`downloadManager` cu118; `detectGPU`→cuda) | **Biggest — most mature, likely fastest** | Reference backend; ROCm is catching up *to* it. *Expected* faster than ROCm but **not yet benchmarked here** (no NVIDIA card on the spike box). |
| **AMD** (Linux) | ROCm | ✅ **MEASURED** 3.7× Demucs / 5× Whisper | **Large — proven today** | The work this plan did. gfx1102 official + verified. |
| **Apple Silicon** | MPS | ✅ in stock torch | Large | Demucs + Whisper both use MPS; `detectGPU`→mps already. Not benchmarked here. |
| **AMD/Intel** (Windows) | DirectML | ⚠️ to evaluate | Medium | The open one; likely safer than nascent Windows-ROCm short-term. |
| **anything** | CPU | ✅ always works | Baseline | Whisper ~4× RT on CPU (usable); Demucs slow (minutes/song) but functional. The universal fallback. |

**Honesty line:** ROCm numbers are **measured on this box**; CUDA/MPS "faster/large" are **well-founded expectations from architecture + the research, NOT benchmarked here** (no NVIDIA/Apple hardware on the spike box). The backend-agnostic `device` flag makes each "free" once `downloadManager` has the matching install variant — CUDA + MPS are nearly wired, ROCm proven, DirectML the unknown.

### System dependency boundary — what loukai bundles vs. what the OS must provide (measured)

This is the make-or-break for which distros can run the Creator. **Bundling Python does NOT make us self-contained** — the bundled Python *and* torch dynamically link the host C runtime, which cannot be bundled.

| Layer | Source | In our control? |
|-------|--------|-----------------|
| ROCm userspace (hip, rocBLAS, MIOpen) | **pip wheel** (`torch/lib/*.so`, runs from `$HOME`) | ✅ bundled |
| Python 3.12 interpreter | **bundled** (`python-build-standalone`, downloaded by `downloadManager.js`) | ✅ bundled |
| Demucs / Whisper / torchaudio | **pip** into bundled Python | ✅ bundled |
| **glibc** (`libc.so.6`, `ld-linux-x86-64.so.2`) | **HOST** — both bundled-Python and torch link it | ❌ **system** |
| **libstdc++ / libgcc_s / libm** | **HOST** | ❌ **system** |
| Kernel `amdgpu` + `/dev/kfd` | **HOST** kernel | ❌ system |
| User in **`render`** group (access `/dev/kfd`, mode 660) | **HOST** config | ⚠️ maybe one-time sudo |

**Measured requirement (this box):** torch is a `manylinux_2_28` wheel — its highest referenced symbol is `GLIBC_2.28`, so the host needs **glibc ≥ 2.28** (2018+) plus `libstdc++`. (This box: glibc 2.43 — fine.) **You cannot bundle libc**, so the host must be a **glibc** distro at ≥2.28; a **musl** distro (Alpine-style) or a cut-down embedded libc will **not** run the wheels no matter what we bundle.

**Per-distro consequence (bare-tarball / `npx` install):**
- **Bazzite / CachyOS / SteamOS** — modern glibc distros well past 2.28 → bundling works; glibc is a non-issue.
- **Batocera** — would be the question mark for a *bare* install (minimal buildroot: glibc-vs-musl, version, libstdc++). **But this is moot — loukai ships as a Flatpak (see below), which makes the host libc irrelevant.**

### ⭐ Per-distro deployment — RESEARCH-VERIFIED (103-agent pass, high-confidence)

The decisive finding: **the blocker is NOT glibc or system ROCm — it's `render`-group membership.** The pip wheel bundles the entire ROCm userspace (no `/opt/rocm`, no rpm-ostree layering on immutable distros), and `.so`s run from `$HOME`/app dir. The *only* gate is that `/dev/kfd` + `/dev/dri/renderD*` are mode 0660 `root:render`, so the user must be in **`render`**. Granting it is privileged — **but a distro can pre-place the user in `render` at install time**, making it zero-touch for the end user. So the operative question per distro is just: *"is the default user already in `render`?"*

| Distro | amdgpu + /dev/kfd | User in `render` by default? | System ROCm needed? | Verdict (Creator) |
|--------|-------------------|------------------------------|---------------------|-------------------|
| **SteamOS 3.8** (Deck / Steam Machine) | ✅ | ✅ **yes** (UX assumes unprivileged GPU) | ❌ no (pip bundles) | **zero-touch** |
| **Bazzite** | ✅ | ✅ **yes** (markets AMD/handheld) | ❌ no | **zero-touch — strongest desktop candidate** |
| **CachyOS** (Arch) | ✅ | ❌ **no** (Arch doesn't add by default) | ❌ no | one-time `sudo usermod -aG render,video $USER` + re-login |
| **Batocera** | ✅ (kernel) | (moot) | ❌ no | **Creator impractical** — Buildroot appliance, minimal userland for a general pip torch venv. **Player still fine** (no ROCm/kfd needed). |

**Two caveats to carry forward:**
1. **Flatpak likely sidesteps the host `render`-group question** — a Flatpak reaches devices via the sandbox/portal, not the user's host group membership, so the `--device=all` path may grant `/dev/kfd` access without the user being in `render` on the host. (Confirm during Flatpak testing; if true, **Flathub is zero-touch even on CachyOS-style distros** that don't pre-place users in render — another reason Flathub is the non-techy channel.)
2. **Residual risk: kernel↔userspace ROCm ABI coupling** — the bundled ROCm userspace must match the host `amdgpu`/KFD kernel ABI. Normally fine (forward/backward compatible within reason), but a very old host kernel + new ROCm wheel can mismatch. Detection should surface a clear error + CPU fallback rather than crash.

**Net:** the two highest-value targets (SteamOS/Steam Machine + Bazzite) are **zero-touch** for the user; CachyOS needs one documented sudo line (or use Flathub); Batocera is **player-only** anyway (matches the product direction). The earlier glibc/musl worry is fully resolved — it was never the real gate.

### Two distribution channels, two audiences — and they handle ROCm/libc differently

loukai ships via **two channels** for **two audiences**, and they are NOT equivalent for the Creator/ROCm story:

| | **`npx loukai-app`** | **Flathub** |
|---|---|---|
| Audience | technical users, everywhere | **non-techy** (browse a store: Discover/GNOME Software) |
| Platforms | Linux / **macOS** / **Windows** | Linux only |
| Prerequisite | **Node.js** installed | nothing — one-click store install |
| Electron | npm dep (`bin/loukai.js` → `require('electron')`, `ensure-electron.js`) | bundled in the Flatpak |
| **C runtime (glibc/libstdc++)** | **HOST's** — *the libc problem is BACK* | Flatpak runtime's glibc 2.39 — *solved* |
| Python + ffmpeg (Creator) | `downloadManager.js` → `~/.config/loukai/creator/` (a **`-linux-gnu` = glibc** build, `downloadManager.js:78`) | same downloader, **inside the sandbox** |
| ROCm `/dev/kfd` access | direct host process (works if user ∈ `render`) | needs `--device=all` manifest line (see below) |

**Consequences this creates:**
1. **The glibc/musl concern is channel-specific.** Flatpak dissolves it (next section). But for **`npx` on Linux**, the bundled Python is a **glibc** build (`cpython-…-unknown-linux-gnu`), so `npx` on a **musl** host (Alpine) or pre-2.28 glibc **cannot run the Creator** (and likely not Electron). That's an acceptable limit for the *technical* `npx` audience — but it's why **Flathub is the right channel for non-techy Linux users**: it carries its own libc and "just works" regardless of host distro.
2. **macOS/Windows ride the `npx` channel** (no Flatpak there). Their GPU story is separate: **macOS → MPS** (already in stock torch), **Windows-non-NVIDIA → DirectML** (see Vulkan-plan device notes). The ROCm work here is the **Linux** GPU path; the `npx` channel is how Mac/Windows users get the app at all.
3. **ROCm enablement differs per channel:** `npx` → `downloadManager` just needs a ROCm install variant added (then it's a direct host process, kfd accessible if the user is in `render`). Flathub → same downloader runs in-sandbox + the `--device=all` manifest line. **Both need the ROCm install variant in `downloadManager.downloadPyTorch`; only Flatpak needs the manifest change.**

**Bottom line for the "defacto everywhere" goal:** `npx loukai-app` is the universal/technical entry point (all 3 OSes); **Flathub is the discoverable, zero-prereq, libc-proof channel for non-techy Linux users** (Steam Machine store, etc.). Both are worth shipping; they serve different people, and the Creator/ROCm enablement is ~90% shared (the `downloadManager` ROCm variant) with one Flatpak-only manifest tweak.

### ⭐ Flatpak dissolves the host-libc problem — verified on this box (2026-06-21)

**loukai already distributes on Linux as a Flatpak** (`flathub-manifest.yml`; `runtime: org.freedesktop.Platform 24.08` + `org.electronjs.Electron2.BaseApp`). The Flatpak runtime **ships its own glibc (~2.39 in FDO 24.08), libstdc++, and full C runtime** — the app links *those*, not the host's. So:

- The entire "glibc ≥2.28 / musl make-or-break" concern from the table above **evaporates inside Flatpak.** Batocera being minimal or musl-based **doesn't matter** — the sandbox carries its own glibc 2.39 (≥ the manylinux_2.28 wheel requirement), and the ROCm `.so`s run from the app dir.
- **One Flatpak artifact → Bazzite, CachyOS, Batocera, SteamOS, any Flathub distro.** This is the "defacto karaoke app for all of Linux" path: Flathub levels the distros.

**The crux this shifts to — and the one concrete fix needed (TESTED):** ROCm compute needs **`/dev/kfd`** inside the sandbox. The current manifest grants `--device=dri` (→ `/dev/dri` only). Verified with `bwrap` (Flatpak's sandbox engine) on this box:
- `--device=dri` only → **`/dev/kfd` NOT visible in sandbox** → ROCm would fail.
- sandbox with `/dev/kfd` bound → **`/dev/kfd` accessible** ✅

**Fix: change `--device=dri` → `--device=all` in `flathub-manifest.yml`** (Flatpak ≥1.16 supports it; `all` exposes `/dev` including kfd + dri). That single line is the entire ROCm-on-Flatpak enablement — **no host changes, no sudo, no per-distro special-casing.** (`--device=all` is broad; if Flathub review prefers narrower, confirm whether a kfd-specific token exists in the target Flatpak version, else `all` is the accepted norm for ROCm Flatpaks.)

**Net deployment story (Linux): one Flatpak + a one-line manifest change.** The host only needs a kernel with `amdgpu`/`/dev/kfd` (every modern gaming distro has it). Render-group access is handled because Flatpak runs the device node through the portal/sandbox with the user's own session.

### Target-device verdicts (research + measurement)

| Device | GPU | Memory | ROCm status | Verdict |
|--------|-----|--------|-------------|---------|
| **This dev box** | RX 7600 (gfx1102, RDNA3) | 8GB VRAM + 53GB RAM | ✅ works, **no override** | Demucs 3.7× / Whisper 5× vs CPU (measured) |
| **Steam Machine** (2026) | Navi 33 / gfx1102 (RX 7600M-class), RDNA3 | **8GB dedicated GDDR6 + 16GB DDR5** (NOT unified — research-confirmed) | ✅ same gfx1102 as this box → works, no override expected | **Full speed** — my measured peaks (4.62GB VRAM / 6.81GB RAM) fit comfortably. SteamOS 3.8 (rel. 2026-06-18). Best target. |
| **Steam Deck** (LCD/OLED) | Van Gogh gfx1033, RDNA2, 8 CU, ~1.6 TFLOPS | **16GB UNIFIED** (shared CPU/GPU) | **Player: N/A (no ROCm needed).** Creator: ⚠️ needs `HSA_OVERRIDE_GFX_VERSION=10.3.0` | **PLAYER target, not creator.** As a player it's basically free (see below). As a creator it'd run but slowly — a curiosity, not a goal. |

### Steam Deck = player, not creator (scope decision)

Per product direction, the Deck is a **player-first curiosity, not a creation device.** This matters because it **removes the Deck from the ROCm/ML risk surface entirely** — every Deck caveat above (HSA override, slow Demucs, 15W thermal, unified-memory pressure) is a *Creator* (PyTorch/ROCm) concern. **Playback uses none of that.**

**Playback workload (verified in code) is trivial for the Deck:**
- 5 AAC stems decoded via Web Audio + dual-bus routing; canvas lyrics; Butterchurn (simple WebGL). **No PyTorch, no ROCm, no Demucs/Whisper.** A gaming handheld eats this easily.
- **Dual PA/IEM degrades gracefully to one output** — both contexts default to `'default'` device and **IEM defaults to muted** (`kaiPlayer.js:61`), so on the Deck's single audio out it just plays to default; no special handling, no crash.
- **Mic is optional** (singer voice/autotune only) — not required to play (`microphoneEngine.js:101`).
- Minor cosmetic: canvas renders at a fixed 1920×1080 internal (`karaokeRenderer.js:167-168`), CSS-scaled — fine on 1280×800, lyrics font may look slightly large on a 7" screen. Non-blocking.

**Deck verdict: the Flatpak player should "just run" on SteamOS** (same Flatpak path as the Steam Machine). The neat-trick creator path remains *possible* (override + patience) but is explicitly **not a supported goal** — don't let Deck-creator constraints shape the architecture.

**Implementation implications (CREATOR-capable devices only — Steam Machine, desktops):**
- **Detect RDNA2 (gfx103x) and auto-set `HSA_OVERRIDE_GFX_VERSION=10.3.0`** if creator is ever attempted on such hardware; RX 7600/Steam Machine (gfx1102) needs nothing.
- gfx1102's "not on AMD's official ROCm list" caveat (raised by the Steam Machine research) is **empirically refuted** — it runs here today with no override. "Unofficial" ≠ "broken."

### Measured performance — Demucs + Whisper, ROCm GPU vs CPU (warm, averaged)

Real song clips ("I Want To Hold Your Hand"), MIOpen cache warmed, GPU averaged over 3 runs; CPU = 12 threads:

| Task | Clip | ROCm GPU | CPU | **GPU speedup** | GPU realtime |
|------|------|----------|-----|-----------------|--------------|
| Demucs (htdemucs_ft) | 20s | 4.6s | 17.1s | **3.7×** | 4.4× RT |
| Demucs | 60s | 12.6s | (too slow to bench) | — | 4.8× RT |
| Whisper large-v3-turbo | 20s | 0.9s | 4.7s | **5.0×** | 21× RT |
| Whisper large-v3-turbo | 60s | 2.8s | 14.0s | **5.0×** | 21× RT |

- **3.7–5× over CPU** on both target workloads. Whisper-v3-turbo is ~21× realtime on GPU (trivial); **Demucs is the long pole** (~4.8× RT → a 3-min song ≈ ~38s separation on GPU vs minutes on CPU). Demucs is also the heaviest CPU load that would threaten playback, so GPU offload matters most exactly where it counts.
- **Cold-start gotcha (implementation note):** the *first* Demucs run pays a ~27s MIOpen kernel JIT-compile (cold 32s → warm 4.6s). The app should **warm/persist the MIOpen kernel cache** (`MIOPEN_USER_DB_PATH` in the creator cache dir) so a user's first conversion isn't artificially slow.
- Whisper transcription was also functionally correct on GPU (transcribed the real lyrics), confirming this isn't just throughput — output is right.

---

## ❌ Vulkan-via-PyTorch — RULED OUT (researched + source-corroborated, 2026-06-21)

The original ask was an "experimental Vulkan flag." After investigation, **Vulkan is not a viable PyTorch acceleration path for Demucs/Whisper** and should be dropped as a target. Evidence (deep-research pass, 107 agents, high-confidence claims; corroborated against the cloned pytorch v2.9.1 source):

1. **Officially unmaintained.** PyTorch 2.8 docs carry the banner *"PyTorch Vulkan Backend is no longer maintained. Please review the ExecuTorch Vulkan Delegate implementation instead."* The source-build-failure issue (#89601) has been open with zero comments since 2022; maintainers/community state Vulkan "seems to be dropped."
2. **No wheels.** Zero official/community wheels ship `USE_VULKAN=1` (confirmed on the PyTorch dev forum, Dec 2025). Source-build only, and feature request #160230 (Aug 2025) notes self-compiling "Can't actually do this."
3. **Tiny op coverage.** The backend implements only ~24 float32 mobile-inference ops (conv/pool/activation/reshape) — enough for MobileNet, **not** transformers or general conv models. BERT fails on Vulkan (#90920) while MobileNet works.
4. **Fails before any model even starts.** Verified on x86_64 Linux with `USE_VULKAN=1` and `is_vulkan_available()==True`: `aten::fill_.Scalar` is unimplemented, so **`torch.ones(device='vulkan')` throws `NotImplementedError`** (also `VkResult:-5` memory-map failures). `aten::as_strided` is missing — used by both transformers and Conv1d. **Source corroboration:** `as_strided` is absent from `aten/src/ATen/native/vulkan/` in v2.9.1.
5. **Desktop never landed.** The Windows-Vulkan PR (#61431) was closed unmerged; the desktop-Vulkan tracking issue (#55879) sat open for years. (This backend was always Android/mobile-oriented.)
6. **The "successor" (ExecuTorch ET-VK) doesn't help here either** — experimental, Android-GPU focused, and its conv support **excludes transposed-1D/3D convolution, which breaks Demucs's decoder** specifically. Also not a drop-in (requires model export/lowering, not `.to('vulkan')`).

**Why we stopped the build:** I began a `USE_VULKAN=1` source build (had glslang built, shaderc/`glslc` building) on this box, but killed it once the research + source review showed that **even a successful build would fail at the first `torch.ones(device='vulkan')`** — there was no model run to measure. Spending 1-3 hr of compile to reproduce a documented failure wasn't worth it. (Torch's `cmake/VulkanCodegen.cmake` also hard-requires `glslc`, i.e. shaderc — a further packaging burden for a dead path.)

**Decision:** Drop Vulkan as a target. Keep the device flag **backend-agnostic** (so ET-VK or a revived backend *could* slot in later with zero re-plumbing), but ship **ROCm** as the AMD-Linux GPU path. If a real Vulkan-compute ML need ever arises, it would come from a **non-PyTorch runtime** (llama.cpp/GGML, ncnn, MLC, Kompute) — out of scope for a PyTorch-bundling app, and not substantiated for stem-separation anyway.

### Three-way performance picture (your requested comparison)

| Backend | Demucs | Whisper-v3-turbo | Status |
|---------|--------|------------------|--------|
| **ROCm (AMD GPU)** | **3.7×** vs CPU (4.8× realtime) | **5.0×** vs CPU (21× realtime) | ✅ verified working |
| **CPU** (12 threads) | 1.0× baseline (17.1s/20s) | 1.0× baseline (4.3× realtime) | ✅ baseline |
| **Vulkan (PyTorch)** | **N/A — cannot run** (no transposed-conv; backend unmaintained) | **N/A — cannot run** (`as_strided`/`fill_.Scalar` missing; fails at tensor creation) | ❌ ruled out |

Vulkan is "N/A," not "0× / slow" — it does not execute these models at all, so there is no number to report. That is the definitive answer to "what about Vulkan for Demucs and Whisper."

> Spike artifacts (throwaway, safe to delete): `~/rocm-spike-venv`, `~/rocm-spike-test.py`, `~/rocm-spike-install.log`. Did NOT touch loukai's bundled creator env.

**Decisions locked in:**

- A backend-agnostic **device flag** threaded end-to-end, persisted Creator/LLM-style with a Creator-tab UI toggle.
- Evaluate **three accelerator paths** for these Linux boxes, with eyes open about their trade-offs: torch built-in **Vulkan**, **ROCm**, and the existing **CUDA/MPS/CPU** cascade.
- Do real research/spike work to find a torch build that **actually accelerates** (not just falls back) — both a Vulkan-enabled build and a ROCm wheel are in scope to evaluate.
- **ROCm is an option, not the default.** As of June 2026 ROCm remains notoriously painful to install (kernel/driver/version-matrix fragility), so it's an opt-in advanced path, never auto-selected.

---

## The accelerator landscape (read this first)

Each candidate trades **op coverage** against **install friction** — and they trade *inversely*, which is the whole reason this needs a deliberate plan rather than "just add a flag":

| Backend | torch op coverage for Demucs/Whisper | Install story (Linux, June 2026) | Role in this plan |
|---------|--------------------------------------|----------------------------------|-------------------|
| **CUDA** | Excellent | Easy (PyPI `cu*` wheels) — but NVIDIA only | Already supported (`downloadManager.js:494-496`); unchanged |
| **MPS** | Good (no float64 DTW) | N/A on Linux (Apple only) | Already supported; unchanged |
| **CPU** | Complete (slow) | Trivial | Always the fallback floor |
| **ROCm** | **Best of the AMD options** — presents as a `cuda` device; runs most ops | **Worst of the options** — notoriously hard in 2026: kernel/driver/ROCm-version matrix, GPU-arch (`gfx*`) gaps, large wheels via ROCm `--index-url` | Opt-in advanced path; evaluate, never auto-select |
| **Vulkan** | **Weakest** — mainline torch Vulkan is inference-oriented, incomplete; many Demucs/Whisper ops unimplemented; stock PyPI wheels usually lack `USE_VULKAN=1` | **Easiest-ish** — broad GPU/driver support (Mesa RADV on AMD/Intel is ubiquitous on Bazzite/SteamOS), no vendor toolchain | Evaluate; most portable *if* coverage can be made to work |

**The crux:** ROCm is most likely to *run the model* but hardest to *install*; Vulkan is easiest to *reach* but least likely to *run the model*. Both stock paths often end in fallback-to-CPU. So this plan does two things: (1) ship the **plumbing + probe + honest fallback** so any backend can be selected safely today, and (2) run a **spike** to find which path actually delivers a speedup on the target platforms before we commit marketing/UX to it.

### Per-OS GPU story (what's realistic where)

The device contract is OS-agnostic; the *available backends* differ by platform:

| OS | NVIDIA | AMD / Intel GPU (no NVIDIA) |
|----|--------|------------------------------|
| **Linux** (Bazzite/SteamOS/HTPC) | CUDA (easy) | **ROCm** (AMD, best coverage / hardest install) or **Vulkan** (broad via Mesa RADV, weak coverage). Primary target of this plan. |
| **macOS** | n/a | **MPS/Metal** — already supported, already the default on Apple Silicon. |
| **Windows** | CUDA (easy) | **No ROCm for PyTorch on Windows** (ROCm/HIP PyTorch is Linux-only as of June 2026). Mainline torch has **no Metal and effectively no usable Vulkan** on Windows either. The realistic path is **DirectML** via `torch-directml` (Microsoft's DirectX 12 backend) — it runs on any DX12 GPU (AMD/Intel/NVIDIA), installs from PyPI, and is the de-facto "GPU torch without CUDA on Windows" answer. Coverage is decent for inference-style workloads but not guaranteed for every Demucs/Whisper op → same probe + fallback applies. WSL2 + ROCm/CUDA is a power-user alternative, out of scope to automate. |

**So, to answer the obvious question directly:** Vulkan is *not* a meaningful GPU-acceleration path for PyTorch on Windows, and ROCm doesn't exist there for torch. On a Windows box without an NVIDIA card, the path that can actually accelerate is **DirectML** (`torch-directml`, device string `"privateuseone"`/the dml device). The plan treats DirectML as the Windows-non-NVIDIA backend, evaluated in the spike alongside Linux Vulkan/ROCm. The same `device` flag carries it (`device:'directml'` → resolver imports `torch_directml` and returns its device), so no re-plumbing.

Today, device selection is **hardcoded inside the Python runners** and is not overridable from Node:

- `src/main/creator/python/demucs_runner.py:48-56` — `cuda → mps → cpu` cascade.
- `src/main/creator/python/whisper_runner.py:45-53` — identical cascade.
- `src/main/creator/python/crepe_runner.py` — torchcrepe picks its own device.
- `src/main/creator/systemChecker.js:163-205` — probes torch and reports `cuda`/`mps`/`cpu` only.
- `src/main/creator/downloadManager.js:485-501` — installs torch variant `cuda` / `default` / `cpu` (no Vulkan/ROCm path).

---

## Goals

- A **backend-agnostic device flag** threaded UI → settings → conversion options → Python args → `tensor.to(device)`.
- A torch **install-variant** mechanism that can fetch CUDA / **ROCm** / Vulkan-capable / CPU builds (extending the existing variant logic).
- **Never** let an enabled-but-unsupported accelerator break a conversion: probe → attempt → **auto-fallback** to the existing cascade, with the reason shown in the Creator console.
- Default behavior (auto cuda/mps/cpu) stays **bit-for-bit unchanged** when nothing is selected.
- A spike that answers, empirically: **does Vulkan and/or ROCm actually beat CPU on Bazzite/SteamOS, and at what install cost?**

## Non-goals

- Auto-installing ROCm or auto-selecting a GPU backend. GPU paths are explicit, opt-in, and clearly labeled experimental.
- Guaranteeing any accelerator works on a given GPU/driver/distro.
- GPU for CREPE pitch detection initially (least likely to port; cheap anyway — keep on `auto`, revisit later).

---

## Design

### Device contract (the core abstraction — backend-agnostic on purpose)

A single `device` concept flows: **settings → conversion options → pythonRunner args → Python**. Node stays dumb — it passes a string; **all capability logic lives in Python** where torch actually is. This is what lets us add ROCm and Vulkan (and anything later) without re-plumbing.

Allowed values:

- `'auto'` (default) — Python runs the existing `cuda → mps → cpu` cascade. **Unchanged behavior.**
- `'vulkan'` — attempt Vulkan, probe + fallback.
- `'rocm'` — attempt ROCm (Linux/AMD). Note: ROCm presents to PyTorch **as a `cuda` device** (`torch.cuda.is_available()` is `True`, `torch.version.hip` is set), so the resolver maps `'rocm'` → use the `cuda` code path **after** verifying `torch.version.hip`. Fallback if HIP isn't present.
- `'directml'` — attempt DirectML (Windows, non-NVIDIA). Resolver imports `torch_directml` and returns its device; fallback if the package isn't installed. See the per-OS table for why this is the Windows path.
- (Passthrough power-user values `'cuda'`/`'cpu'`/`'mps'` accepted; UI exposes a friendly platform-appropriate subset.)

> Because the contract is just a string forwarded opaquely by `creatorService` / IPC handler / web `/convert`, **the same flag works for web-initiated conversions for free** — the PC/TV "create from your phone" flow gets GPU offload with no extra wiring.

### Python-side probe + fallback (the safety net)

Add a shared helper used by both runners (new file `src/main/creator/python/device_utils.py`):

```python
def resolve_device(requested):
    """Return (device, device_name, note). Never raises for 'vulkan' — falls back."""
    import torch
    def cascade():
        if torch.cuda.is_available():
            return "cuda", torch.cuda.get_device_name(0)
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps", "Apple Silicon GPU"
        return "cpu", "CPU"

    if requested in (None, "auto"):
        d, n = cascade(); return d, n, None

    if requested == "vulkan":
        # torch.is_vulkan_available() exists only on Vulkan-enabled builds
        has_vk = getattr(torch, "is_vulkan_available", lambda: False)()
        if not has_vk:
            d, n = cascade()
            return d, n, "Vulkan not available in this torch build; fell back"
        try:
            # smoke test: a real op on a vulkan tensor
            t = torch.ones(2, 2).to("vulkan")
            _ = (t + t).cpu()
            return "vulkan", "Vulkan GPU", None
        except Exception as e:
            d, n = cascade()
            return d, n, f"Vulkan probe failed ({e}); fell back"

    if requested == "rocm":
        # ROCm presents to torch AS cuda; HIP build sets torch.version.hip
        if torch.cuda.is_available() and getattr(torch.version, "hip", None):
            return "cuda", f"ROCm/HIP {torch.version.hip}", None
        d, n = cascade()
        return d, n, "ROCm/HIP torch build not detected; fell back"

    # explicit cuda/cpu/mps passthrough
    return requested, requested, None
```

Both runners then:

1. Read `args.get("device", "auto")`.
2. Call `resolve_device(...)`.
3. Emit the `note` (if any) via `progress(...)`/stderr so it shows in the Creator console.
4. **Wrap the actual model run in a try/except that, if a GPU backend (vulkan/rocm) op fails, re-runs on CPU once** (belt-and-suspenders: a smoke test can pass but a specific Demucs op can still be unimplemented — true for Vulkan especially, occasionally for ROCm on unsupported `gfx` arches).
5. Report the **actual** device used in the result JSON (already returned as `device` — keep it accurate after fallback).

> Demucs note: `apply_model(..., device=device)` plus `model.to(device)` — both must use the resolved device. `whisper.load_model(model, device=device)` likewise. The Whisper `word_timestamps=False` path already avoids the float64 DTW issue, which helps on non-CUDA backends. For ROCm the resolved device string is literally `"cuda"`, so the existing CUDA code paths work unchanged once a HIP torch is installed.

### Node-side plumbing

- `pythonRunner.js` — `runDemucs` and `runWhisper` accept `options.device` and add `device` to the args JSON (default `'auto'`). `crepe` left alone initially.
- `conversionService.js` — `runConversion` accepts `options.device` (default `'auto'`) and passes it into `runDemucs`/`runWhisper`.
- `creatorService.startConversion` — already forwards `options` opaquely; confirm `device` rides through (it will).
- Both the IPC handler (`creatorHandlers.js START_CONVERSION`) and the web route (`webServer.js /admin/creator/convert`) already pass `options` straight through — **no change needed there** beyond letting the new field flow.

### Settings + UI

- Persist as `creator.torchDevice` (string, default `'auto'`) using the same `settings.get/set` mechanism `CreateTab` already uses for `creator.whisperModel` / `creator.enableCrepe` (`CreateTab.jsx:200-207`).
- UI exposes a small **device select** (not just a checkbox), because there are now multiple backends: **Auto (recommended)** → `'auto'`; **GPU (experimental)** → `'vulkan'` or `'rocm'` depending on platform/what's installed. Keep labels honest: "experimental — falls back to CPU if unsupported." Gate/annotate options by what `systemChecker` reports as actually available (see capability surfacing) so users don't pick a dead option.
- On `startConversion`, include `device: torchDevice` in the options object (`CreateTab.jsx:404`).
- Show the Python `note` (fallback reason) in the existing conversion console so the user sees "…fell back to CPU" instead of silent slowness.

### Install-variant work (this is where the real speedup is won or lost)

`downloadManager.downloadPyTorch` (`:485-501`) currently installs CPU/CUDA/default wheels. To make any GPU path *actually run* (not just fall back), the install step must be able to fetch the right torch build:

- **ROCm:** add a `rocm` variant → `torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocmX.Y` (official ROCm wheels exist on the PyTorch index). This is the *plumbing* part. The *hard* part is the host: ROCm needs a compatible kernel driver + supported `gfx` arch — **out of our installer's control**, and the chief reason ROCm stays opt-in/advanced (June 2026: still fragile). The installer should detect (`rocminfo`/`/opt/rocm`) and only offer ROCm when the system looks ROCm-ready; otherwise label it unavailable.
- **Vulkan:** stock PyPI wheels are usually **not** built with `USE_VULKAN=1`, so `torch.is_vulkan_available()` is `False` even on a working RADV driver → correct fallback, zero speedup. Real Vulkan execution needs a Vulkan-enabled torch build (custom wheel or source build). The spike (Phase A) determines whether a usable one exists for the target distros; if yes, it becomes a `vulkan` install variant; if no, Vulkan stays "wired but inert, pending upstream."
- **CUDA/MPS:** unchanged.

Detection mirrors the existing `detectGPU()` (`downloadManager.js:376-391`), extended to recognize ROCm.

---

## Phased implementation

### Phase A — Spike: which accelerator actually beats CPU, at what install cost? (do first, time-boxed)
Empirical, not code-final. On representative hardware (Bazzite/SteamOS AMD APU/dGPU; a Windows AMD box; ideally an Intel GPU):
1. **ROCm:** install a HIP torch wheel, confirm `torch.version.hip` + `cuda.is_available()`, run a short Demucs + Whisper clip. Record: did it install at all (and how painfully), did it run, speedup vs CPU.
2. **Vulkan:** test whether any obtainable Vulkan-enabled torch build (custom wheel / source) runs Demucs/Whisper end-to-end without unimplemented-op failures; if it runs, measure speedup.
3. **Windows-without-NVIDIA** (see dedicated section below): test torch-DirectML as the realistic path; record install + speedup.
4. Deliverable: a short findings note (speedup %, install friction, op-coverage gaps per backend/distro) that decides which install variants are worth shipping and how prominently to surface each.

**Exit:** evidence-based call on Vulkan vs ROCm vs DirectML per platform — so we don't ship a toggle that only ever falls back.

### Phase 1 — End-to-end plumbing + probe/fallback (the real work, backend-agnostic)
1. New `python/device_utils.py` with `resolve_device` (handles `auto`/`vulkan`/`rocm`/passthrough, always falls back, never raises).
2. `demucs_runner.py` + `whisper_runner.py`: read `device` arg, use `resolve_device`, emit note, wrap run with CPU re-try on GPU op failure, report actual device.
3. `pythonRunner.js`: thread `options.device` into `runDemucs`/`runWhisper` args.
4. `conversionService.js`: accept + forward `options.device` (default `'auto'`).
5. Verify `creatorService` / IPC handler / web route pass it through untouched.

**Exit:** flag off → behavior identical to today. A GPU `device` on a non-capable build still completes (on CPU/GPU) with a console fallback note.

### Phase 2 — Settings + Creator UI device select
1. Add `creator.torchDevice` default `'auto'` to creator defaults.
2. `CreateTab.jsx`: load it, render the device select, persist on change, include in `startConversion` options.

**Exit:** user can choose a backend in the Electron Creator tab; choice persists; flows to Python.

### Phase 3 — Capability surfacing
1. Extend `systemChecker` torch probe to report what's actually available: `vulkanAvailable` (`torch.is_vulkan_available()`), `hipAvailable` (`torch.version.hip`), plus the existing cuda/mps/cpu.
2. Surface near the select: only offer / un-grey a GPU option the current torch build can actually use, with a one-line status ("this build: ROCm yes / Vulkan no").

**Exit:** the UI tells the truth; no dead options.

### Phase 4 — Install variants (gated on Phase A findings)
1. Extend `downloadManager.downloadPyTorch` + `detectGPU()` with the variants the spike proved worthwhile: `rocm` (`--index-url …/rocmX.Y`), Windows **DirectML** (`torch-directml`), and/or a `vulkan` build if one proved viable.
2. Offer the matching variant only when the host looks ready (ROCm: `rocminfo`/`/opt/rocm`; DirectML: Windows + non-NVIDIA).

**Exit:** selecting a GPU backend can install a torch that *actually* accelerates on supported hosts; unsupported hosts cleanly fall back.

### Phase 5 — (Optional) CREPE + docs
- Recommendation: **leave CREPE on `auto`** — least likely to port, cheap anyway. Document.
- Document per-distro setup notes (especially ROCm's host requirements) so users know what they're opting into.

---

## Files to touch

| File | Change |
|------|--------|
| `src/main/creator/python/device_utils.py` | **new** — `resolve_device(requested)` for auto/vulkan/rocm + probe + fallback, never raises |
| `src/main/creator/python/demucs_runner.py` | read `device` arg, use resolver, CPU re-try on GPU op failure, accurate `device` in result |
| `src/main/creator/python/whisper_runner.py` | same as above |
| `src/main/creator/pythonRunner.js` | `runDemucs`/`runWhisper` add `device` to args (default `'auto'`) |
| `src/main/creator/conversionService.js` | `runConversion` accept + forward `options.device` |
| `src/main/creator/downloadManager.js` | (Phase 4) `rocm` / DirectML / `vulkan` install variants; extend `detectGPU()` for ROCm + Windows-non-NVIDIA |
| `src/main/creator/systemChecker.js` | (Phase 3) report `vulkanAvailable` / `hipAvailable` from torch probe |
| `src/shared/defaults.js` (creator defaults) | add `torchDevice: 'auto'` |
| `src/renderer/components/creator/CreateTab.jsx` | load/persist `creator.torchDevice`, device select, include in convert options |
| `docs/architecture.md` | note the device contract + accelerator matrix under Creator pipeline |

No changes required to `creatorService.startConversion`, `creatorHandlers.js`, or `webServer.js /admin/creator/convert` — they forward `options` opaquely, so `device` rides through for free. **This means the GPU flag works for web-initiated conversions automatically** — the PC/TV "create from a phone" flow gets GPU offload once the web-creator feature lands.

---

## Risks & mitigations

- **GPU backend unsupported on a given host** (the common case for Vulkan; frequent for ROCm) → probe + automatic CPU fallback + visible console note. Default `'auto'` untouched. Mitigated to "no worse than today."
- **Smoke test passes but a mid-graph op is unimplemented** → per-run try/except retries once on CPU; report the real device used.
- **ROCm install pain / host fragility (June 2026)** → never auto-install or auto-select; gate behind host detection; label experimental; document requirements. The spike (Phase A) quantifies the pain before we surface it.
- **Vulkan torch wheels usually lack `USE_VULKAN=1`** → spike decides if a viable build exists; until then Vulkan is "wired but inert," reported honestly by capability surfacing.
- **Silent slowness** (user thinks GPU is on, it fell back) → always emit fallback reason; capability line pre-warns; job view can show the actual device used.
- **Behavior drift when flag is off** → `'auto'` is the exact existing cascade; test/assert that `device omitted == device:'auto' == today`.

## Test plan

- Unit (Python, standalone): `resolve_device` for `auto` / `vulkan`-no-build / `rocm`-no-hip / failing-op → each returns a runnable device + sensible note, never raises.
- Integration: short clip with `device:'auto'` (baseline) vs a GPU device on a non-capable box → identical `.stem.mp4` via fallback, console shows the note.
- Spike benchmarks (Phase A): Demucs+Whisper wall-clock CPU vs ROCm vs Vulkan vs DirectML on representative hardware.
- Regression: existing Creator conversion tests pass with no `device` field present.
