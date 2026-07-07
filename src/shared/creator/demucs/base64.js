/* Ported from mochamix packages/stems/src/vendor/demucs (annotated TypeScript source of
 * this runner - keep in sync). Based on demucs-web by timcsy, MIT. WGSL/WASM demucs
 * DSP: the ONNX graph runs 100% on the WebGPU EP; this code is the DSP around it. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = /* @__PURE__ */ (() => {
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();
export function base64ToBytes(b64) {
  let len = b64.length;
  while (len > 0 && (b64[len - 1] === '=' || b64.charCodeAt(len - 1) <= 32)) len--;
  let nChars = 0;
  for (let i = 0; i < len; i++) {
    if (LOOKUP[b64.charCodeAt(i)] >= 0) nChars++;
  }
  const outLen = Math.floor((nChars * 6) / 8);
  const out = new Uint8Array(new ArrayBuffer(outLen));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < len; i++) {
    const v = LOOKUP[b64.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out;
}
