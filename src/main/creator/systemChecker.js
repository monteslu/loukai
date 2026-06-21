/**
 * System Checker - Validates system requirements for the Creator feature
 *
 * Checks for:
 * - Python availability
 * - PyTorch installation
 * - Demucs (stem separation)
 * - Whisper (transcription)
 * - CREPE (pitch detection)
 * - FFmpeg (audio processing)
 * - Downloaded models
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { execSync, spawn } from 'child_process';

/**
 * Get the data directory for loukai creator (Python, models, etc.)
 * Uses the same base as Electron's userData for consistency
 */
export function getCacheDir() {
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'loukai', 'creator');
  } else if (plat === 'win32') {
    return join(homedir(), 'AppData', 'Local', 'loukai', 'creator');
  } else {
    return join(homedir(), '.config', 'loukai', 'creator');
  }
}

/**
 * Get the Python executable path.
 * Inside a Flatpak, the interpreter is provided as extra-data at /app/creator
 * (python-build-standalone extracts to /app/creator/python), so prefer that and
 * avoid a runtime download.
 */
export function getPythonPath() {
  const plat = platform();
  if (process.env.FLATPAK_ID) {
    const flatpakPy = join('/app', 'creator', 'python', 'bin', 'python3');
    if (existsSync(flatpakPy)) return flatpakPy;
  }
  const cacheDir = getCacheDir();
  if (plat === 'win32') {
    return join(cacheDir, 'python', 'python.exe');
  } else {
    return join(cacheDir, 'python', 'bin', 'python3');
  }
}

/**
 * Detect whether AMD ROCm needs HSA_OVERRIDE_GFX_VERSION on this machine.
 * RDNA2 (gfx1030..gfx1039, e.g. Steam Deck gfx1033) is not an official ROCm
 * target and must be spoofed to gfx1030 via HSA_OVERRIDE_GFX_VERSION=10.3.0.
 * RDNA3+ (e.g. RX 7600 gfx1102) works without an override.
 * Reads the KFD topology; encoding is major*10000 + minor*100 + step
 * (verified on hardware: gfx1102 -> 110002, gfx1150 -> 110500, gfx1033 -> 100303).
 * @returns {string|null} override value (e.g. '10.3.0') or null if none needed
 */
export function detectRocmGfxOverride() {
  if (platform() !== 'linux') return null;
  try {
    const base = '/sys/class/kfd/kfd/topology/nodes';
    if (!existsSync(base)) return null;
    for (const node of readdirSync(base)) {
      const propsPath = join(base, node, 'properties');
      if (!existsSync(propsPath)) continue;
      const m = readFileSync(propsPath, 'utf8').match(/gfx_target_version\s+(\d+)/);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v >= 100300 && v < 100400) return '10.3.0'; // RDNA2 family
      }
    }
  } catch {
    // best-effort; if topology is unreadable, assume no override needed
  }
  return null;
}

/**
 * Get environment variables for Python processes
 * Includes cached FFmpeg in PATH so Python scripts can find it
 */
export function getPythonEnv() {
  const cacheDir = getCacheDir();
  const binDir = join(cacheDir, 'bin');

  // Prepend our bin directory to PATH so cached ffmpeg/ffprobe are found
  const pathSep = platform() === 'win32' ? ';' : ':';
  const existingPath = process.env.PATH || process.env.Path || '';
  const newPath = `${binDir}${pathSep}${existingPath}`;

  const env = {
    ...process.env,
    PATH: newPath,
    Path: newPath, // Windows uses 'Path'
    TORCH_HOME: join(cacheDir, 'models', 'torch'),
    HF_HOME: join(cacheDir, 'models', 'huggingface'),
    XDG_CACHE_HOME: cacheDir, // For whisper model cache
  };

  // AMD RDNA2 (e.g. Steam Deck) needs this so ROCm accepts the GPU.
  // Respect an explicit user-set value if present.
  if (!env.HSA_OVERRIDE_GFX_VERSION) {
    const gfxOverride = detectRocmGfxOverride();
    if (gfxOverride) env.HSA_OVERRIDE_GFX_VERSION = gfxOverride;
  }

  return env;
}

/**
 * Check if a system command is available
 */
