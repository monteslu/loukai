/**
 * Silero VAD speech-gating for the WebGPU creator.
 *
 * Whisper hallucinates phantom phrases ("thank you", "thanks for watching") on
 * non-speech audio — and the separated vocals stem is NOT silent in instrumental
 * sections (Demucs bleed/residual), so it hallucinates there. The Python
 * no_speech_threshold gates don't fire in transformers.js's chunked path, so the
 * load-bearing fix is VAD pre-gating: run Silero VAD over the vocals, keep only
 * speech regions, and transcribe those — no speech region, no hallucination.
 *
 * Model: onnx-community/silero-vad (MIT, 2.2MB). Runs on onnxruntime-web (WASM —
 * tiny, has an If op). Contract: input [1,N] @16k + state [2,1,128] + sr int64 →
 * output [1,1] speech prob + stateN (recurrent state fed forward).
 */

const SR = 16000;
const WINDOW = 512; // Silero v5 frame size @16k (32ms)

/**
 * Detect speech regions in 16k mono audio.
 * @param ort onnxruntime-web module
 * @param session a loaded Silero VAD InferenceSession
 * @param mono Float32Array @16k
 * @param opts { threshold=0.5, minSpeechMs=250, minSilenceMs=500, padMs=150 }
 * @returns Array<{start, end}> in SECONDS (merged, padded)
 */
export async function detectSpeechRegions(ort, session, mono, opts = {}) {
  const threshold = opts.threshold ?? 0.5;
  const minSpeech = ((opts.minSpeechMs ?? 250) / 1000) * SR;
  const minSilence = ((opts.minSilenceMs ?? 500) / 1000) * SR;
  const pad = ((opts.padMs ?? 150) / 1000) * SR;
  const onProgress = opts.onProgress;

  let state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SR)]), []);
  const nWin = Math.floor(mono.length / WINDOW);

  // Per-window speech probabilities.
  const probs = new Float32Array(nWin);
  const frame = new Float32Array(WINDOW);
  for (let i = 0; i < nWin; i++) {
    frame.set(mono.subarray(i * WINDOW, i * WINDOW + WINDOW));
    const res = await session.run({
      input: new ort.Tensor('float32', frame.slice(), [1, WINDOW]),
      state,
      sr,
    });
    probs[i] = res.output.data[0];
    state = res.stateN;
    if (onProgress && i % 200 === 0) onProgress(i / nWin);
  }

  // Hysteresis: walk windows, build speech segments, then merge gaps < minSilence
  // and drop segments < minSpeech, finally pad each edge.
  const raw = [];
  let inSpeech = false;
  let segStart = 0;
  for (let i = 0; i < nWin; i++) {
    const speaking = probs[i] >= threshold;
    if (speaking && !inSpeech) {
      inSpeech = true;
      segStart = i * WINDOW;
    } else if (!speaking && inSpeech) {
      inSpeech = false;
      raw.push([segStart, i * WINDOW]);
    }
  }
  if (inSpeech) raw.push([segStart, nWin * WINDOW]);

  // Merge segments separated by < minSilence.
  const merged = [];
  for (const [s, e] of raw) {
    if (merged.length && s - merged[merged.length - 1][1] < minSilence) {
      merged[merged.length - 1][1] = e;
    } else {
      merged.push([s, e]);
    }
  }

  // Drop too-short, pad, clamp.
  const regions = [];
  for (const [s, e] of merged) {
    if (e - s < minSpeech) continue;
    const ps = Math.max(0, s - pad);
    const pe = Math.min(mono.length, e + pad);
    regions.push({ start: ps / SR, end: pe / SR });
  }
  return regions;
}
