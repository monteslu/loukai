/* Ported from mochamix packages/stems/src/vendor/demucs (annotated TypeScript source of
 * this runner - keep in sync). Based on demucs-web by timcsy, MIT. WGSL/WASM demucs
 * DSP: the ONNX graph runs 100% on the WebGPU EP; this code is the DSP around it. */
import { CONSTANTS } from './constants.js';
const { TRAINING_SAMPLES, SEGMENT_OVERLAP } = CONSTANTS;
export function segmentStarts(totalSamples, segment = TRAINING_SAMPLES, overlap = SEGMENT_OVERLAP) {
  const stride = Math.floor(segment * (1 - overlap));
  const starts = [];
  for (let s = 0; ; s += stride) {
    if (s + segment >= totalSamples) {
      starts.push(Math.max(0, totalSamples - segment));
      break;
    }
    starts.push(s);
  }
  return starts;
}
