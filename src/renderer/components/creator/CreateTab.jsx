/**
 * CreateTab - Create karaoke files from audio
 *
 * Handles the full workflow:
 * 1. Check/install Python dependencies
 * 2. Select audio file
 * 3. Configure options (stems, whisper model, etc.)
 * 4. Run conversion pipeline
 * 5. Output .stem.m4a file
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { LLM_DEFAULTS, CREATOR_DEFAULTS } from '../../../shared/defaults.js';
import { PortalSelect } from '../PortalSelect.jsx';

// ============================================================================
// Shared Styles
// ============================================================================
const STYLES = {
  input:
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white',
  select:
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white',
  btnPrimary:
    'px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors',
  btnSecondary:
    'px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors',
  btnSuccess:
    'px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors',
  sectionTitle: 'text-lg font-semibold text-gray-900 dark:text-white mb-4',
  card: 'bg-gray-100 dark:bg-gray-800 rounded-lg p-6',
};

// ============================================================================
// Helper Components
// ============================================================================

function Spinner({ message, size = 'md' }) {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
  };
  return (
    <div className="text-center">
      <div
        className={`animate-spin rounded-full ${sizeClasses[size]} border-b-2 border-blue-500 mx-auto mb-3`}
      />
      {message && <p className="text-gray-600 dark:text-gray-400">{message}</p>}
    </div>
  );
}

function ErrorDisplay({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6 select-text">
      {onDismiss && (
        <button
          className="float-right text-red-700 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 text-xl leading-none"
          onClick={onDismiss}
        >
          ×
        </button>
      )}
      <div className="font-mono text-sm whitespace-pre-wrap overflow-x-auto max-h-96">{error}</div>
    </div>
  );
}

function MissingLinesDetails({ missingLines }) {
  if (!missingLines || missingLines.length === 0) return null;
  return (
    <details className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded p-2">
      <summary className="cursor-pointer font-semibold">
        💡 {missingLines.length} missing line{missingLines.length !== 1 ? 's' : ''} suggested (not
        applied)
      </summary>
      <ul className="mt-2 space-y-1 ml-4 list-disc max-h-40 overflow-y-auto">
        {missingLines.map((line, i) => (
          <li key={i}>
            <span className="text-blue-600 dark:text-blue-400">"{line.suggested_text}"</span>{' '}
            <span className="text-gray-500 dark:text-gray-400">
              ({line.start?.toFixed(1)}s-{line.end?.toFixed(1)}s, {line.confidence} confidence)
            </span>
            {line.reason && (
              <div className="text-gray-500 dark:text-gray-400 ml-2">→ {line.reason}</div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function SongTitle({ artist, title }) {
  return artist ? `${artist} - ${title}` : title;
}

// Format LLM provider name for display
function formatProviderName(provider) {
  const names = {
    anthropic: 'Anthropic Claude',
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    lmstudio: 'Local LLM Server',
  };
  return names[provider] || provider;
}

export function CreateTab({ bridge: _bridge }) {
  const [status, setStatus] = useState('checking'); // checking, setup, ready, creating, complete, installing
  const [components, setComponents] = useState(null);
  const [installProgress, setInstallProgress] = useState(null);
  const [error, setError] = useState(null);

  // Sub-tab state: 'create' or 'settings'
  const [activeSubTab, setActiveSubTab] = useState('create');

  // File and conversion state
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileLoading, setFileLoading] = useState(false); // Loading state for file selection
  const [conversionProgress, setConversionProgress] = useState(null);
  const [completedFile, setCompletedFile] = useState(null);
  const [llmStats, setLlmStats] = useState(null);
  const [songDuration, setSongDuration] = useState(null);
  const [processingTime, setProcessingTime] = useState(null);
  const [consoleLog, setConsoleLog] = useState([]);
  const [isLyricsOnlyMode, setIsLyricsOnlyMode] = useState(false); // Track if we started in lyrics-only mode
  const consoleEndRef = useRef(null);
  const conversionStartTimeRef = useRef(null);

  // Options
  const [options, setOptions] = useState({
    title: '',
    artist: '',
    numStems: 4, // Always 4 stems for .stem.m4a format
    language: 'en',
    referenceLyrics: '',
  });

  // LLM settings - uses unified defaults from shared/defaults.js
  const [llmSettings, setLlmSettings] = useState({ ...LLM_DEFAULTS });
  const [llmTestResult, setLlmTestResult] = useState(null);

  // Output settings
  const [outputToSongsFolder, setOutputToSongsFolder] = useState(false);
  const [whisperModel, setWhisperModel] = useState(CREATOR_DEFAULTS.whisperModel);
  const [enableCrepe, setEnableCrepe] = useState(CREATOR_DEFAULTS.enableCrepe);

  const checkComponents = useCallback(async () => {
    setStatus('checking');
    setError(null);

    try {
      const result = await window.kaiAPI?.creator?.checkComponents();

      if (result?.success) {
        setComponents(result);

        if (result.allInstalled) {
          setStatus('ready');
        } else {
          setStatus('setup');
        }
      } else {
        setError(result?.error || 'Failed to check components');
        setStatus('setup');
      }
    } catch (err) {
      console.error('Error checking components:', err);
      setError(err.message);
      setStatus('setup');
    }
  }, []);

  useEffect(() => {
    checkComponents();

    // Load LLM settings
    const loadLLMSettings = async () => {
      try {
        const settings = await window.kaiAPI?.creator?.getLLMSettings();
        if (settings) {
          setLlmSettings(settings);
        }
      } catch (err) {
        console.error('Failed to load LLM settings:', err);
      }
    };
    loadLLMSettings();

    // Load output settings
    const loadOutputSettings = async () => {
      try {
        const outputToSongs = await window.kaiAPI?.settings?.get(
          'creator.outputToSongsFolder',
          false
        );
        setOutputToSongsFolder(outputToSongs);
        const whisper = await window.kaiAPI?.settings?.get(
          'creator.whisperModel',
          CREATOR_DEFAULTS.whisperModel
        );
        setWhisperModel(whisper);
        const crepe = await window.kaiAPI?.settings?.get(
          'creator.enableCrepe',
          CREATOR_DEFAULTS.enableCrepe
        );
        setEnableCrepe(crepe);
      } catch (err) {
        console.error('Failed to load output settings:', err);
      }
    };
    loadOutputSettings();

    // Listen for installation progress
    const onInstallProgress = (_event, progress) => {
      setInstallProgress(progress);
      if (progress.step === 'complete') {
        setStatus('checking');
        checkComponents();
      }
    };

    const onInstallError = (_event, err) => {
      setError(err.error);
      setStatus('setup');
    };

    // Listen for conversion progress
    const onConversionProgress = (_event, progress) => {
      setConversionProgress(progress);
    };

    const onConversionConsole = (_event, data) => {
      const line = data.line;

      setConsoleLog((prev) => {
        // If line contains progress indicators (%, |, ━), replace last line
        // This handles tqdm and pip progress bars that use \r
        if (line.match(/\d+%|[│┃║▌▍▎▏█]|━|█/) && prev.length > 0) {
          // Check if last line was also a progress line
          const lastLine = prev[prev.length - 1];
          if (lastLine.match(/\d+%|[│┃║▌▍▎▏█]|━|█/)) {
            // Replace last line
            return [...prev.slice(0, -1), line];
          }
        }

        // Otherwise append new line
        return [...prev, line];
      });

      // Auto-scroll to bottom
      setTimeout(() => {
        consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    };

    const onConversionComplete = async (_event, result) => {
      const endTime = Date.now();
      const elapsed = conversionStartTimeRef.current
        ? (endTime - conversionStartTimeRef.current) / 1000
        : null;

      setCompletedFile(result.outputPath);
      setLlmStats(result.llmStats);
      setSongDuration(result.duration);
      setProcessingTime(elapsed);
      setStatus('complete');
      setConversionProgress(null);

      // If saved to songs folder, trigger a library sync to pick up the new file
      if (result.savedToSongsFolder) {
        try {
          await window.kaiAPI?.library?.syncLibrary?.();
        } catch (err) {
          console.error('Failed to sync library after creation:', err);
        }
      }
    };

    const onConversionError = (_event, err) => {
      setError(err.error);
      setStatus('ready');
      setConversionProgress(null);
    };

    window.kaiAPI?.creator?.onInstallProgress(onInstallProgress);
    window.kaiAPI?.creator?.onInstallError(onInstallError);
    window.kaiAPI?.creator?.onConversionProgress(onConversionProgress);
    window.kaiAPI?.creator?.onConversionConsole(onConversionConsole);
    window.kaiAPI?.creator?.onConversionComplete(onConversionComplete);
    window.kaiAPI?.creator?.onConversionError(onConversionError);

    return () => {
      window.kaiAPI?.creator?.removeInstallProgressListener(onInstallProgress);
      window.kaiAPI?.creator?.removeInstallErrorListener(onInstallError);
      window.kaiAPI?.creator?.removeConversionProgressListener(onConversionProgress);
      window.kaiAPI?.creator?.removeConversionConsoleListener(onConversionConsole);
      window.kaiAPI?.creator?.removeConversionCompleteListener(onConversionComplete);
      window.kaiAPI?.creator?.removeConversionErrorListener(onConversionError);
    };
  }, [checkComponents]);

  const handleInstall = async () => {
    setStatus('installing');
    setInstallProgress({ step: 'starting', message: 'Starting installation...', progress: 0 });
    setError(null);

    try {
      const result = await window.kaiAPI?.creator?.installComponents();
      if (!result?.success) {
        setError(result?.error || 'Installation failed');
        setStatus('setup');
      }
    } catch (err) {
      setError(err.message);
      setStatus('setup');
    }
  };

  const handleSelectFile = async () => {
    try {
      setFileLoading(true);
      setError(null);
      const result = await window.kaiAPI?.creator?.selectFile();

      if (result?.cancelled) {
        setFileLoading(false);
        return;
      }

      if (result?.success && result.file) {
        setSelectedFile(result.file);
        setOptions((prev) => ({
          ...prev,
          title: result.file.title || prev.title,
          artist: result.file.artist || prev.artist,
          // Auto-populate lyrics if found (prefer plain text)
          referenceLyrics: result.lyrics?.plainLyrics || prev.referenceLyrics,
        }));
        setError(null);
      } else {
        setError(result?.error || 'Failed to select file');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const handleSearchLyrics = async () => {
    if (!options.title) {
      setError('Please enter a title to search for lyrics');
      return;
    }

    try {
      const result = await window.kaiAPI?.creator?.searchLyrics(options.title, options.artist);

      if (result?.success) {
        setOptions((prev) => ({
          ...prev,
          // Prefer plain lyrics (no timestamps) for Whisper reference
          referenceLyrics: result.plainLyrics || '',
        }));
        setError(null);
      } else {
        setError(result?.error || 'No lyrics found');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleStartConversion = async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    setStatus('creating');
    setError(null);
    setConsoleLog([]); // Clear console log
    setConversionProgress({ step: 'starting', message: 'Starting conversion...', progress: 0 });
    conversionStartTimeRef.current = Date.now();

    try {
      // Get output directory based on settings
      let outputDir = undefined; // Default: same directory as source file
      if (outputToSongsFolder) {
        const songsFolder = await window.kaiAPI?.library?.getSongsFolder?.();
        if (songsFolder) {
          outputDir = songsFolder;
        }
      }

      // Determine if this is a lyrics-only conversion (stem file without lyrics)
      const lyricsOnlyMode = selectedFile.hasStems && !selectedFile.hasLyrics;
      setIsLyricsOnlyMode(lyricsOnlyMode);

      const result = await window.kaiAPI?.creator?.startConversion({
        inputPath: selectedFile.path,
        title: options.title || selectedFile.title,
        artist: options.artist || selectedFile.artist,
        tags: selectedFile.tags || {}, // Preserve all original ID3 tags
        numStems: options.numStems,
        whisperModel: whisperModel,
        language: options.language,
        enableCrepe: enableCrepe,
        referenceLyrics: options.referenceLyrics,
        outputDir,
        // Lyrics-only mode options
        lyricsOnlyMode,
        vocalsTrackIndex: selectedFile.vocalsTrackIndex ?? 4,
      });

      if (!result?.success) {
        setError(result?.error || 'Conversion failed');
        setStatus('ready');
        setConversionProgress(null);
      }
    } catch (err) {
      setError(err.message);
      setStatus('ready');
      setConversionProgress(null);
    }
  };

  const handleCancelConversion = async () => {
    try {
      await window.kaiAPI?.creator?.cancelConversion();
      setStatus('ready');
      setConversionProgress(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateAnother = () => {
    setSelectedFile(null);
    setCompletedFile(null);
    setLlmStats(null);
    setSongDuration(null);
    setProcessingTime(null);
    setIsLyricsOnlyMode(false);
    conversionStartTimeRef.current = null;
    setOptions({
      title: '',
      artist: '',
      numStems: 4,
      language: 'en',
      referenceLyrics: '',
    });
    setStatus('ready');
  };

  const handleOpenInEditor = async () => {
    if (!completedFile) return;

    try {
      // Load the song into the editor
      await window.kaiAPI?.editor?.loadKai?.(completedFile);

      // Switch to the editor tab by manipulating DOM (same pattern as TabNavigation)
      document.querySelectorAll('[id$="-tab"]').forEach((pane) => {
        pane.classList.add('hidden');
        pane.classList.remove('block', 'flex');
      });
      const editorPane = document.getElementById('editor-tab');
      if (editorPane) {
        editorPane.classList.remove('hidden');
        editorPane.classList.add('block');
      }
    } catch (err) {
      console.error('Failed to open in editor:', err);
      setError(`Failed to open in editor: ${err.message}`);
    }
  };

  const handleSaveLLMSettings = async () => {
    try {
      await window.kaiAPI?.creator?.saveLLMSettings(llmSettings);
      setLlmTestResult({ success: true, message: 'Settings saved!' });
      setTimeout(() => setLlmTestResult(null), 3000);
    } catch (err) {
      setLlmTestResult({ success: false, message: err.message });
    }
  };

  const handleTestLLMConnection = async () => {
    if (!llmSettings.apiKey && llmSettings.provider !== 'lmstudio') {
      setLlmTestResult({ success: false, message: 'API key required' });
      return;
    }

    setLlmTestResult({ testing: true, message: 'Testing connection...' });

    try {
      const result = await window.kaiAPI?.creator?.testLLMConnection(llmSettings);
      setLlmTestResult(result);
      setTimeout(() => setLlmTestResult(null), 3000);
    } catch (err) {
      setLlmTestResult({ success: false, message: err.message });
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (status === 'checking') {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner message="Checking AI tools..." />
      </div>
    );
  }

  // Component display configuration
  const componentDisplay = [
    { key: 'python', label: 'Python 3.10+' },
    { key: 'pytorch', label: 'PyTorch' },
    { key: 'soundfile', label: 'SoundFile (Audio)' },
    { key: 'demucs', label: 'Demucs (Stems)' },
    { key: 'whisper', label: 'Whisper (Lyrics)' },
    { key: 'crepe', label: 'CREPE (Pitch)' },
    { key: 'ffmpeg', label: 'FFmpeg' },
    { key: 'whisperModel', label: 'Whisper Model' },
    { key: 'demucsModel', label: 'Demucs Model' },
  ];

  if (status === 'installing') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-lg text-center">
          <div className="text-6xl mb-6">⚡</div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Installing AI Tools
          </h2>

          <div className="mb-6">
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${installProgress?.progress || 0}%` }}
              />
            </div>
            <p className="text-gray-600 dark:text-gray-400 mt-2 break-words">
              {installProgress?.message || 'Starting...'}
            </p>
          </div>

          <button
            className={STYLES.btnSecondary}
            onClick={() => window.kaiAPI?.creator?.cancelInstall()}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (status === 'setup') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-lg text-center">
          <div className="text-6xl mb-6">⚡</div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            AI Tools Setup Required
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            To create karaoke files, you need to install AI processing tools. This includes stem
            separation (Demucs), lyrics transcription (Whisper), and pitch detection (CREPE).
          </p>

          <ErrorDisplay error={error} />

          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 mb-6 text-left">
            <div className="space-y-2">
              {componentDisplay.map(({ key, label }) => {
                const comp = components?.[key];
                const isInstalled = comp?.installed;
                const version = comp?.version;
                const device = comp?.device;

                return (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-gray-700 dark:text-gray-300">{label}</span>
                    <span className={isInstalled ? 'text-green-500' : 'text-gray-400'}>
                      {isInstalled
                        ? `✓ ${version || ''}${device ? ` (${device})` : ''}`.trim() ||
                          '✓ Installed'
                        : '○ Not installed'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            <p>Download size: ~2-4 GB</p>
            <p>Disk space required: ~5 GB</p>
          </div>

          <button className={STYLES.btnPrimary} onClick={handleInstall}>
            Install AI Tools
          </button>
        </div>
      </div>
    );
  }

  // Creating state - show progress
  if (status === 'creating') {
    return (
      <div className="h-full flex flex-col p-8">
        <div className="max-w-4xl mx-auto w-full">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              {isLyricsOnlyMode
                ? 'Adding Lyrics to Stem File 🎤'
                : 'Creating Stems+Karaoke File ⚡'}
            </h2>

            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 mb-4">
              <p className="text-gray-700 dark:text-gray-300 font-medium">
                <SongTitle artist={options.artist} title={options.title} />
              </p>
            </div>

            <div className="mb-6">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${conversionProgress?.progress || 0}%` }}
                />
              </div>
              <p className="text-gray-600 dark:text-gray-400 mt-3">
                {conversionProgress?.message || 'Starting...'}
              </p>
            </div>

            {/* Console Log Panel */}
            {consoleLog.length > 0 && (
              <div className="mb-6 bg-gray-900 dark:bg-black rounded-lg p-4 h-48 overflow-y-auto">
                <div className="text-xs font-mono text-green-400 whitespace-pre-wrap select-text leading-tight">
                  {consoleLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                  <div ref={consoleEndRef} />
                </div>
              </div>
            )}

            <button className={STYLES.btnSecondary} onClick={handleCancelConversion}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Complete state - show success
  if (status === 'complete') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-lg w-full text-center">
          <div className="text-6xl mb-6">✅</div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            {isLyricsOnlyMode ? 'Lyrics Added!' : 'Karaoke File Created!'}
          </h2>

          <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-4 mb-6">
            <p className="text-green-700 dark:text-green-400 font-medium">
              <SongTitle artist={options.artist} title={options.title} />
            </p>

            {/* Processing Stats */}
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 space-y-1">
              {songDuration && <p>🎵 Song length: {formatDuration(songDuration)}</p>}
              {processingTime && (
                <p>
                  ⏱️ Processing time: {formatDuration(processingTime)}
                  {songDuration && (
                    <span className="ml-2 text-xs">
                      ({(songDuration / processingTime).toFixed(1)}x realtime)
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* LLM Stats */}
            {llmStats?.failed ? (
              <div className="mt-2">
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  ⚠️ AI correction failed ({formatProviderName(llmStats.provider)}):{' '}
                  {llmStats.error || 'Unknown error'}
                </p>
              </div>
            ) : llmStats && llmStats.corrections_applied > 0 ? (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-green-600 dark:text-green-400">
                  ✨ {formatProviderName(llmStats.provider)}: {llmStats.suggestions_made} suggestion
                  {llmStats.suggestions_made !== 1 ? 's' : ''} ({llmStats.corrections_applied}{' '}
                  applied
                  {llmStats.missing_lines_suggested > 0 &&
                    `, ${llmStats.missing_lines_suggested} for review`}
                  )
                </p>
                {llmStats.corrections && llmStats.corrections.length > 0 && (
                  <details className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded p-2">
                    <summary className="cursor-pointer font-semibold">
                      ✅ {llmStats.corrections.length} correction
                      {llmStats.corrections.length !== 1 ? 's' : ''} applied
                    </summary>
                    <ul className="mt-2 space-y-1 ml-4 list-disc max-h-40 overflow-y-auto">
                      {llmStats.corrections.map((corr, i) => (
                        <li key={i}>
                          Line #{corr.line_num}:{' '}
                          <span className="text-red-600 dark:text-red-400 line-through">
                            {corr.old_text}
                          </span>{' '}
                          →{' '}
                          <span className="text-green-600 dark:text-green-400">
                            {corr.new_text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <MissingLinesDetails missingLines={llmStats.missing_lines} />
              </div>
            ) : llmStats && llmStats.corrections_applied === 0 ? (
              <div className="mt-2">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  ✓ {formatProviderName(llmStats.provider)}: No corrections applied
                  {llmStats.missing_lines_suggested > 0
                    ? `, ${llmStats.missing_lines_suggested} missing line${llmStats.missing_lines_suggested !== 1 ? 's' : ''} suggested`
                    : ''}
                </p>
                <MissingLinesDetails missingLines={llmStats.missing_lines} />
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                AI correction not used
              </p>
            )}

            <p className="text-sm text-green-600 dark:text-green-500 mt-2 break-all">
              {completedFile}
            </p>
          </div>

          <div className="flex gap-4 justify-center">
            {outputToSongsFolder && (
              <button className={STYLES.btnPrimary} onClick={handleOpenInEditor}>
                Open in Editor
              </button>
            )}
            <button
              className={outputToSongsFolder ? STYLES.btnSecondary : STYLES.btnPrimary}
              onClick={handleCreateAnother}
            >
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Ready state - show create interface
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        {/* Sub-tab navigation */}
        <div className="flex border-b border-gray-300 dark:border-gray-600 mb-6">
          <button
            className={`px-4 py-2 font-medium transition-colors ${
              activeSubTab === 'create'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
            onClick={() => setActiveSubTab('create')}
          >
            Create
          </button>
          <button
            className={`px-4 py-2 font-medium transition-colors ${
              activeSubTab === 'settings'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
            onClick={() => setActiveSubTab('settings')}
          >
            Settings
          </button>
        </div>

        <ErrorDisplay error={error} onDismiss={() => setError(null)} />

        {/* Settings Sub-tab */}
        {activeSubTab === 'settings' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Creator Settings</h2>

            {/* Output Location */}
            <div className={STYLES.card}>
              <h3 className={STYLES.sectionTitle}>Output Location</h3>
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={outputToSongsFolder}
                  onChange={async (e) => {
                    const value = e.target.checked;
                    setOutputToSongsFolder(value);
                    await window.kaiAPI?.settings?.set('creator.outputToSongsFolder', value);
                  }}
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Save output files to karaoke songs folder
                </span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                When enabled, created .stem.m4a files will be saved to your configured songs library
                folder instead of next to the source file.
              </p>
            </div>

            {/* Whisper Model */}
            <div className={STYLES.card}>
              <h3 className={STYLES.sectionTitle}>Whisper Model</h3>
              <div className="w-64">
                <PortalSelect
                  value={whisperModel}
                  onChange={async (e) => {
                    const value = e.target.value;
                    setWhisperModel(value);
                    await window.kaiAPI?.settings?.set('creator.whisperModel', value);
                  }}
                  options={[
                    { value: 'large-v3-turbo', label: 'Large V3 Turbo (recommended)' },
                    { value: 'large-v3', label: 'Large V3 (slower, slightly better)' },
                    { value: 'medium', label: 'Medium (faster)' },
                    { value: 'small', label: 'Small (fastest)' },
                  ]}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Larger models are more accurate but slower. Large V3 Turbo is recommended for most
                users.
              </p>
            </div>

            {/* Pitch Detection */}
            <div className={STYLES.card}>
              <h3 className={STYLES.sectionTitle}>Pitch Detection</h3>
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={enableCrepe}
                  onChange={async (e) => {
                    const value = e.target.checked;
                    setEnableCrepe(value);
                    await window.kaiAPI?.settings?.set('creator.enableCrepe', value);
                  }}
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Enable pitch detection (CREPE)
                </span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Analyzes vocal pitch for karaoke scoring features. Adds processing time but enables
                pitch visualization.
              </p>
            </div>

            {/* LLM Settings */}
            <div className={STYLES.card}>
              <h3 className={STYLES.sectionTitle}>AI Lyrics Correction</h3>

              <div className="space-y-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={llmSettings.enabled}
                    onChange={(e) =>
                      setLlmSettings((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                  />
                  <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                    Use AI to improve lyrics accuracy (compares Whisper output to reference lyrics)
                  </span>
                </label>

                {llmSettings.enabled && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        AI Provider
                      </label>
                      <PortalSelect
                        value={llmSettings.provider}
                        onChange={(e) =>
                          setLlmSettings((prev) => ({ ...prev, provider: e.target.value }))
                        }
                        options={[
                          {
                            value: 'lmstudio',
                            label: 'Local LLM Server (LM Studio, Ollama, etc.)',
                          },
                          { value: 'anthropic', label: 'Anthropic Claude' },
                          { value: 'openai', label: 'OpenAI' },
                          { value: 'gemini', label: 'Google Gemini' },
                        ]}
                      />
                    </div>

                    {llmSettings.provider !== 'lmstudio' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          API Key
                        </label>
                        <input
                          type="password"
                          className={STYLES.input}
                          value={llmSettings.apiKey}
                          onChange={(e) =>
                            setLlmSettings((prev) => ({ ...prev, apiKey: e.target.value }))
                          }
                          placeholder={`Enter ${llmSettings.provider} API key...`}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {llmSettings.provider === 'anthropic' && (
                            <>
                              Get your key from{' '}
                              <a
                                href="https://console.anthropic.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                console.anthropic.com
                              </a>
                            </>
                          )}
                          {llmSettings.provider === 'openai' && (
                            <>
                              Get your key from{' '}
                              <a
                                href="https://platform.openai.com/api-keys"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                platform.openai.com
                              </a>
                            </>
                          )}
                          {llmSettings.provider === 'gemini' && (
                            <>
                              Get your key from{' '}
                              <a
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Google AI Studio
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                    )}

                    {llmSettings.provider === 'lmstudio' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Server Base URL
                        </label>
                        <input
                          type="text"
                          className={STYLES.input}
                          value={llmSettings.baseUrl}
                          onChange={(e) =>
                            setLlmSettings((prev) => ({ ...prev, baseUrl: e.target.value }))
                          }
                          placeholder="http://localhost:1234/v1"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          OpenAI-compatible API endpoint (LM Studio, Ollama, text-generation-webui,
                          etc.)
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        className={STYLES.btnSuccess}
                        onClick={handleTestLLMConnection}
                        disabled={llmTestResult?.testing}
                      >
                        {llmTestResult?.testing ? 'Testing...' : 'Test Connection'}
                      </button>
                      <button
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                        onClick={handleSaveLLMSettings}
                      >
                        Save Settings
                      </button>
                    </div>

                    {llmTestResult && !llmTestResult.testing && (
                      <div
                        className={`px-4 py-2 rounded-lg ${
                          llmTestResult.success
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                        }`}
                      >
                        {llmTestResult.success ? '✓' : '✗'}{' '}
                        {llmTestResult.message || llmTestResult.error}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Create Sub-tab */}
        {activeSubTab === 'create' && (
          <>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Create Stems+Karaoke File
            </h2>

            {/* File Selection */}
            <div className={`${STYLES.card} mb-6`}>
              <h3 className={STYLES.sectionTitle}>1. Select Audio File</h3>

              {fileLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="sm" message="Reading file info & searching lyrics..." />
                </div>
              ) : selectedFile ? (
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-900 dark:text-white font-medium truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {formatDuration(selectedFile.duration)} •{' '}
                        {selectedFile.codec?.toUpperCase() || 'Unknown'}{' '}
                        {selectedFile.isVideo && '• Video'}
                      </p>
                    </div>
                    <button
                      className="ml-4 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
                      onClick={handleSelectFile}
                    >
                      Change
                    </button>
                  </div>
                  {/* Stem file detection indicator */}
                  {selectedFile.hasStems && !selectedFile.hasLyrics && (
                    <div className="mt-3 px-3 py-2 bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded-lg">
                      <p className="text-sm text-purple-700 dark:text-purple-300 font-medium">
                        🎛️ Stem file detected ({selectedFile.audioStreamCount} tracks)
                      </p>
                      <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                        Stems: {selectedFile.stemNames?.join(', ')} • Will add lyrics only (no stem
                        separation needed)
                      </p>
                    </div>
                  )}
                  {selectedFile.hasStems && selectedFile.hasLyrics && (
                    <div className="mt-3 px-3 py-2 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                      <p className="text-sm text-yellow-700 dark:text-yellow-300 font-medium">
                        ⚠️ This file already has karaoke lyrics
                      </p>
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                        Processing will replace existing lyrics with new transcription
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  className="w-full px-6 py-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                  onClick={handleSelectFile}
                >
                  <div className="text-gray-600 dark:text-gray-400">
                    <div className="text-3xl mb-2">🎵</div>
                    <p>Click to select an audio or video file</p>
                    <p className="text-sm mt-1">
                      MP3, WAV, FLAC, OGG, M4A, MP4, MKV, AVI, MOV, WEBM
                    </p>
                  </div>
                </button>
              )}
            </div>

            {/* Song Info */}
            <div className={`${STYLES.card} mb-6`}>
              <h3 className={STYLES.sectionTitle}>2. Song Information</h3>

              {fileLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="sm" message="Loading song metadata..." />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Title
                      </label>
                      <input
                        type="text"
                        className={STYLES.input}
                        value={options.title}
                        onChange={(e) => setOptions((prev) => ({ ...prev, title: e.target.value }))}
                        placeholder="Song title"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Artist
                      </label>
                      <input
                        type="text"
                        className={STYLES.input}
                        value={options.artist}
                        onChange={(e) =>
                          setOptions((prev) => ({ ...prev, artist: e.target.value }))
                        }
                        placeholder="Artist name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Language
                      </label>
                      <PortalSelect
                        value={options.language}
                        onChange={(e) =>
                          setOptions((prev) => ({ ...prev, language: e.target.value }))
                        }
                        options={[
                          { value: 'en', label: 'English' },
                          { value: 'es', label: 'Spanish' },
                          { value: 'fr', label: 'French' },
                          { value: 'de', label: 'German' },
                          { value: 'it', label: 'Italian' },
                          { value: 'pt', label: 'Portuguese' },
                          { value: 'ja', label: 'Japanese' },
                          { value: 'ko', label: 'Korean' },
                          { value: 'zh', label: 'Chinese' },
                        ]}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Reference Lyrics (optional)
                      </label>
                      <button
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={handleSearchLyrics}
                      >
                        Search LRCLIB
                      </button>
                    </div>
                    <textarea
                      className={`${STYLES.input} h-24 resize-none`}
                      value={options.referenceLyrics}
                      onChange={(e) =>
                        setOptions((prev) => ({ ...prev, referenceLyrics: e.target.value }))
                      }
                      placeholder="Paste lyrics here to improve transcription accuracy..."
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Reference lyrics help Whisper recognize song-specific vocabulary
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Create Button */}
            <div className="text-center">
              <button
                className={`px-8 py-4 ${
                  selectedFile?.hasStems && !selectedFile?.hasLyrics
                    ? 'bg-purple-600 hover:bg-purple-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                } disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold text-lg rounded-lg transition-colors`}
                onClick={handleStartConversion}
                disabled={!selectedFile}
              >
                {selectedFile?.hasStems && !selectedFile?.hasLyrics
                  ? 'Add Lyrics to Stem File'
                  : 'Create Stems+Karaoke File'}
              </button>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
                {selectedFile?.hasStems && !selectedFile?.hasLyrics
                  ? 'Lyrics-only mode is much faster (typically under 1 minute)'
                  : 'Processing time depends on song length and your hardware (typically 2-10 minutes)'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
