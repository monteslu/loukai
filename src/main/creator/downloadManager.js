/**
 * Download Manager - Handles downloading and installing AI components for Creator
 *
 * Components:
 * - Python (standalone build from python-build-standalone)
 * - PyTorch (with MPS/CUDA/CPU support)
 * - Demucs (stem separation)
 * - Whisper (transcription)
 * - torchcrepe (pitch detection)
 * - FFmpeg (audio processing)
 * - Models (Whisper large-v3-turbo, Demucs htdemucs_ft)
 */

import https from 'https';
import http from 'http';
import { createWriteStream, existsSync, mkdirSync, rmSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { execSync, spawn } from 'child_process';
import { getCacheDir, getPythonPath, getPythonEnv } from './systemChecker.js';
import yauzl from 'yauzl';

/**
 * Extract a zip file using yauzl (cross-platform)
 */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        const fullPath = join(destDir, entry.fileName);

        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          mkdirSync(fullPath, { recursive: true });
          zipfile.readEntry();
        } else {
          // File entry
          mkdirSync(dirname(fullPath), { recursive: true });
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }
            const writeStream = createWriteStream(fullPath);
            readStream.pipe(writeStream);
            writeStream.on('close', () => {
              zipfile.readEntry();
            });
            writeStream.on('error', reject);
          });
        }
      });

      zipfile.on('end', resolve);
      zipfile.on('error', reject);
    });
  });
}

// Python standalone builds from indygreg/python-build-standalone
const PYTHON_BUILDS = {
  darwin: {
    x64: 'https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-x86_64-apple-darwin-install_only.tar.gz',
    arm64:
      'https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-aarch64-apple-darwin-install_only.tar.gz',
  },
  win32: {
    x64: 'https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-x86_64-pc-windows-msvc-shared-install_only.tar.gz',
  },
  linux: {
    x64: 'https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-x86_64-unknown-linux-gnu-install_only.tar.gz',
    arm64:
      'https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-aarch64-unknown-linux-gnu-install_only.tar.gz',
  },
};

/**
 * Get Python build URL for current platform
 */
function getPythonBuildUrl() {
  const platform = process.platform;
  const arch = process.arch;

  const builds = PYTHON_BUILDS[platform];
  if (!builds) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const url = builds[arch] || builds.x64;
  if (!url) {
    throw new Error(`Unsupported architecture: ${arch} on ${platform}`);
  }

  return url;
}

/**
 * Download a file with progress tracking
 */
function downloadFile(url, destPath, onProgress = null) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading: ${url}`);
    console.log(`   Destination: ${destPath}`);

    let protocol;
    try {
      protocol = url.startsWith('https') ? https : http;
    } catch (error) {
      console.error('❌ Invalid URL:', url);
      console.error('Error:', error);
      console.error('Stack:', error.stack);
      reject(new Error(`Invalid URL: ${url} - ${error.message}`));
      return;
    }

    // Ensure directory exists
    const dir = dirname(destPath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      } catch (error) {
        console.error(`❌ Failed to create directory: ${dir}`);
        console.error('Error:', error);
        console.error('Stack:', error.stack);
        reject(new Error(`Failed to create directory ${dir}: ${error.message}`));
        return;
      }
    }

    const request = protocol.get(url, (response) => {
      console.log(`📡 Response status: ${response.statusCode} ${response.statusMessage}`);
      console.log(`   Headers:`, JSON.stringify(response.headers, null, 2));

      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const location = response.headers.location;
        console.log(`🔀 Redirect to: ${location}`);

        try {
          // Handle relative redirects by resolving against original URL
          const redirectUrl = location.startsWith('http') ? location : new URL(location, url).href;
          console.log(`🔀 Resolved redirect URL: ${redirectUrl}`);
          downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
        } catch (error) {
          console.error(`❌ Failed to resolve redirect URL`);
          console.error('Original URL:', url);
          console.error('Location header:', location);
          console.error('Error:', error);
          console.error('Stack:', error.stack);
          reject(
            new Error(`Failed to resolve redirect from ${url} to ${location}: ${error.message}`)
          );
        }
        return;
      }

      if (response.statusCode !== 200) {
        const errorMsg = `HTTP ${response.statusCode}: ${response.statusMessage} for ${url}`;
        console.error(`❌ ${errorMsg}`);
        reject(new Error(errorMsg));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      console.log(`📦 Content length: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
      let downloadedBytes = 0;
      let lastLoggedPercent = -1;

      const fileStream = createWriteStream(destPath);

      let lastCallbackPercent = -1;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (onProgress && totalBytes > 0) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);

          // Log progress every 10%
          if (percent >= lastLoggedPercent + 10 || percent === 100) {
            console.log(
              `   Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(2)} / ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`
            );
            lastLoggedPercent = percent;
          }

          // Only call onProgress when percent actually changes (avoid flooding IPC)
          if (percent !== lastCallbackPercent) {
            lastCallbackPercent = percent;
            onProgress(percent, downloadedBytes, totalBytes);
          }
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`✅ Download complete: ${destPath}`);
        console.log(`   Size: ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`);
        resolve();
      });

      fileStream.on('error', (error) => {
        fileStream.close();
        console.error(`❌ File stream error for ${destPath}`);
        console.error('Error:', error);
        console.error('Stack:', error.stack);
        reject(new Error(`File write failed for ${destPath}: ${error.message}`));
      });
    });

    request.on('error', (error) => {
      console.error(`❌ Request error for ${url}`);
      console.error('Error:', error);
      console.error('Stack:', error.stack);
      reject(new Error(`Download failed for ${url}: ${error.message}`));
    });

    request.end();
  });
}

