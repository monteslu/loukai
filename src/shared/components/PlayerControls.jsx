/**
 * PlayerControls - Unified player transport controls
 *
 * Based on renderer UI (better styling than web admin)
 * Works with both ElectronBridge and WebBridge via callbacks
 */

import { formatDuration } from '../formatUtils.js';

export function PlayerControls({
  playback,
  currentSong,
  currentEffect,
  isLoading,
  onPlay,
  onPause,
  onRestart,
  onNext,
  onSeek,
  onPreviousEffect,
  onNextEffect,
  onOpenCanvasWindow,
  className = '',
}) {
  const { isPlaying, position = 0, duration = 0 } = playback || {};

  // Derive loading state from currentSong if not explicitly provided
  const loading = isLoading !== undefined ? isLoading : currentSong?.isLoading || false;

  const handleProgressClick = (e) => {
    if (!duration || !onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, x / rect.width));
    const newPosition = progress * duration;
    onSeek(newPosition);
  };

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div
      className={`bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 ${className}`}
    >
      <div className="flex items-center gap-3">
        {/* Transport Controls */}
        <button
          onClick={onRestart}
          title="Restart Track"
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 flex items-center justify-center"
          disabled={loading}
        >
          <span className="material-icons text-gray-700 dark:text-gray-300 text-2xl leading-none">
            replay
          </span>
        </button>

        <button
          onClick={isPlaying ? onPause : onPlay}
          title={loading ? 'Loading...' : isPlaying ? 'Pause' : 'Play'}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 flex items-center justify-center"
          disabled={loading}
        >
          {loading ? (
            <span className="material-icons text-gray-700 dark:text-gray-300 text-2xl leading-none animate-spin">
              hourglass_empty
            </span>
          ) : (
            <span className="material-icons text-blue-600 dark:text-blue-400 text-2xl leading-none">
              {isPlaying ? 'pause' : 'play_arrow'}
            </span>
          )}
        </button>

        <button
          onClick={onNext}
          title="Next Track"
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 flex items-center justify-center"
          disabled={loading}
        >
          <span className="material-icons text-gray-700 dark:text-gray-300 text-2xl leading-none">
            skip_next
          </span>
        </button>

        {/* Progress Bar */}
        <div className="flex-1 mx-4">
          <div
            className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer"
            onClick={handleProgressClick}
          >
            <div
              className="absolute inset-y-0 left-0 bg-blue-600 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-blue-600 rounded-full shadow-lg transition-all"
              style={{ left: `calc(${progress}% - 8px)` }}
            />
          </div>
        </div>

        {/* Time Display */}
        <div className="flex items-center gap-1 text-sm font-mono text-gray-700 dark:text-gray-300 flex-shrink-0">
          <span>{formatDuration(position)}</span>
          <span>/</span>
          <span>{formatDuration(duration)}</span>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 mx-2" />

        {/* Effects Controls */}
        {onPreviousEffect && (
          <button
            onClick={onPreviousEffect}
            title="Previous Effect"
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition flex items-center justify-center"
          >
            <span className="material-icons text-gray-700 dark:text-gray-300 leading-none">
              chevron_left
            </span>
          </button>
        )}
        <span className="px-3 py-1 bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium min-w-[120px] text-center">
          {currentEffect || 'No Effect'}
        </span>
        {onNextEffect && (
          <button
            onClick={onNextEffect}
            title="Next Effect"
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition flex items-center justify-center"
          >
            <span className="material-icons text-gray-700 dark:text-gray-300 leading-none">
              chevron_right
            </span>
          </button>
        )}
        {onOpenCanvasWindow && (
          <button
            onClick={onOpenCanvasWindow}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition flex items-center justify-center"
            title="Open Canvas Window"
          >
            <span className="material-icons text-gray-700 dark:text-gray-300 leading-none">
              open_in_new
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
