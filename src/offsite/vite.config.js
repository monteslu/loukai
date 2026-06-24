import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Offsite WebGPU creator (karaoke-creator.loukai.com). A standalone static build of the
 * shared createKaraoke engine — no Node backend. Deployed to an HTTPS host (secure
 * context required for WebGPU). The host must ALSO serve the runtime assets the engine
 * fetches same-origin: /webgpu-assets/* (ORT, demucs, transformers.js, crepe, ffmpeg
 * core) and /webgpu-models/* (the ONNX/HF models). See docs/OFFSITE-CREATOR.md.
 *
 * In dev, those two paths are proxied to a running loukai instance (port 3069) so you
 * don't have to vendor them locally.
 */
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  base: '/',
  root: __dirname,
  resolve: {
    alias: {
      // stem-mp4's index barrel re-exports reader.js, which pulls in Node-only
      // child_process/util/music-metadata and breaks the browser build. The writer +
      // atoms modules are browser-safe (Uint8Array only); alias to them directly so the
      // offsite app can mux + write atoms in-browser without dragging in the reader.
      'stem-mp4/writer': path.join(repoRoot, 'node_modules/stem-mp4/src/writer.js'),
      'stem-mp4/atoms': path.join(repoRoot, 'node_modules/stem-mp4/src/atoms.js'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      '/webgpu-assets': 'http://localhost:3069',
      '/webgpu-models': 'http://localhost:3069',
    },
  },
});
