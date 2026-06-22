# loukai-vad

Silero VAD speech-gating for **in-browser / WebGPU** use — detects speech regions in
audio so you can suppress Whisper hallucination on non-speech (instrumental/silence).
Ships the Silero VAD ONNX (~2.2 MB, runs on `onnxruntime-web`) plus a region detector
with hysteresis tuned to err toward keeping audio (good for singing).

```js
import * as ort from 'onnxruntime-web';
import { detectSpeechRegions, modelPath } from 'loukai-vad';

const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
const regions = await detectSpeechRegions(ort, session, mono16k, { threshold: 0.35 });
// → [{ start, end }, ...] in seconds
```

Built for [loukai](https://github.com/monteslu/loukai). The Silero VAD model is from
[snakers4/silero-vad](https://github.com/snakers4/silero-vad) (MIT) / the
[onnx-community](https://huggingface.co/onnx-community/silero-vad) export.

MIT © Luis Montes (model © Silero Team, MIT)
