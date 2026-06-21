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
  const numSeg = Math.max(1, Math.ceil((total - TRAIN) / stride) + 1);

  // Precompute per-segment inputs (STFT via demucs-web) + overlap windows once.
  const segs = [];
  for (let start = 0; start < total; start += stride) {
    const end = Math.min(start + TRAIN, total);
    const segLen = end - start;
    const sl = new Float32Array(TRAIN);
    const sr = new Float32Array(TRAIN);
    for (let i = 0; i < segLen; i++) {
      sl[i] = left[start + i];
      sr[i] = right[start + i];
    }
    const win = new Float32Array(segLen);
    for (let i = 0; i < segLen; i++) {
      win[i] = Math.min(Math.min(i / (stride * 0.5), 1), Math.min((segLen - i) / (stride * 0.5), 1));
    }
    segs.push({ start, segLen, inp: proc.prepareModelInput(sl, sr), win });
  }

  const out = STEMS.map(() => ({ left: new Float32Array(total), right: new Float32Array(total) }));
  const weights = new Float32Array(total);
  const t0 = performance.now();

  // For each specialist model: run every segment, take ONLY its own stem.
  for (let s = 0; s < STEMS.length; s++) {
    const sess = sessions[s];
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      const res = await sess.run({
        mix: new ort.Tensor('float32', seg.inp.waveform, [1, 2, TRAIN]),
        mag: new ort.Tensor('float32', seg.inp.magSpec, [1, 4, 2048, 336]),
      });
      let freqData = null;
      let timeData = null;
      let timeShape = null;
      for (const name of sess.outputNames) {
        const t = res[name];
        if (t.dims.length === 5 && t.dims[2] === 4) freqData = t.data;
        else if (t.dims.length === 4 && t.dims[2] === 2) {
          timeData = t.data;
          timeShape = t.dims;
        }
      }
      const samples = timeShape[3];
      const fo = freqData ? proc.standaloneIspec(proc.standaloneMask(freqData)[s], TRAIN) : null;
      const o = out[s];
      for (let i = 0; i < seg.segLen && seg.start + i < total; i++) {
        const tl = timeData[s * 2 * samples + 0 * samples + i];
        const tr = timeData[s * 2 * samples + 1 * samples + i];
        o.left[seg.start + i] += (tl + (fo ? fo.left[i] || 0 : 0)) * seg.win[i];
        o.right[seg.start + i] += (tr + (fo ? fo.right[i] || 0 : 0)) * seg.win[i];
        if (s === 0) weights[seg.start + i] += seg.win[i];
      }
      onStemProgress?.(s, (si + 1) / segs.length);
      onSegment?.(s * segs.length + si + 1, STEMS.length * segs.length);
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
