# Plan: WhisperX for accurate vocal timing (line-level first, word-level bonus)

**Status:** Draft / proposal (external specifics pending a research pass — see "Open items")
**Feature:** Replace/augment the Creator's transcription step with **WhisperX** (or another forced-alignment path) so **line `start`/`end` are derived from the audio** instead of from Whisper's drifty native segment timestamps — fixing the "lyrics appear a few seconds early/late" problem. Real per-word timestamps come along for free as a secondary benefit.

---

## Why this is worth doing — the headline is *line* timing drift

**Primary problem (the reported one):** whisper-turbo's **line start/end can be off by seconds**, so lyric lines appear early or late on screen. Root cause, confirmed in code:

- `whisper_runner.py:108-110` takes each line's `start`/`end` **directly from Whisper's native `segment["start"]` / `segment["end"]`**. Those timestamps are derived from the model's decoder/attention, **not from the audio**, so segment boundaries drift — a well-known Whisper weakness, worst on `large-v3-turbo` and worst on singing.
- `stemBuilder.js:202-203` writes those drifted values **straight into the `kara` atom** line `start`/`end`. The renderer keys lyric display + the bouncing-ball window off them (`karaokeRenderer.js:415-416, 1797`). A line whose `start` is 2s late → lyrics 2s late on screen.

**WhisperX fixes this at the source.** Its wav2vec2 **forced-alignment** pass re-derives every token boundary *from the audio*; the line `start`/`end` then become the measured first/last aligned word — not the model's guess. This is the bigger, more visible win.

**Secondary problem (the original framing — still real):** word timings are *fabricated*. `whisper_runner.py:74` sets `word_timestamps=False`, then **evenly distributes** word times across each segment (`word_duration = segment_duration / len(text_words)`, `:118-128`). So the bouncing ball / per-word highlight in `karaokeRenderer.drawWordLine` animates against estimates. Forced alignment makes these measured too — a bonus that rides along with the line-timing fix.

So: **one mechanism (forced alignment) fixes both**, with line-level accuracy as the headline and word-level accuracy as the bonus.

## The downstream contract already fits (this is the good news)

The data model from transcription → file → renderer is already word-level and stable; WhisperX just fills it with *real* numbers:

- **stemBuilder** (`stemBuilder.js:196-220`): for each `line`, filters `words` into the line's time range and writes **relative** `[startOffset, endOffset]` per word into the `kara` atom (`lineData.words = { timings }`).
- **renderer** (`karaokeRenderer.js:441-445`): reads `word.s`/`word.e`/`word.t` per line; `estimateWordTiming` (`:458-467`) is the fallback when a line has no words.
- **kara atom format** is documented (`docs/m4a_format.md`, `docs/architecture.md`) as `lines[]` with word timing.

**Implication for scope:** this is a **swap at the `whisper_runner` boundary**, not a data-model change. WhisperX returns `lines[]` + per-word `start`/`end`; the existing `stemBuilder`/renderer/editor consume them unchanged. No `kara` format change, no renderer change required for the core feature.

---

## What WhisperX is (and the moving parts)

WhisperX = faster-whisper transcription (CTranslate2 backend) **+** a separate **wav2vec2 forced-alignment** pass that snaps each word to the audio. Practically that means new dependencies and a new model download, replacing today's `openai-whisper` + `.pt` model:

- **`whisperx`** Python package (pulls **faster-whisper** / **CTranslate2**, **torchaudio**, **pyannote/transformers** bits).
- An **alignment model** per language (wav2vec2; English default downloaded from HuggingFace on first use) — a *new* asset to fetch/cache alongside the ASR model.
- ASR weights are CTranslate2-converted faster-whisper models (different cache layout than the current `~/.cache/whisper/*.pt`).

> **Research status (deep-research pass complete, 2026):** the compatibility question — **does WhisperX run on our target GPUs (ROCm/Vulkan/DirectML/MPS)** — came back **UNVERIFIED**. After 20 sources, no claim addressed non-CUDA accelerator support for either CTranslate2 (ASR) or torchaudio (alignment); the only hardware fact confirmed is GPU *memory* footprint (<8GB fp16 / ~4GB int8 for large-v2). So **"will it work on our system" is still an open question, leaning risky** — this must be settled by a hands-on spike (Phase 0), not assumed. An AMD **ROCm-CTranslate2 blog** and **faster-whisper issue #1401** surfaced as leads to chase but were not claim-verified. **What this confirms:** the two-engine split (CTranslate2 + torchaudio) is real, and the GPU risk concentrates in CTranslate2 — which is exactly why the **Whisper-then-align** path (below) is the safer bet for our boxes.

