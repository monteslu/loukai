/* Ported from mochamix packages/stems/src/vendor/demucs (annotated TypeScript source of
 * this runner - keep in sync). Based on demucs-web by timcsy, MIT. WGSL/WASM demucs
 * DSP: the ONNX graph runs 100% on the WebGPU EP; this code is the DSP around it. */
export const CONSTANTS = {
  /** The model is trained at 44.1 kHz - feed it 44.1k audio (see separate.ts). */
  SAMPLE_RATE: 44100,
  FFT_SIZE: 4096,
  HOP_SIZE: 1024,
  /** Samples per model segment (~7.8 s @ 44.1k) - the fixed input width. */
  TRAINING_SAMPLES: 343980,
  MODEL_SPEC_BINS: 2048,
  MODEL_SPEC_FRAMES: 336,
  SEGMENT_OVERLAP: 0.25,
  TRACKS: ['drums', 'bass', 'other', 'vocals'],
};
