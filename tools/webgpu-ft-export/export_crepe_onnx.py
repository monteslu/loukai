"""Export CREPE-tiny → ONNX for in-browser pitch detection (WebGPU).

CREPE-tiny is a small 6-conv CNN (487K params) → exports cleanly to ONNX and runs
on onnxruntime-web WebGPU (~1.3s for a 3-min song). Input: 1024-sample frames @16k
→ output: 360 pitch-bin activations. Decode argmax→weighted-centroid→cents→Hz in JS
(see static/webgpu/crepe-pitch.js). Use the LEGACY exporter (dynamo had a Pad
version-converter issue + didn't embed weights).

  pip install torchcrepe
  python export_crepe_onnx.py   # → crepe_tiny.onnx (~2MB), parity ~6e-8 vs torchcrepe
"""
import torch, torchcrepe

m = torchcrepe.Crepe('tiny').eval()
x = torch.randn(64, 1024)
torch.onnx.export(
    m, x, 'crepe_tiny.onnx', export_params=True, opset_version=17, dynamo=False,
    input_names=['frames'], output_names=['activation'],
    dynamic_axes={'frames': {0: 'batch'}, 'activation': {0: 'batch'}},
)
print('exported crepe_tiny.onnx')