/**
 * Run pip install command with progress tracking
 */
function pipInstall(packages, onProgress = null) {
  return new Promise((resolve, reject) => {
    const pythonPath = getPythonPath();

    if (!existsSync(pythonPath)) {
      reject(new Error('Python not installed'));
      return;
    }

    // Split packages string into args
    const packageArgs = packages.split(/\s+/).filter((p) => p);
    // Use --progress-bar on to ensure we get progress output
    const args = ['-m', 'pip', 'install', ...packageArgs, '--no-cache-dir', '--progress-bar', 'on'];

    const proc = spawn(pythonPath, args, {
      env: {
        ...getPythonEnv(),
        // Force color output which includes progress bars
        FORCE_COLOR: '1',
        PIP_PROGRESS_BAR: 'on',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let currentPackage = '';
    let lastProgressUpdate = 0;

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      const text = data.toString();

      if (onProgress) {
        // Parse pip output for progress info
        // Look for "Collecting package" or "Downloading package"
        const collectMatch = text.match(/Collecting\s+(\S+)/);
        if (collectMatch) {
          currentPackage = collectMatch[1].split('[')[0].split('>')[0].split('<')[0].split('=')[0];
          onProgress('collecting', `Collecting ${currentPackage}...`);
        }

        if (text.includes('Successfully installed')) {
          onProgress('complete', 'Installation complete');
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const text = data.toString();

      if (onProgress) {
        // pip 23+ shows download progress in stderr with format like:
        // "Downloading torch-2.0.0.whl (619.9 MB)"
        // "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100.5/619.9 MB 15.2 MB/s eta 0:00:34"

        // Match "Downloading package (size)"
        const downloadMatch = text.match(/Downloading\s+(\S+)\s+\(([^)]+)\)/);
        if (downloadMatch) {
          currentPackage = downloadMatch[1].split('-')[0];
          const totalSize = downloadMatch[2];
          onProgress('downloading', `Downloading ${currentPackage} (${totalSize})...`);
        }

        // Match progress line with downloaded/total and speed
        // Format: "   ━━━━━━━━ 100.5/619.9 MB 15.2 MB/s eta 0:00:34"
        const progressMatch = text.match(
          /(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*(MB|GB|KB)\s+(\d+\.?\d*)\s*(MB|GB|KB)\/s/
        );
        if (progressMatch) {
          const now = Date.now();
          // Throttle updates to every 200ms to avoid flooding
          if (now - lastProgressUpdate > 200) {
            lastProgressUpdate = now;
            const downloaded = parseFloat(progressMatch[1]);
            const total = parseFloat(progressMatch[2]);
            const unit = progressMatch[3];
            const speed = progressMatch[4];
            const speedUnit = progressMatch[5];

            if (total > 0) {
              const percent = Math.floor((downloaded / total) * 100);
              const packageName = currentPackage || 'package';
              onProgress(
                'downloading',
                `Downloading ${packageName}: ${downloaded}/${total} ${unit} (${speed} ${speedUnit}/s) - ${percent}%`
              );
            }
          }
        }

        // Also check for simpler progress format
        // "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 619.9/619.9 MB"
        const simpleProgressMatch = text.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*(MB|GB|KB)\s*$/);
        if (simpleProgressMatch && !progressMatch) {
          const now = Date.now();
          if (now - lastProgressUpdate > 200) {
            lastProgressUpdate = now;
            const downloaded = parseFloat(simpleProgressMatch[1]);
            const total = parseFloat(simpleProgressMatch[2]);
            const unit = simpleProgressMatch[3];

            if (total > 0) {
              const percent = Math.floor((downloaded / total) * 100);
              const packageName = currentPackage || 'package';
              onProgress(
                'downloading',
                `Downloading ${packageName}: ${downloaded}/${total} ${unit} - ${percent}%`
              );
            }
          }
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, stdout });
      } else {
        reject(new Error(`pip install failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run pip: ${err.message}`));
    });
  });
}

/**
 * Detect GPU type for PyTorch variant selection
 */
function detectGPU() {
  const platform = process.platform;

  // macOS: Check for Apple Silicon (MPS)
  if (platform === 'darwin') {
    return process.arch === 'arm64' ? 'mps' : 'cpu';
  }

  // Linux/Windows: Check for NVIDIA GPU
  try {
    execSync('nvidia-smi', { stdio: 'ignore' });
    return 'cuda';
  } catch {
    return 'cpu';
  }
}

/**
 * Download and install Python
 */
export async function downloadPython(onProgress = null) {
  console.log('🐍 Starting Python installation...');
  const cacheDir = getCacheDir();
  const pythonDir = join(cacheDir, 'python');
  console.log(`   Cache dir: ${cacheDir}`);
  console.log(`   Python dir: ${pythonDir}`);

  // Check if already installed
  const pythonPath = getPythonPath();
  console.log(`   Checking for existing Python: ${pythonPath}`);
  if (existsSync(pythonPath)) {
    console.log('✅ Python already installed');
    if (onProgress) onProgress('complete', 'Python already installed');
    return { success: true, path: pythonPath };
  }

  try {
    const url = getPythonBuildUrl();
    console.log(`🌐 Python download URL: ${url}`);
    const tarPath = join(cacheDir, 'python.tar.gz');

    // Download
    console.log('📥 Starting Python download...');
    if (onProgress) onProgress('downloading', 'Downloading Python...');
    await downloadFile(url, tarPath, (percent) => {
      if (onProgress) onProgress('downloading', `Downloading Python... ${percent}%`);
    });

    // Extract
    console.log('📦 Extracting Python...');
    if (onProgress) onProgress('extracting', 'Extracting Python...');

    // Create python directory
    if (!existsSync(pythonDir)) {
      console.log(`   Creating Python directory: ${pythonDir}`);
      mkdirSync(pythonDir, { recursive: true });
    }

    // Use tar to extract (available on all platforms)
    console.log('   Loading tar module...');
    const tar = await import('tar');
    console.log('   Extracting tarball...');
    await tar.extract({
      file: tarPath,
      cwd: pythonDir,
      strip: 1,
    });
    console.log('✅ Extraction complete');

    // Remove quarantine on macOS
    if (process.platform === 'darwin') {
      console.log('🍎 Removing macOS quarantine attributes...');
      try {
        execSync(`xattr -cr "${pythonDir}"`, { stdio: 'ignore' });
        console.log('✅ Quarantine removed');
      } catch (error) {
        console.warn('⚠️ Failed to remove quarantine (non-fatal):', error.message);
      }
    }

    // Clean up tarball
    console.log('🧹 Cleaning up tarball...');
    rmSync(tarPath, { force: true });

    // Upgrade pip and setuptools, fix common conflicts
    if (onProgress) onProgress('configuring', 'Upgrading pip and setuptools...');
    await pipInstall('--upgrade pip setuptools wheel');

    // Fix coverage module conflict that can break installs
    try {
      await pipInstall('--upgrade coverage');
    } catch {
      // Non-fatal - coverage may not be installed
    }

    console.log('✅ Python installation complete');
    if (onProgress) onProgress('complete', 'Python installed successfully');
    return { success: true, path: pythonPath };
  } catch (error) {
    console.error('❌ Python installation failed');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * Download and install PyTorch
 */
export async function downloadPyTorch(variant = 'auto', onProgress = null) {
  try {
    // Detect variant if auto
    if (variant === 'auto') {
      const gpu = detectGPU();
      variant = gpu === 'cuda' ? 'cuda' : gpu === 'mps' ? 'default' : 'cpu';
    }

    let packageSpec;
    if (variant === 'cuda') {
      packageSpec =
        'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118';
    } else if (variant === 'default' || process.platform === 'darwin') {
      packageSpec = 'torch torchvision torchaudio';
    } else {
      packageSpec = 'torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu';
    }

    if (onProgress) onProgress('installing', 'Installing PyTorch...');
    await pipInstall(packageSpec, (stage, msg) => {
      if (onProgress) onProgress(stage, msg);
    });

    if (onProgress) onProgress('complete', 'PyTorch installed');
    return { success: true, variant };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Download and install SoundFile (audio backend for torchaudio)
 */
export async function downloadSoundFile(onProgress = null) {
  try {
    if (onProgress) onProgress('installing', 'Installing SoundFile...');
    await pipInstall('soundfile', (stage, msg) => {
      if (onProgress) onProgress(stage, msg);
    });

    if (onProgress) onProgress('complete', 'SoundFile installed');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Download and install Demucs
 */
export async function downloadDemucs(onProgress = null) {
  try {
    if (onProgress) onProgress('installing', 'Installing Demucs...');
    await pipInstall('demucs', (stage, msg) => {
      if (onProgress) onProgress(stage, msg);
    });

    if (onProgress) onProgress('complete', 'Demucs installed');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Download and install Whisper
 */
export async function downloadWhisper(onProgress = null) {
  try {
    if (onProgress) onProgress('installing', 'Installing Whisper...');
    await pipInstall('openai-whisper', (stage, msg) => {
      if (onProgress) onProgress(stage, msg);
    });

    if (onProgress) onProgress('complete', 'Whisper installed');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Download and install torchcrepe (CREPE pitch detection)
 */
export async function downloadCrepe(onProgress = null) {
  try {
    if (onProgress) onProgress('installing', 'Installing torchcrepe...');
    await pipInstall('torchcrepe>=0.0.12', (stage, msg) => {
      if (onProgress) onProgress(stage, msg);
    });

    if (onProgress) onProgress('complete', 'torchcrepe installed');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Whisper model URLs from https://github.com/openai/whisper/blob/main/whisper/__init__.py
const WHISPER_MODELS = {
  tiny: 'https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt',
  base: 'https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt',
  small:
    'https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt',
  medium:
    'https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt',
  'large-v1':
    'https://openaipublic.azureedge.net/main/whisper/models/e4b87e7e0bf463eb8e6956e646f1e277e901512310def2c24bf0e11bd3c28e9a/large-v1.pt',
  'large-v2':
    'https://openaipublic.azureedge.net/main/whisper/models/81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524/large-v2.pt',
  'large-v3':
    'https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt',
  'large-v3-turbo':
    'https://openaipublic.azureedge.net/main/whisper/models/aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a/large-v3-turbo.pt',
};

// Model sizes for progress display
const WHISPER_MODEL_SIZES = {
  tiny: '~75 MB',
  base: '~145 MB',
  small: '~465 MB',
  medium: '~1.5 GB',
  'large-v1': '~3 GB',
  'large-v2': '~3 GB',
  'large-v3': '~3 GB',
  'large-v3-turbo': '~1.6 GB',
};

/**
 * Download Whisper model directly with progress, then verify
 */
export async function downloadWhisperModel(modelName = 'large-v3-turbo', onProgress = null) {
  const pythonPath = getPythonPath();

  if (!existsSync(pythonPath)) {
    return { success: false, error: 'Python not installed' };
  }

  const modelUrl = WHISPER_MODELS[modelName];
  if (!modelUrl) {
    return { success: false, error: `Unknown model: ${modelName}` };
  }

  const modelSize = WHISPER_MODEL_SIZES[modelName] || 'unknown size';

  // Whisper stores models in ~/.cache/whisper/ (we use XDG_CACHE_HOME from getPythonEnv)
  const cacheDir = getCacheDir();
  const whisperCacheDir = join(cacheDir, 'whisper');
  const modelPath = join(whisperCacheDir, `${modelName}.pt`);

  // Check if model already exists
  if (existsSync(modelPath)) {
    if (onProgress) onProgress('complete', `${modelName} model already downloaded`);
    return { success: true, model: modelName, cached: true };
  }

  // Ensure whisper cache directory exists
  if (!existsSync(whisperCacheDir)) {
    mkdirSync(whisperCacheDir, { recursive: true });
  }

  try {
    // Download with progress
    if (onProgress)
      onProgress('downloading', `Downloading ${modelName} model (${modelSize})... 0%`);

    await downloadFile(modelUrl, modelPath, (percent) => {
      if (onProgress) {
        onProgress('downloading', `Downloading ${modelName} model (${modelSize})... ${percent}%`);
      }
    });

    if (onProgress) onProgress('downloading', `Verifying ${modelName} model...`);

    // Verify the model loads correctly
    const verifyResult = await verifyWhisperModel(modelName);
    if (!verifyResult.success) {
      // Delete corrupted download
      try {
        rmSync(modelPath);
      } catch {
        // Ignore cleanup errors
      }
      return { success: false, error: verifyResult.error };
    }

    if (onProgress) onProgress('complete', `${modelName} model ready`);
    return { success: true, model: modelName };
  } catch (error) {
    // Clean up partial download
    try {
      if (existsSync(modelPath)) {
        rmSync(modelPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    return { success: false, error: error.message };
  }
}

/**
 * Verify a Whisper model loads correctly
 */
function verifyWhisperModel(modelName) {
  const pythonPath = getPythonPath();

  return new Promise((resolve) => {
    const script = `
import sys
import json
try:
    import whisper
    model = whisper.load_model("${modelName}")
    print(json.dumps({"success": True}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

    const proc = spawn(pythonPath, ['-c', script], {
      env: getPythonEnv(),
    });

    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        resolve({ success: false, error: 'Failed to verify model' });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Download Demucs model by running a test load
 */
export function downloadDemucsModel(modelName = 'htdemucs_ft', onProgress = null) {
  const pythonPath = getPythonPath();

  if (!existsSync(pythonPath)) {
    return Promise.resolve({ success: false, error: 'Python not installed' });
  }

  return new Promise((resolve) => {
    if (onProgress) onProgress('downloading', `Downloading Demucs ${modelName} model (~300 MB)...`);

    const script = `
import sys
import json
try:
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    print("STATUS:Downloading model...", file=sys.stderr)
    from demucs.pretrained import get_model
    model = get_model("${modelName}")
    print("STATUS:Model loaded successfully", file=sys.stderr)
    sys.stdout = old_stdout
    print(json.dumps({"success": True}))
except Exception as e:
    sys.stdout = old_stdout if 'old_stdout' in locals() else sys.stdout
    print(json.dumps({"success": False, "error": str(e)}))
`;

    const proc = spawn(pythonPath, ['-c', script], {
      env: getPythonEnv(),
    });

    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (!line) return;

      if (onProgress) {
        // Check for our custom status messages
        if (line.startsWith('STATUS:')) {
          onProgress('downloading', line.replace('STATUS:', ''));
        } else if (line.includes('%|')) {
          // tqdm progress bar - extract percentage
          const match = line.match(/(\d+)%\|/);
          if (match) {
            onProgress('downloading', `Downloading model... ${match[1]}%`);
          }
        } else if (line.includes('Downloading') || line.includes('downloading')) {
          onProgress('downloading', line.slice(0, 80));
        }
      }
    });

    proc.on('close', () => {
      try {
        const result = JSON.parse(stdout.trim());
        if (result.success) {
          if (onProgress) onProgress('complete', `${modelName} model ready`);
          resolve({ success: true, model: modelName });
        } else {
          resolve({ success: false, error: result.error });
        }
      } catch {
        resolve({ success: false, error: 'Failed to parse output' });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Download FFmpeg binary
 */
export async function downloadFFmpeg(onProgress = null) {
  console.log('🎬 Starting FFmpeg installation...');
  const cacheDir = getCacheDir();
  const binDir = join(cacheDir, 'bin');
  console.log(`   Binary dir: ${binDir}`);

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
    console.log(`   Created binary directory`);
  }

  const plat = process.platform;
  const ffmpegName = plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = plat === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const ffmpegPath = join(binDir, ffmpegName);
  const ffprobePath = join(binDir, ffprobeName);
  console.log(`   Platform: ${plat}`);
  console.log(`   FFmpeg path: ${ffmpegPath}`);
  console.log(`   FFprobe path: ${ffprobePath}`);

  // Check if both already exist
  if (existsSync(ffmpegPath) && existsSync(ffprobePath)) {
    console.log('✅ FFmpeg and FFprobe already installed');
    if (onProgress) onProgress('complete', 'FFmpeg already downloaded');
    return { success: true, ffmpegPath, ffprobePath };
  }

  try {
    // URLs for ffmpeg builds that include both ffmpeg and ffprobe
    let url;
    let ffprobeUrl = null; // macOS needs separate download for ffprobe
    if (plat === 'darwin') {
      // evermeet.cx provides separate downloads for ffmpeg and ffprobe on macOS
      url = 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip';
      ffprobeUrl = 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip';
    } else if (plat === 'win32') {
      // BtbN builds include both ffmpeg and ffprobe
      url =
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    } else {
      // John Van Sickle builds include both ffmpeg and ffprobe
      url = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
    }
    console.log(`🌐 FFmpeg download URL: ${url}`);
    if (ffprobeUrl) {
      console.log(`🌐 FFprobe download URL: ${ffprobeUrl}`);
    }

    const archivePath = join(binDir, plat === 'linux' ? 'ffmpeg.tar.xz' : 'ffmpeg.zip');
    console.log(`   Archive path: ${archivePath}`);

    // Download ffmpeg
    console.log('📥 Starting FFmpeg download...');
    if (onProgress) onProgress('downloading', 'Downloading FFmpeg...');
    await downloadFile(url, archivePath, (percent) => {
      if (onProgress) onProgress('downloading', `Downloading FFmpeg... ${percent}%`);
    });

    // Download ffprobe separately if needed (macOS)
    let ffprobeArchivePath = null;
    if (ffprobeUrl) {
      ffprobeArchivePath = join(binDir, 'ffprobe.zip');
      console.log('📥 Starting FFprobe download...');
      if (onProgress) onProgress('downloading', 'Downloading FFprobe...');
      await downloadFile(ffprobeUrl, ffprobeArchivePath, (percent) => {
        if (onProgress) onProgress('downloading', `Downloading FFprobe... ${percent}%`);
      });
    }

    // Extract
    console.log('📦 Extracting FFmpeg...');
    if (onProgress) onProgress('extracting', 'Extracting FFmpeg...');

    // Extract and find ffmpeg binary
    const { mkdtempSync, readdirSync, statSync, copyFileSync } = await import('fs');
    const { tmpdir } = await import('os');
    const tempDir = mkdtempSync(join(tmpdir(), 'ffmpeg-'));

    try {
      console.log(`   Extracting to temp dir: ${tempDir}`);
      if (plat === 'linux') {
        console.log('   Using tar to extract...');
        execSync(`tar -xf "${archivePath}" -C "${tempDir}"`);
      } else {
        console.log('   Using yauzl to extract...');
        await extractZip(archivePath, tempDir);
      }
      console.log('   Extraction complete, searching for binary...');

      // Find binary recursively by name
      const findBinary = (dir, name) => {
        const files = readdirSync(dir);
        for (const file of files) {
          const fullPath = join(dir, file);
          try {
            if (statSync(fullPath).isDirectory()) {
              const found = findBinary(fullPath, name);
              if (found) return found;
            } else if (file.toLowerCase() === name.toLowerCase()) {
              return fullPath;
            }
          } catch {
            continue;
          }
        }
        return null;
      };

      // Extract both ffmpeg and ffprobe
      const ffmpegName = plat === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
      const ffprobeName = plat === 'win32' ? 'ffprobe.exe' : 'ffprobe';

      const ffmpegFound = findBinary(tempDir, ffmpegName);
      const ffprobeFound = findBinary(tempDir, ffprobeName);

      if (ffmpegFound) {
        const ffmpegDest = join(binDir, ffmpegName);
        console.log(`   Found ffmpeg: ${ffmpegFound}`);
        console.log(`   Copying to: ${ffmpegDest}`);
        copyFileSync(ffmpegFound, ffmpegDest);
        if (plat !== 'win32') {
          chmodSync(ffmpegDest, 0o755);
        }
        console.log('✅ ffmpeg binary installed');
      } else {
        console.error('❌ ffmpeg binary not found in archive');
        console.error(`   Searched in: ${tempDir}`);
        throw new Error('ffmpeg binary not found in archive');
      }

      if (ffprobeFound) {
        console.log(`   Found ffprobe: ${ffprobeFound}`);
        console.log(`   Copying to: ${ffprobePath}`);
        copyFileSync(ffprobeFound, ffprobePath);
        if (plat !== 'win32') {
          chmodSync(ffprobePath, 0o755);
        }
        console.log('✅ ffprobe binary installed');
      } else if (ffprobeArchivePath) {
        // macOS: Extract ffprobe from separate archive
        console.log('📦 Extracting FFprobe from separate archive...');
        const ffprobeTempDir = mkdtempSync(join(tmpdir(), 'ffprobe-'));
        try {
          await extractZip(ffprobeArchivePath, ffprobeTempDir);
          const ffprobeExtracted = findBinary(ffprobeTempDir, ffprobeName);
          if (ffprobeExtracted) {
            console.log(`   Found ffprobe: ${ffprobeExtracted}`);
            console.log(`   Copying to: ${ffprobePath}`);
            copyFileSync(ffprobeExtracted, ffprobePath);
            chmodSync(ffprobePath, 0o755);
            console.log('✅ ffprobe binary installed');
          } else {
            console.warn('⚠️ ffprobe not found in separate archive');
          }
          rmSync(ffprobeTempDir, { recursive: true, force: true });
          rmSync(ffprobeArchivePath, { force: true });
        } catch (ffprobeError) {
          console.warn('⚠️ Failed to extract ffprobe:', ffprobeError.message);
          rmSync(ffprobeTempDir, { recursive: true, force: true });
        }
      } else {
        console.warn('⚠️ ffprobe binary not found in archive');
      }

      // Clean up
      console.log('🧹 Cleaning up temporary files...');
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(archivePath, { force: true });

      console.log('✅ FFmpeg installation complete');
      if (onProgress) onProgress('complete', 'FFmpeg installed');
      return { success: true, ffmpegPath, ffprobePath };
    } catch (extractError) {
      console.error('❌ FFmpeg extraction failed');
      console.error('Error:', extractError);
      console.error('Stack:', extractError.stack);
      rmSync(tempDir, { recursive: true, force: true });
      throw extractError;
    }
  } catch (error) {
    console.error('❌ FFmpeg installation failed');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * Install all components in order
 */
export async function installAllComponents(onProgress = null) {
  console.log('🚀 Starting installation of all components...');
  console.log(`   Platform: ${process.platform}`);
  console.log(`   Architecture: ${process.arch}`);

  const results = {};

  // Define steps with human-readable labels and estimated sizes
  const steps = [
    { name: 'python', label: 'Python 3.12', fn: downloadPython, weight: 10, size: '~50 MB' },
    {
      name: 'pytorch',
      label: 'PyTorch',
      fn: () => downloadPyTorch('auto'),
      weight: 35,
      size: '~2 GB',
    },
    { name: 'soundfile', label: 'SoundFile', fn: downloadSoundFile, weight: 2, size: '~5 MB' },
    { name: 'demucs', label: 'Demucs', fn: downloadDemucs, weight: 8, size: '~100 MB' },
    { name: 'whisper', label: 'Whisper', fn: downloadWhisper, weight: 8, size: '~50 MB' },
    { name: 'crepe', label: 'CREPE', fn: downloadCrepe, weight: 4, size: '~20 MB' },
    { name: 'ffmpeg', label: 'FFmpeg', fn: downloadFFmpeg, weight: 5, size: '~80 MB' },
    {
      name: 'whisperModel',
      label: 'Whisper Model',
      action: 'Downloading', // Custom action word instead of "Installing"
      fn: () => downloadWhisperModel('large-v3-turbo'),
      weight: 15,
      size: '~1.5 GB',
    },
    {
      name: 'demucsModel',
      label: 'Demucs Model',
      action: 'Downloading', // Custom action word instead of "Installing"
      fn: () => downloadDemucsModel('htdemucs_ft'),
      weight: 15,
      size: '~300 MB',
    },
  ];

  console.log(`📋 Installation plan: ${steps.length} components`);
  steps.forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.label} (${s.size})`);
  });

  let completedWeight = 0;
  const totalWeight = steps.reduce((sum, s) => sum + s.weight, 0);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNumber = i + 1;
    const totalSteps = steps.length;
    const action = step.action || 'Installing';

    console.log(`\n📦 [${stepNumber}/${totalSteps}] ${action} ${step.label}...`);

    if (onProgress) {
      const percent = Math.floor((completedWeight / totalWeight) * 100);
      onProgress(
        percent,
        `[${stepNumber}/${totalSteps}] ${action} ${step.label} (${step.size})...`
      );
    }

    const result = await step.fn((stage, msg) => {
      if (onProgress && stage !== 'complete') {
        // Calculate sub-progress within this step
        const basePercent = Math.floor((completedWeight / totalWeight) * 100);

        // For download stages, try to extract percent from message
        let subProgress = 0;
        const percentMatch = msg.match(/(\d+)%/);
        if (percentMatch) {
          subProgress = parseInt(percentMatch[1], 10);
        }

        // Add sub-progress contribution
        const stepContribution = Math.floor((step.weight / totalWeight) * subProgress);
        const totalPercent = Math.min(basePercent + stepContribution, 99);

        onProgress(totalPercent, `[${stepNumber}/${totalSteps}] ${msg}`);
      }
    });

    results[step.name] = result;

    if (!result.success) {
      console.error(`❌ [${stepNumber}/${totalSteps}] Failed to install ${step.label}`);
      console.error('   Error:', result.error);
      if (onProgress) {
        onProgress(
          Math.floor((completedWeight / totalWeight) * 100),
          `Failed to install ${step.label}: ${result.error}`
        );
      }
      return { success: false, failed: step.name, error: result.error, results };
    }

    console.log(`✅ [${stepNumber}/${totalSteps}] ${step.label} installed successfully`);

    completedWeight += step.weight;

    if (onProgress) {
      const percent = Math.floor((completedWeight / totalWeight) * 100);
      onProgress(percent, `[${stepNumber}/${totalSteps}] ${step.label} installed`);
    }
  }

  console.log('\n🎉 All components installed successfully!');
  console.log('Installation results:');
  Object.entries(results).forEach(([name, result]) => {
    console.log(`   ${result.success ? '✅' : '❌'} ${name}`);
  });

  if (onProgress) onProgress(100, 'All components installed successfully!');
  return { success: true, results };
}

export default {
  downloadPython,
  downloadPyTorch,
  downloadSoundFile,
  downloadDemucs,
  downloadWhisper,
  downloadCrepe,
  downloadWhisperModel,
  downloadDemucsModel,
  downloadFFmpeg,
  installAllComponents,
};
