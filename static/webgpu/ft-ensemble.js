/**
 * htdemucs_ft 4-model ENSEMBLE for in-browser WebGPU separation — PyTorch-quality.
 *
 * Runs the 4 fine-tuned specialist models (drums/bass/other/vocals) and takes stem
 * k from model k (the bag's one-hot weight matrix). Each model is a legacy-exported
 * htdemucs (timcsy contract): inputs mix [1,2,343980] + mag [1,4,2048,336] (real
 * magnitude), outputs x [1,4,4,2048,336] (freq mask) + xt [1,4,2,343980] (time).
 * STFT/iSTFT + masking reuse demucs-web (prepareModelInput / standaloneMask /
 * standaloneIspec) — identical math to the single-model path.
 *
 * fp16 models give the speed; the variance/normalization prologue (which overflows
 * fp16) is pinned to CPU via forceCpuNodeNames so there's NO NaN. fp16 weights are
 * parity-perfect (corr 1.0 vs fp32). Emits per-stem progress like the native creator.
 */

const SR = 44100;
const TRAIN = 343980;
const OVERLAP = 0.25;
export const STEMS = ['drums', 'bass', 'other', 'vocals'];

/**
 * Create the 4 ensemble sessions (sequentially — ORT-web forbids concurrent
 * WebGPU session creation). fp16 models with the normalization prologue pinned
 * to CPU (cpuNodes per stem) so fp16 doesn't NaN.
 *
 * @param opts { ort, modelUrl(stem)->string, cpuNodes:{stem:[names]}, onLog }
 * @returns sessions[] aligned to STEMS
 */
export async function createEnsembleSessions({ ort, modelUrl, cpuNodes, onLog }) {
  const sessions = [];
  for (const stem of STEMS) {
    onLog?.(`loading ${stem} model …`);
    const buf = await fetch(modelUrl(stem)).then((r) => {
      if (!r.ok) throw new Error(`model fetch ${stem}: ${r.status}`);
      return r.arrayBuffer();
    });
    const ep = cpuNodes?.[stem]
      ? [{ name: 'webgpu', forceCpuNodeNames: cpuNodes[stem] }]
      : ['webgpu'];
    sessions.push(
      await ort.InferenceSession.create(new Uint8Array(buf), {
        executionProviders: ep,
        graphOptimizationLevel: 'all',
      })
    );
  }
  return sessions;
}

/**
 * Run the full 4-model ensemble over an audio buffer.
 * @param opts { ort, sessions[4], proc (demucs-web module), left, right,
 *               onStemProgress(stemIndex, frac), onSegment(seg,total), onLog }
 * @returns { stems: {drums,bass,other,vocals:{left,right}}, seconds, realtime }
 */
export async function runEnsemble({ ort, sessions, proc, left, right, onStemProgress, onSegment, onLog }) {
  const total = left.length;
  const stride = Math.floor(TRAIN * (1 - OVERLAP));
  // Segment plan: stride apart, FINAL segment aligned to end at the last sample.
  // The old grid-aligned tail was up to ~97% zero padding, i.e. one wasted
  // inference PER MODEL per track (4 wasted runs on the ensemble).
  const starts = [];
  for (let s = 0; ; s += stride) {
    if (s + TRAIN >= total) {
      starts.push(Math.max(0, total - TRAIN));
      break;
    }
    starts.push(s);
  }

  const out = STEMS.map(() => ({ left: new Float32Array(total), right: new Float32Array(total) }));
  const weights = new Float32Array(total);
  const t0 = performance.now();
  const sl = new Float32Array(TRAIN);
  const sr = new Float32Array(TRAIN);

  // SEGMENT-OUTER: prepare each segment's inputs ONCE, run all 4 specialists on
  // it, then move on. The old model-outer order precomputed every segment's
  // inputs up front and held them for the whole run (~14MB per segment, hundreds
  // of MB on a full track); this keeps exactly one segment's inputs alive.
  for (let si = 0; si < starts.length; si++) {
    const start = starts[si];
    const segLen = Math.min(start + TRAIN, total) - start;
    sl.fill(0);
    sr.fill(0);
    sl.set(left.subarray(start, start + segLen));
    sr.set(right.subarray(start, start + segLen));
    const inp = proc.prepareModelInput(sl, sr);
    const mix = new ort.Tensor('float32', inp.waveform, [1, 2, TRAIN]);
    const mag = new ort.Tensor('float32', inp.magSpec, [1, 4, 2048, 336]);
    const win = new Float32Array(segLen);
    for (let i = 0; i < segLen; i++) {
      win[i] = Math.min(Math.min(i / (stride * 0.5), 1), Math.min((segLen - i) / (stride * 0.5), 1));
    }

    for (let s = 0; s < STEMS.length; s++) {
      const res = await sessions[s].run({ mix, mag });
      let freqData = null;
      let timeData = null;
      let timeShape = null;
      for (const name of sessions[s].outputNames) {
        const t = res[name];
        if (t.dims.length === 5 && t.dims[2] === 4) freqData = t.data;
        else if (t.dims.length === 4 && t.dims[2] === 2) {
          timeData = t.data;
          timeShape = t.dims;
        }
      }
      const samples = timeShape[3];
      // Fused single-stem reconstruction when the runner provides it (vendored
      // runner: WASM iSTFT, no 4-track intermediates); demucs-web fallback else.
      const fo = freqData
        ? proc.freqTrackToTime
          ? proc.freqTrackToTime(freqData, s, TRAIN)
          : proc.standaloneIspec(proc.standaloneMask(freqData)[s], TRAIN)
        : null;
      const o = out[s];
      for (let i = 0; i < segLen && start + i < total; i++) {
        const tl = timeData[s * 2 * samples + 0 * samples + i];
        const tr = timeData[s * 2 * samples + 1 * samples + i];
        o.left[start + i] += (tl + (fo ? fo.left[i] || 0 : 0)) * win[i];
        o.right[start + i] += (tr + (fo ? fo.right[i] || 0 : 0)) * win[i];
        if (s === 0) weights[start + i] += win[i];
      }
      onStemProgress?.(s, (si + 1) / starts.length);
      onSegment?.(si * STEMS.length + s + 1, STEMS.length * starts.length);
    }
  }

  // Normalize by overlap weights.
  for (let s = 0; s < STEMS.length; s++) {
    const o = out[s];
    for (let i = 0; i < total; i++) {
      const w = weights[i] || 1e-8;
      o.left[i] /= w;
      o.right[i] /= w;
    }
  }

  const seconds = (performance.now() - t0) / 1000;
  const stems = {};
  STEMS.forEach((name, i) => (stems[name] = out[i]));
  onLog?.(`ensemble done in ${seconds.toFixed(1)}s — ${(total / SR / seconds).toFixed(2)}× realtime`);
  return { stems, seconds, realtime: total / SR / seconds };
}