function checkSystemCommand(command) {
  try {
    const plat = platform();
    const checkCmd = plat === 'win32' ? `where ${command}` : `which ${command}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Python is installed and get version
 */
export function checkPython() {
  const pythonPath = getPythonPath();

  if (!existsSync(pythonPath)) {
    return { installed: false, reason: 'not_found' };
  }

  try {
    const output = execSync(`"${pythonPath}" --version`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    const version = output.trim().replace('Python ', '');
    return { installed: true, version, path: pythonPath };
  } catch (e) {
    return { installed: false, reason: 'not_executable', error: e.message };
  }
}

/**
 * Check if a Python package is installed by trying to import it
 */
function checkPythonPackage(packageName, versionAttr = '__version__') {
  const pythonPath = getPythonPath();

  if (!existsSync(pythonPath)) {
    return { installed: false, reason: 'no_python' };
  }

  const script = `
import sys
try:
    import ${packageName}
    version = getattr(${packageName}, '${versionAttr}', 'unknown')
    print(f"OK:{version}")
except ImportError as e:
    print(f"ERROR:{e}")
`;

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, ['-c', script], {
      env: getPythonEnv(),
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (_code) => {
      const output = stdout.trim();
      if (output.startsWith('OK:')) {
        const version = output.replace('OK:', '');
        resolve({ installed: true, version });
      } else {
        resolve({ installed: false, reason: 'import_failed', error: output || stderr });
      }
    });

    proc.on('error', (err) => {
      resolve({ installed: false, reason: 'spawn_failed', error: err.message });
    });
  });
}

/**
 * Check PyTorch and detect GPU availability
 */
export function checkPyTorch() {
  const pythonPath = getPythonPath();

  if (!existsSync(pythonPath)) {
    return { installed: false, reason: 'no_python' };
  }

  const script = `
import sys
try:
    import torch
    version = torch.__version__
    if torch.cuda.is_available():
        device = 'cuda'
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        device = 'mps'
    else:
        device = 'cpu'
    print(f"OK:{version}:{device}")
except ImportError as e:
    print(f"ERROR:{e}")
`;

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, ['-c', script], {
      env: getPythonEnv(),
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', () => {
      const output = stdout.trim();
      if (output.startsWith('OK:')) {
        const [version, device] = output.replace('OK:', '').split(':');
        resolve({ installed: true, version, device });
      } else {
        resolve({ installed: false, reason: 'import_failed', error: output || stderr });
      }
    });

    proc.on('error', (err) => {
      resolve({ installed: false, reason: 'spawn_failed', error: err.message });
    });
  });
}

// Python probe: enumerate available backends, then SMOKE-TEST each with a real
// conv2d + matmul on-device (conv specifically — Demucs is conv-heavy and that's
// where broken backends fail, e.g. Vulkan). Returns JSON: the best WORKING backend
// by priority (cuda/rocm > mps > directml > cpu), plus per-candidate results.
const BACKEND_PROBE_SCRIPT = `
import json, sys
result = {"candidates": [], "best": "cpu", "torch_version": None, "is_rocm": False}
try:
    import torch
    result["torch_version"] = torch.__version__
    result["is_rocm"] = bool(getattr(torch.version, "hip", None))
except Exception as e:
    print(json.dumps({"error": "import_failed", "detail": str(e)})); sys.exit(0)

def smoke(dev):
    # tiny real workload: conv2d + matmul, move result back to CPU
    x = torch.randn(1, 3, 16, 16, device=dev)
    w = torch.randn(4, 3, 3, 3, device=dev)
    y = torch.nn.functional.conv2d(x, w)
    a = torch.randn(64, 64, device=dev); b = torch.randn(64, 64, device=dev)
    _ = (a @ b).sum().item()
    _ = y.float().sum().item()

# priority order; ROCm presents AS cuda (torch.version.hip set)
candidates = []
try:
    if torch.cuda.is_available():
        candidates.append(("rocm" if result["is_rocm"] else "cuda", "cuda"))
except Exception:
    pass
try:
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        candidates.append(("mps", "mps"))
except Exception:
    pass
try:
    import torch_directml  # noqa: F401
    candidates.append(("directml", torch_directml.device()))
except Exception:
    pass
candidates.append(("cpu", "cpu"))

best = None
for name, dev in candidates:
    entry = {"backend": name, "available": True}
    if name == "cpu":
        entry["smoke"] = "skipped"; result["candidates"].append(entry)
        if best is None: best = name
        continue
    try:
        smoke(dev)
        entry["smoke"] = "pass"
        if best is None: best = name
    except Exception as e:
        entry["smoke"] = "fail"; entry["error"] = str(e)[:200]
    result["candidates"].append(entry)

result["best"] = best or "cpu"
print(json.dumps(result))
`;

/**
 * Detect the best WORKING PyTorch backend on this machine (Tier-2: capability
 * detection + on-device smoke test). Distinguishes ROCm from CUDA, rejects a
 * backend that reports available but fails a real conv/matmul, and reports the
 * gfx override if one is needed. Intended to be cached by the caller.
 * @returns {Promise<{best: string, candidates: Array, torchVersion: string|null,
 *   isRocm: boolean, gfxOverride: string|null, installed: boolean}>}
 */
export function detectBestBackend() {
  const pythonPath = getPythonPath();
  if (!existsSync(pythonPath)) {
    return Promise.resolve({ installed: false, best: 'cpu', candidates: [] });
  }
  return new Promise((resolve) => {
    const proc = spawn(pythonPath, ['-c', BACKEND_PROBE_SCRIPT], {
      env: getPythonEnv(),
      timeout: 60000, // smoke tests can JIT-compile kernels (MIOpen) on first run
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', () => {
      try {
        const r = JSON.parse(stdout.trim().split('\n').pop());
        if (r.error) {
          resolve({ installed: false, best: 'cpu', candidates: [], reason: r.error });
          return;
        }
        resolve({
          installed: true,
          best: r.best,
          candidates: r.candidates,
          torchVersion: r.torch_version,
          isRocm: r.is_rocm,
          gfxOverride: detectRocmGfxOverride(),
        });
      } catch (e) {
        resolve({
          installed: false,
          best: 'cpu',
          candidates: [],
          reason: 'probe_parse_failed',
          error: `${e.message} | stderr: ${stderr.slice(-200)}`,
        });
      }
    });
    proc.on('error', (err) => {
      resolve({
        installed: false,
        best: 'cpu',
        candidates: [],
        reason: 'spawn_failed',
        error: err.message,
      });
    });
  });
}

/**
 * Check Demucs
 */
export function checkDemucs() {
  return checkPythonPackage('demucs', '__version__');
}

/**
 * Check Whisper
 */
export function checkWhisper() {
  return checkPythonPackage('whisper', '__version__');
}

/**
 * Check CREPE (torchcrepe)
 */
export function checkCrepe() {
  return checkPythonPackage('torchcrepe', '__version__');
}

/**
 * Check SoundFile (audio backend for torchaudio)
 */
export function checkSoundFile() {
  return checkPythonPackage('soundfile', '__version__');
}

/**
 * Get the FFmpeg executable path
 * Returns system ffmpeg if available, otherwise cached version
 */
export function getFFmpegPath() {
  // Check system PATH first
  if (checkSystemCommand('ffmpeg')) {
    return 'ffmpeg';
  }

  // Check cache directory
  const cacheDir = getCacheDir();
  const plat = platform();
  const filename = plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffmpegPath = join(cacheDir, 'bin', filename);

  if (existsSync(ffmpegPath)) {
    return ffmpegPath;
  }

  // Fallback to assuming it's in PATH
  return 'ffmpeg';
}

/**
 * Check FFmpeg and FFprobe availability
 * Both binaries are required for Creator functionality
 */
export function checkFFmpeg() {
  const plat = platform();
  const cacheDir = getCacheDir();
  const ffmpegFilename = plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeFilename = plat === 'win32' ? 'ffprobe.exe' : 'ffprobe';

  let ffmpegFound = false;
  let ffprobeFound = false;
  let source = null;
  let version = null;

  // Check system PATH first
  if (checkSystemCommand('ffmpeg')) {
    ffmpegFound = true;
    source = 'system';
    try {
      const output = execSync('ffmpeg -version', { encoding: 'utf8', timeout: 5000 });
      const versionMatch = output.match(/ffmpeg version (\S+)/);
      version = versionMatch ? versionMatch[1] : 'unknown';
    } catch {
      // Version check failed but ffmpeg exists
    }
  }

  if (checkSystemCommand('ffprobe')) {
    ffprobeFound = true;
  }

  // If both found in system, we're good
  if (ffmpegFound && ffprobeFound) {
    return { installed: true, version, source: 'system' };
  }

  // Check cache directory for missing binaries
  const cachedFfmpegPath = join(cacheDir, 'bin', ffmpegFilename);
  const cachedFfprobePath = join(cacheDir, 'bin', ffprobeFilename);

  if (!ffmpegFound && existsSync(cachedFfmpegPath)) {
    ffmpegFound = true;
    source = 'cached';
  }

  if (!ffprobeFound && existsSync(cachedFfprobePath)) {
    ffprobeFound = true;
    source = source || 'cached';
  }

  // Both must be available
  if (ffmpegFound && ffprobeFound) {
    return {
      installed: true,
      version,
      source,
      ffmpegPath: cachedFfmpegPath,
      ffprobePath: cachedFfprobePath,
    };
  }

  // Report which is missing
  return {
    installed: false,
    ffmpegFound,
    ffprobeFound,
    reason:
      !ffmpegFound && !ffprobeFound
        ? 'both_missing'
        : !ffmpegFound
          ? 'ffmpeg_missing'
          : 'ffprobe_missing',
  };
}

/**
 * Check if a Whisper model is downloaded
 */
export function checkWhisperModel(modelName) {
  const cacheDir = getCacheDir();

  // Whisper stores models in ~/.cache/whisper/ by default
  // We redirect via XDG_CACHE_HOME to our cache dir
  const modelPaths = [
    join(cacheDir, 'whisper', `${modelName}.pt`),
    join(homedir(), '.cache', 'whisper', `${modelName}.pt`),
  ];

  // Expected minimum sizes for models (to detect truncated downloads)
  const minSizes = {
    tiny: 70_000_000,
    base: 130_000_000,
    small: 450_000_000,
    medium: 1_400_000_000,
    large: 2_800_000_000,
    'large-v2': 2_800_000_000,
    'large-v3': 2_800_000_000,
    'large-v3-turbo': 1_500_000_000,
  };

  for (const modelPath of modelPaths) {
    if (existsSync(modelPath)) {
      try {
        const stats = statSync(modelPath);
        const minSize = minSizes[modelName] || 0;

        if (stats.size >= minSize) {
          return { installed: true, path: modelPath, size: stats.size };
        } else {
          return { installed: false, reason: 'truncated', size: stats.size, expected: minSize };
        }
      } catch {
        continue;
      }
    }
  }

  return { installed: false, reason: 'not_found' };
}

/**
 * Check if Demucs model is downloaded
 */
export function checkDemucsModel(_modelName = 'htdemucs_ft') {
  const cacheDir = getCacheDir();

  // Demucs stores models in torch hub cache
  const checkPaths = [
    join(cacheDir, 'models', 'torch', 'hub', 'checkpoints'),
    join(homedir(), '.cache', 'torch', 'hub', 'checkpoints'),
  ];

  for (const checkPath of checkPaths) {
    if (existsSync(checkPath)) {
      // Just check if directory has files - model names vary
      return { installed: true, path: checkPath };
    }
  }

  return { installed: false, reason: 'not_found' };
}

/**
 * Perform complete system check
 */
export async function checkAllComponents() {
  const [python, pytorch, soundfile, demucs, whisper, crepe] = await Promise.all([
    checkPython(),
    checkPyTorch(),
    checkSoundFile(),
    checkDemucs(),
    checkWhisper(),
    checkCrepe(),
  ]);

  const ffmpeg = checkFFmpeg();
  const whisperModel = checkWhisperModel('large-v3-turbo');
  const demucsModel = checkDemucsModel('htdemucs_ft');

  const components = {
    python,
    pytorch,
    soundfile,
    demucs,
    whisper,
    crepe,
    ffmpeg,
    whisperModel,
    demucsModel,
  };

  // Check if all required components are installed
  const allInstalled =
    python.installed &&
    pytorch.installed &&
    soundfile.installed &&
    demucs.installed &&
    whisper.installed &&
    crepe.installed &&
    ffmpeg.installed &&
    whisperModel.installed &&
    demucsModel.installed;

  return {
    ...components,
    allInstalled,
    cacheDir: getCacheDir(),
  };
}

export default {
  getCacheDir,
  getPythonPath,
  getPythonEnv,
  getFFmpegPath,
  checkPython,
  checkPyTorch,
  checkDemucs,
  checkWhisper,
  checkCrepe,
  checkFFmpeg,
  checkWhisperModel,
  checkDemucsModel,
  checkAllComponents,
};
