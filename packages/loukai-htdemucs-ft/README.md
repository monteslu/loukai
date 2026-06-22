# loukai-htdemucs-ft

The **htdemucs_ft** 4-model fine-tuned ensemble exported to fp16 ONNX for
**in-browser / WebGPU** stem separation (PyTorch-quality), plus the ensemble runner.

Four specialist models (drums/bass/other/vocals); stem *k* is taken from model *k*
(the bag's one-hot weights). fp16 gives the speed; the variance/normalization
prologue (which overflows fp16) is pinned to CPU via `forceCpuNodeNames` so there's
no NaN — fp16 is parity-perfect (corr 1.0 vs fp32).

```js
import * as ort from 'onnxruntime-web/webgpu';
import { createEnsembleSessions, runEnsemble, STEMS, modelPath, cpuNodesPath } from 'loukai-htdemucs-ft';

// Node: locate bundled files to serve them
modelPath('vocals'); cpuNodesPath();

// Browser:
const sessions = await createEnsembleSessions({ ort, modelUrl: (s) => urls[s], cpuNodes });
const { stems } = await runEnsemble({ ort, sessions, proc: demucsWeb, left, right });
// stems = { drums, bass, other, vocals: { left, right } }
```

Needs `demucs-web` for the STFT/iSTFT + masking (`prepareModelInput`,
`standaloneMask`, `standaloneIspec`) — identical math to the single-model path.

Built for [loukai](https://github.com/monteslu/loukai). Models exported from
[Demucs](https://github.com/facebookresearch/demucs) (`htdemucs_ft`, MIT).

MIT © Luis Montes
