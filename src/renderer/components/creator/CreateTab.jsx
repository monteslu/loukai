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

  // File and conversion state
  const [selectedFile, setSelectedFile] = useState(null);
  const [conversionProgress, setConversionProgress] = useState(null);
  const [completedFile, setCompletedFile] = useState(null);
  const [llmStats, setLlmStats] = useState(null);
  const [songDuration, setSongDuration] = useState(null);
  const [processingTime, setProcessingTime] = useState(null);
  const [consoleLog, setConsoleLog] = useState([]);
  const consoleEndRef = useRef(null);
  const conversionStartTimeRef = useRef(null);

  // Options
  const [options, setOptions] = useState({
    title: '',
    artist: '',
    numStems: 4, // 2 = vocals+backing, 4 = vocals+drums+bass+other
    whisperModel: 'large-v3-turbo',
    language: 'en',
    enableCrepe: true,
    referenceLyrics: '',
  });

  // LLM settings
  const [llmSettings, setLlmSettings] = useState({
    enabled: true,
    provider: 'anthropic',
    model: '',
    apiKey: '',
    baseUrl: 'http://localhost:1234/v1',
  });
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState(null);

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

    const onConversionComplete = (_event, result) => {
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
      const result = await window.kaiAPI?.creator?.selectFile();

      if (result?.cancelled) {
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
      const result = await window.kaiAPI?.creator?.startConversion({
        inputPath: selectedFile.path,
        title: options.title || selectedFile.title,
        artist: options.artist || selectedFile.artist,
        tags: selectedFile.tags || {}, // Preserve all original ID3 tags
        numStems: options.numStems,
        whisperModel: options.whisperModel,
        language: options.language,
        enableCrepe: options.enableCrepe,
        referenceLyrics: options.referenceLyrics,
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
    conversionStartTimeRef.current = null;
    setOptions({
      title: '',
      artist: '',
      numStems: 4,
      whisperModel: 'large-v3-turbo',
      language: 'en',
      enableCrepe: true,
      referenceLyrics: '',
    });
    setStatus('ready');
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
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Checking AI tools...</p>
        </div>
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
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              {installProgress?.message || 'Starting...'}
            </p>
          </div>

          <button
            className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
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

          {error && (
            <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6 select-text">
              <div className="font-mono text-sm whitespace-pre-wrap overflow-x-auto max-h-96">
                {error}
              </div>
            </div>
          )}

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

          <button
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            onClick={handleInstall}
          >
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
              Creating Stems+Karaoke File ⚡
            </h2>

            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 mb-4">
              <p className="text-gray-700 dark:text-gray-300 font-medium">
                {options.artist ? `${options.artist} - ${options.title}` : options.title}
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
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                Step: {conversionProgress?.step || 'initializing'}
              </p>
            </div>

            <button
              className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors"
              onClick={handleCancelConversion}
            >
              Cancel
            </button>
          </div>

          {/* Console Log Panel */}
          {consoleLog.length > 0 && (
            <div className="mt-6 bg-gray-900 dark:bg-black rounded-lg p-4 h-32 overflow-y-auto">
              <div className="text-xs font-mono text-green-400 whitespace-pre-wrap select-text leading-tight">
                {consoleLog.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                <div ref={consoleEndRef} />
              </div>
            </div>
          )}
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
            Karaoke File Created!
          </h2>

          <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-4 mb-6">
            <p className="text-green-700 dark:text-green-400 font-medium">
              {options.artist ? `${options.artist} - ${options.title}` : options.title}
            </p>

            {/* Processing Stats */}
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 space-y-1">
              {songDuration && (
                <p>
                  🎵 Song length: {Math.floor(songDuration / 60)}:
                  {Math.floor(songDuration % 60)
                    .toString()
                    .padStart(2, '0')}
                </p>
              )}
              {processingTime && (
                <p>
                  ⏱️ Processing time: {Math.floor(processingTime / 60)}:
                  {Math.floor(processingTime % 60)
                    .toString()
                    .padStart(2, '0')}
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
                {llmStats.missing_lines && llmStats.missing_lines.length > 0 && (
                  <details className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded p-2">
                    <summary className="cursor-pointer font-semibold">
                      💡 {llmStats.missing_lines.length} missing line
                      {llmStats.missing_lines.length !== 1 ? 's' : ''} suggested (not applied)
                    </summary>
                    <ul className="mt-2 space-y-1 ml-4 list-disc max-h-40 overflow-y-auto">
                      {llmStats.missing_lines.map((line, i) => (
                        <li key={i}>
                          <span className="text-blue-600 dark:text-blue-400">
                            "{line.suggested_text}"
                          </span>{' '}
                          <span className="text-gray-500 dark:text-gray-400">
                            ({line.start?.toFixed(1)}s-{line.end?.toFixed(1)}s, {line.confidence}{' '}
                            confidence)
                          </span>
                          {line.reason && (
                            <div className="text-gray-500 dark:text-gray-400 ml-2">
                              → {line.reason}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ) : llmStats && llmStats.corrections_applied === 0 ? (
              <div className="mt-2">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  ✓ {formatProviderName(llmStats.provider)}: No corrections applied
                  {llmStats.missing_lines_suggested > 0
                    ? `, ${llmStats.missing_lines_suggested} missing line${llmStats.missing_lines_suggested !== 1 ? 's' : ''} suggested`
                    : ''}
                </p>
                {llmStats.missing_lines && llmStats.missing_lines.length > 0 && (
                  <details className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded p-2 mt-2">
                    <summary className="cursor-pointer font-semibold">
                      💡 {llmStats.missing_lines.length} missing line
                      {llmStats.missing_lines.length !== 1 ? 's' : ''} suggested (not applied)
                    </summary>
                    <ul className="mt-2 space-y-1 ml-4 list-disc max-h-40 overflow-y-auto">
                      {llmStats.missing_lines.map((line, i) => (
                        <li key={i}>
                          <span className="text-blue-600 dark:text-blue-400">
                            "{line.suggested_text}"
                          </span>{' '}
                          <span className="text-gray-500 dark:text-gray-400">
                            ({line.start?.toFixed(1)}s-{line.end?.toFixed(1)}s, {line.confidence}{' '}
                            confidence)
                          </span>
                          {line.reason && (
                            <div className="text-gray-500 dark:text-gray-400 ml-2">
                              → {line.reason}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
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

          <div className="space-x-4">
            <button
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
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
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Create Stems+Karaoke File ⚡
        </h2>

        {error && (
          <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6 select-text">
            <button
              className="float-right text-red-700 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 text-xl leading-none"
              onClick={() => setError(null)}
            >
              ×
            </button>
            <div className="font-mono text-sm whitespace-pre-wrap overflow-x-auto max-h-96">
              {error}
            </div>
          </div>
        )}

        {/* File Selection */}
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            1. Select Audio File
          </h3>

          {selectedFile ? (
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
          ) : (
            <button
              className="w-full px-6 py-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
              onClick={handleSelectFile}
            >
              <div className="text-gray-600 dark:text-gray-400">
                <div className="text-3xl mb-2">🎵</div>
                <p>Click to select an audio or video file</p>
                <p className="text-sm mt-1">MP3, WAV, FLAC, OGG, M4A, MP4, MKV, AVI, MOV, WEBM</p>
              </div>
            </button>
          )}
        </div>

        {/* Song Info */}
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            2. Song Information
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={options.artist}
                onChange={(e) => setOptions((prev) => ({ ...prev, artist: e.target.value }))}
                placeholder="Artist name"
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
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white h-24 resize-none"
              value={options.referenceLyrics}
              onChange={(e) => setOptions((prev) => ({ ...prev, referenceLyrics: e.target.value }))}
              placeholder="Paste lyrics here to improve transcription accuracy..."
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Reference lyrics help Whisper recognize song-specific vocabulary
            </p>
          </div>
        </div>

        {/* Options */}
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">3. Options</h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Stem Separation
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={options.numStems}
                onChange={(e) =>
                  setOptions((prev) => ({ ...prev, numStems: Number(e.target.value) }))
                }
              >
                <option value={2}>2 Stems (Vocals + Backing)</option>
                <option value={4}>4 Stems (Vocals + Drums + Bass + Other)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Whisper Model
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={options.whisperModel}
                onChange={(e) => setOptions((prev) => ({ ...prev, whisperModel: e.target.value }))}
              >
                <option value="large-v3-turbo">Large V3 Turbo (recommended)</option>
                <option value="large-v3">Large V3 (slower, slightly better)</option>
                <option value="medium">Medium (faster)</option>
                <option value="small">Small (fastest)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Language
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                value={options.language}
                onChange={(e) => setOptions((prev) => ({ ...prev, language: e.target.value }))}
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="zh">Chinese</option>
              </select>
            </div>
            <div className="flex items-center">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={options.enableCrepe}
                  onChange={(e) =>
                    setOptions((prev) => ({ ...prev, enableCrepe: e.target.checked }))
                  }
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Enable pitch detection (CREPE)
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Advanced Settings - LLM */}
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg mb-6">
          <button
            className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors rounded-lg"
            onClick={() => setShowLlmSettings(!showLlmSettings)}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              4. Advanced: AI Lyrics Correction (Optional)
            </h3>
            <span className="text-gray-500">{showLlmSettings ? '▼' : '▶'}</span>
          </button>

          {showLlmSettings && (
            <div className="px-6 pb-6 space-y-4">
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={llmSettings.enabled}
                  onChange={(e) =>
                    setLlmSettings((prev) => ({ ...prev, enabled: e.target.checked }))
                  }
                />
                <label className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Use AI to improve lyrics accuracy (compares Whisper output to reference lyrics)
                </label>
              </div>

              {llmSettings.enabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      AI Provider
                    </label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      value={llmSettings.provider}
                      onChange={(e) =>
                        setLlmSettings((prev) => ({ ...prev, provider: e.target.value }))
                      }
                    >
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="openai">OpenAI</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="lmstudio">Local LLM Server (LM Studio, Ollama, etc.)</option>
                    </select>
                  </div>

                  {llmSettings.provider !== 'lmstudio' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
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
          )}
        </div>

        {/* Create Button */}
        <div className="text-center">
          <button
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold text-lg rounded-lg transition-colors"
            onClick={handleStartConversion}
            disabled={!selectedFile}
          >
            Create Stems+Karaoke File ⚡
          </button>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
            Processing time depends on song length and your hardware (typically 2-10 minutes)
          </p>
        </div>
      </div>
    </div>
  );
}