### Known interaction risks to design around

1. **Device/platform support is narrower than torch.** CTranslate2 (faster-whisper's engine) historically supports CPU + CUDA well; **ROCm/Vulkan/DirectML/MPS support is the open question.** If CTranslate2 can't use the chosen GPU backend, WhisperX transcription may be **CPU-only on exactly the Linux/Windows-non-NVIDIA boxes the GPU plan targets** — while the *alignment* step (plain torch/torchaudio) could still use the GPU. This must be probed and surfaced, not assumed. It also means WhisperX's device handling is **separate** from the `device` flag in `PLAN-vulkan-torch.md` (that flag targets Demucs + plain-Whisper torch; WhisperX has its own ASR engine).

2. **LLM correction is line-level — it touches word timings but NOT the headline line timing.** `llmService.correctLyrics` works on **lines, not words** (`llmService.js:130-131`), returning `correctedLines` while **preserving each line's `start`/`end`** (it edits text, not line boundaries). So the *primary* win — accurate line timing from alignment — **survives LLM correction intact.** The only casualty is *intra-line word offsets* on a rewritten line (the `words` filter in `stemBuilder:208` no longer matches the new text). That's the secondary benefit, and it degrades gracefully to per-line estimate (see design option A). Net: the reprioritization makes this hazard low-stakes.

3. **Singing ≠ speech — and the benefit on sung vocals is *unproven*.** wav2vec2 alignment models are speech-trained; sustained notes/melisma/heavy vocals may misalign. **Verified by research:** WhisperX was explicitly "**not evaluated for long-form ALT** [automatic lyrics transcription]" as of June 2025, and real-world issues report alignment **errors up to ~3s** in some cases. A counter-claim that alignment goes "completely out of sync during music" was **refuted** (0-3) — so there's no proven music failure mode either; it's simply under-evidenced both ways. Net: forced alignment is very likely better than even-distribution (which is near-random within a line), but treat the *magnitude* of the karaoke win as a hypothesis to measure in Phase 0, not a given. Keep the per-line fallback + the editor's manual timing tools regardless.
   - **Mitigation already in place:** the research notes that **isolating vocals before transcription may be a bigger lever than engine choice** — and you already run transcription on the Demucs **vocals stem**, so you're already pulling the most important lever.

> **Verified facts (research, high-confidence):** Whisper's native timestamps are documented as poor (paper: architecture "insufficient for accurate word-level timestamps"; AMI 78.9/52.1 precision/recall) — corroborating the reported line-drift. Forced alignment measurably fixes this **for speech** (WhisperX AMI 84.1/60.3). Licensing is clean: **WhisperX = BSD-2-Clause** (relicensed from BSD-4 in 2024), **stable-ts = MIT** — no conflict with the project's AGPL. Default alignment models cover en/fr/de/es/it built-in + ~36 more via HuggingFace; unknown languages raise `ValueError` (English is fine). Known wart: numbers/currency tokens ("2014.", "£13.60") get no alignment timing by default — minor for lyrics, falls back to interpolation.

---

## Design

### Engine selection (don't rip out the old path)

Make transcription **engine-pluggable** rather than a hard replacement:

- New setting `creator.transcriptionEngine`: `'whisper'` (current, default initially) | `'whisperx'`.
- The conversion service picks the runner based on it. Keep `whisper_runner.py` as-is; add `whisperx_runner.py` that returns the **same JSON shape** (`{ success, lines:[{text,start,end,words:[{word,start,end}]}], words, language, duration, ... }`).
- This lets us ship WhisperX as opt-in, compare quality, and fall back instantly if a box can't run it. Once proven, flip the default.

### `whisperx_runner.py` (new) — same contract, real timings

Mirror `whisper_runner.py`'s I/O exactly (JSON args in, JSON result out, `PROGRESS:`/tqdm on stderr) so `pythonRunner.js` treats it identically. Internally:

1. `import whisperx`; load faster-whisper model (respect `model`, `language`, `initial_prompt` — WhisperX supports an ASR initial prompt; confirm pass-through for vocabulary hints, which the pipeline already builds via `lrclibService.prepareWhisperContext`).
2. Transcribe → segments.
3. **Align**: load the alignment model for the language, run `whisperx.align(...)` to get real per-word `start`/`end`.
4. Emit the same `lines[]` + `words[]` structure stemBuilder/renderer expect (word-level start/end now *measured*).
5. **Device handling:** probe what CTranslate2 + torchaudio can use; report the actual ASR device and alignment device in the result (so the UI can say "transcribed on CPU, aligned on GPU" honestly). Reuse the `device_utils` idea from `PLAN-vulkan-torch.md` where applicable, but treat the ASR engine's device separately.

### Fixing the LLM-correction / alignment ordering hazard

Pick one (recommend **A**, smallest + safe):

- **A. Per-line fallback (recommended).** Run alignment first. When LLM correction changes a line's text, **drop that line's word timings** and let the renderer fall back to `estimateWordTiming` *for that line only*. Unchanged lines keep their measured timings. Net: strictly better than today (today *all* lines are estimated; now only corrected lines are). Cheapest, no re-alignment infra.
- **B. Re-align corrected lines.** After LLM correction, re-run alignment on just the changed lines' audio spans to recover real timings. Best quality, but adds a second alignment pass + span bookkeeping.
- **C. Word-aware LLM correction.** Teach `llmService` to preserve/re-map word timings across edits. Most invasive; not worth it now.

Document the choice; expose nothing to the user — it's internal correctness.

### Install / capability (where the packaging work lives)

All in the same files the GPU plan touches:

- `downloadManager.js`: add `installWhisperX()` (pip `whisperx` + its deps) and **alignment-model fetch/cache**; keep `openai-whisper` install for the legacy engine. ASR model handling differs (CTranslate2 faster-whisper conversion/cache vs `.pt`).
- `systemChecker.js`: add `checkWhisperX()` + `checkAlignmentModel(lang)` + report ASR/align **device capability**; extend `checkAllComponents` so the UI can require the right pieces based on the selected engine.
- Cache layout: faster-whisper/CT2 models + wav2vec2 alignment models live under the existing creator cache dir (`getCacheDir()`), via the env already set in `getPythonEnv` (`HF_HOME`, `XDG_CACHE_HOME`).

### UI

- In the Creator tab, add a **Transcription engine** select next to the existing Whisper-model select (`CreateTab.jsx:847-854`): "Whisper (estimated word timing)" vs "WhisperX (precise word timing — experimental)". Persist `creator.transcriptionEngine`; include in `startConversion` options.
- Component-status list (`CreateTab.jsx:531-534`) gains WhisperX + alignment-model rows when that engine is selected.
- (Web parity comes via `PLAN-web-creator.md` — once the web Creator UI exists, the same engine select rides the bridge.)

---

## Phased implementation

### Phase 0 — Research + spike (do first; some specifics are unverified)
1. Land the deep-research findings: CTranslate2 device/platform matrix, licensing, footprint, singing caveats.
2. **Spike both architectures on a real vocal stem and compare *line*-timing accuracy** (the headline metric — measure boundary error vs hand-marked truth on a few songs):
   - **(a) WhisperX all-in-one** (CTranslate2 ASR + align), and
   - **(b) Whisper-then-align** — keep today's `whisper_runner` transcription, run only the wav2vec2 forced-alignment as a post-process on the vocals stem. (b) gets the same line-timing fix while avoiding the CTranslate2 device/footprint risk — it may be the lower-risk winner.
3. Confirm the chosen runner's JSON shape maps cleanly into `stemBuilder` (it should — same `lines[]`/`words[]`).
4. Decide engine-default timeline and the LLM-ordering approach (A recommended; now low-stakes since line timing survives correction).

**Exit:** evidence of how much alignment improves **line** timing on real vocals, a chosen architecture (all-in-one vs Whisper-then-align), and a known device/footprint story per platform.

### Phase 1 — `whisperx_runner.py` + runner wiring (opt-in, behind setting)
1. Add `whisperx_runner.py` (same I/O contract; transcribe + align; report devices).
2. `pythonRunner.js`: `runWhisperX(...)` (or generalize `runWhisper` to take an engine).
3. `conversionService.js`: select runner by `options.transcriptionEngine`; everything downstream (`stemBuilder`, kara atom, renderer) unchanged.
4. Implement the chosen LLM-ordering fix (A: per-line fallback).

**Exit:** with the setting on, a conversion produces a `.stem.mp4` whose word timings are measured; with it off, identical to today.

### Phase 2 — Install + capability + UI
1. `downloadManager`/`systemChecker`: install/check WhisperX + alignment model + device capability.
2. `CreateTab.jsx`: engine select + status rows; persist setting; pass through.

**Exit:** a user can install WhisperX from the Creator and choose it; UI tells the truth about what's installed and what device it'll use.

### Phase 3 — Validate, then consider flipping the default
1. A/B a handful of songs (estimate vs WhisperX); sanity-check the editor still loads/edits the richer timings.
2. If quality + reliability hold across platforms, make `'whisperx'` the default and keep `'whisper'` as fallback.

---

## Files to touch

| File | Change |
|------|--------|
| `src/main/creator/python/whisperx_runner.py` | **new** — WhisperX transcribe + wav2vec2 align; same JSON contract as `whisper_runner.py`; report ASR/align devices |
| `src/main/creator/pythonRunner.js` | add `runWhisperX` (or engine param on `runWhisper`) |
| `src/main/creator/conversionService.js` | select runner by `transcriptionEngine`; implement per-line timing fallback when LLM correction changes a line |
| `src/main/creator/downloadManager.js` | `installWhisperX()` + alignment-model fetch/cache (keep legacy whisper install) |
| `src/main/creator/systemChecker.js` | `checkWhisperX()`, `checkAlignmentModel()`, ASR/align device capability; extend `checkAllComponents` |
| `src/shared/defaults.js` (creator defaults) | add `transcriptionEngine: 'whisper'` (flip to `'whisperx'` in Phase 3) |
| `src/renderer/components/creator/CreateTab.jsx` | engine select + status rows; persist + pass through |
| `docs/architecture.md` / `docs/m4a_format.md` | note that word timings are now measured (WhisperX) vs estimated (Whisper); no format change |

**No change** to the `kara` atom format, `stemBuilder`'s line/word writing, the renderer, or the editor — WhisperX fills the existing `words[]` contract. That's the core reason this is bounded.

---

## Risks & mitigations

- **CTranslate2 can't use the target GPU backend (ROCm/Vulkan/DirectML/MPS)** → WhisperX ASR may be CPU-only on exactly the boxes `PLAN-vulkan-torch.md` targets. *Mitigation:* probe + report actual device; keep the legacy Whisper engine (which rides the `device` flag) as the GPU path if WhisperX can't; let alignment use GPU even if ASR is CPU. **Resolve in Phase 0 research.**
- **LLM correction discards measured word timings** → per-line fallback (option A): corrected lines fall back to estimate, others keep real timings. Strictly better than today.
- **Singing misalignment (speech-trained wav2vec2)** → still better than even-distribution on average; keep per-line fallback + editor manual timing; consider a confidence threshold that falls back when alignment looks bad.
- **Bigger/extra downloads (CT2 models + alignment models)** → reuse creator cache + progress UI; document sizes; only fetch when the engine is selected.
- **Two engines = maintenance surface** → keep both behind one setting with an identical JSON contract; delete the legacy path only if/when WhisperX proves universally viable.

## Open items — status after the research pass

**Resolved by research (high-confidence):**
- ✅ **Licensing** — WhisperX BSD-2-Clause, stable-ts MIT; no AGPL conflict, safe to depend on/package.
- ✅ **Whisper's line/word timing is genuinely poor** (documented, quantified) — confirms the reported drift is a real Whisper weakness, not a config bug on our side.
- ✅ **Forced alignment fixes it for speech** (measured); mechanism is wav2vec2 CTC forced alignment via torchaudio.
- ✅ **Footprint shape** — CTranslate2 ASR (<8GB fp16 / ~4GB int8 large-v2) + per-language wav2vec2 align model (en built-in) + (we don't need pyannote diarization, can skip).

**Now ANSWERED by a real hardware spike (AMD RX 7600 / gfx1102 / Linux, 2026-06-21 — see `PLAN-vulkan-torch.md` "Spike results"):**
- ✅ **The alignment engine runs on AMD GPU — with one split.** `torch`+`torchaudio` ROCm wheels install via pip (bundled runtime, no system ROCm, no gfx override), and the **wav2vec2 acoustic model runs on the GPU**. BUT **`torchaudio.functional.forced_align` is CPU-only (no ROCm kernel)** — so the design is: **wav2vec2 forward on GPU → move logits to CPU → run the cheap forced_align trellis on CPU.** This is the standard split and is the recommended implementation for the alignment step.
- ✅ **This validates the "Whisper-then-align" path concretely** — keep Whisper transcription (rides the ROCm device flag) and do GPU-forward + CPU-align for the line-timing fix. We *know* this combination runs on AMD Linux now.
- ⚠️ **Mandatory chunking.** A single 180s forward pass **hung the GPU** on this RDNA3 card (recovered automatically). Audio must be processed in ≤30s chunks (WhisperX/VAD and Demucs already do this; our runner must too).
- ❓ **CTranslate2 (faster-whisper ASR) on ROCm still unverified** — the spike tested torch/torchaudio (the alignment side), not CTranslate2. Since "Whisper-then-align" keeps the existing `openai-whisper`/torch ASR (which we now know runs on ROCm), **we may not need CTranslate2 at all** — sidestepping its unknown. Only test CTranslate2 if we pursue WhisperX-all-in-one.

**STILL OPEN — settle in the Phase 0 spike:**
- ❗ **Is it actually better on *singing*?** No benchmark exists (WhisperX unevaluated for lyrics; ~3s errors reported in the wild). **Measure line-boundary error on real songs in Phase 0** — this decides whether the feature delivers. (Now unblocked: we have a working GPU alignment stack on this box to test with.)
- ❓ **Whisper-then-align vs WhisperX-all-in-one** — the hardware spike tilts strongly toward **Whisper-then-align** (verified to run on AMD; avoids CTranslate2's unknown). Confirm with a quality comparison, but this is now the leading candidate.

## Alternatives considered (validate against research)

**Decision filter now that line drift is the headline:** does the option re-derive *line* boundaries from the audio, or only improve *word* timing within Whisper's existing (drifty) segments? Only forced alignment fixes the reported problem.

- **WhisperX (forced alignment)** — ✅ fixes **line** timing (re-derives boundaries from audio) **and** word timing. The only option that addresses the actual complaint. Cost: heavier deps + alignment model + CTranslate2 device questions.
- **faster-whisper native `word_timestamps=True`** — ⚠️ DTW-based **word** times; lighter (no align model). But line/segment boundaries still come from Whisper's decoder, so **line drift largely remains.** Helps the bonus, not the headline. Only a fallback if WhisperX is unviable on a platform.
- **stable-ts** — ⚠️ improves Whisper timestamp logic and can nudge segment boundaries via its own heuristics/regrouping; **partial** line-timing help, not true forced alignment. Lighter than WhisperX; evaluate if WhisperX's footprint/device story is bad.
- **Keep current Whisper, enable `word_timestamps=True`** — ⚠️ smallest change, **word-only**; original code disabled it deliberately (MPS float64 DTW). Doesn't fix line drift. Cheapest Phase 0 experiment to quantify the gap, but not a real solution to the reported issue.

**Standalone forced-alignment (decoupled option worth testing in Phase 0):** since the headline fix *is* the alignment step, we could also run **alignment as a post-process on the existing Whisper output** — keep today's `whisper_runner` transcription, then align its lines/words against the vocals stem with a wav2vec2 aligner (the same engine WhisperX wraps). This would fix line+word timing **without** swapping the ASR engine to CTranslate2, sidestepping the biggest device/footprint risk. Evaluate WhisperX-all-in-one vs Whisper-then-align in Phase 0; the latter may be the lower-risk path to the same line-timing win.

> **User steer (locked in):** if the research shows **CTranslate2 can't use our GPU** (i.e. WhisperX transcription would be **CPU-only on the Bazzite/SteamOS/AMD target boxes**), **prefer Whisper-then-align.** Rationale: today's `whisper_runner` already rides the GPU `device` flag from `PLAN-vulkan-torch.md`, so keeping it on GPU for transcription and adding **only** the wav2vec2 alignment post-process gets the headline line-timing win without regressing transcription to CPU. WhisperX-all-in-one only wins if CTranslate2 *does* support our GPU (or if its alignment quality is decisively better and CPU transcription speed is acceptable). This decision gates which runner Phase 1 builds.
