/**
 * PlayerControls - Unified player transport controls
 *
 * Based on renderer UI (better styling than web admin)
 * Works with both ElectronBridge and WebBridge via callbacks
 */

import { useState, useEffect, useRef } from 'react';
import { Tooltip } from './Tooltip.jsx';
import { formatDuration } from '../formatUtils.js';
import { shiftKeyName, KEY_SHIFT_MIN, KEY_SHIFT_MAX } from '../utils/musicKey.js';

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
  onOpenViewer,
  keyShift = 0,
  songKey,
  onKeyShift,
  className = '',
}) {
  const { isPlaying, position = 0, duration = 0 } = playback || {};

  // Smooth position interpolation for 60fps progress bar updates
  const [interpolatedPosition, setInterpolatedPosition] = useState(position);
  const lastReportedPosition = useRef(position);
  const lastReportedTime = useRef(performance.now());
  const animationFrameRef = useRef(null);

  // Derive loading state from currentSong if not explicitly provided
  const loading = isLoading !== undefined ? isLoading : currentSong?.isLoading || false;

  // Update refs when position changes from IPC
  useEffect(() => {
    lastReportedPosition.current = position;
    lastReportedTime.current = performance.now();
    setInterpolatedPosition(position);
  }, [position]);

  // Smooth interpolation when playing
  useEffect(() => {
    if (!isPlaying) {
      // Stop interpolation when paused
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    // Interpolate position on every frame
    const animate = () => {
      const now = performance.now();
      const elapsed = (now - lastReportedTime.current) / 1000; // Convert to seconds
      const newPosition = Math.min(lastReportedPosition.current + elapsed, duration || Infinity);
      setInterpolatedPosition(newPosition);
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, duration]);

  // Truncate effect name to 28 characters with ellipsis
  const truncateEffectName = (name) => {
    if (!name || name === 'No Effect') return name;
    return name.length > 28 ? name.substring(0, 28) + '…' : name;
  };

  const handleProgressClick = (e) => {
    if (!duration || !onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, x / rect.width));
    const newPosition = progress * duration;
    onSeek(newPosition);
  };

  // Use interpolated position for smooth 60fps progress bar
  const progress = duration > 0 ? (interpolatedPosition / duration) * 100 : 0;

  return (
    <div
      className={`bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 ${className}`}
    >
      <div className="flex items-center gap-3">
        {/* Transport Controls */}
        <Tooltip text="Restart Track">
          <button
            onClick={onRestart}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 flex items-center justify-center"
            disabled={loading}
          >
            <span className="material-icons text-gray-700 dark:text-gray-300 text-2xl leading-none">
              replay
            </span>
          </button>
        </Tooltip>

        <Tooltip text={loading ? 'Loading...' : isPlaying ? 'Pause' : 'Play'}>
          <button
            onClick={isPlaying ? onPause : onPlay}
            data-gamepad-action="play-pause"
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
        </Tooltip>

        <Tooltip text="Next Track">
          <button
            onClick={onNext}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 flex items-center justify-center"
            disabled={loading}
          >
            <span className="material-icons text-gray-700 dark:text-gray-300 text-2xl leading-none">
              skip_next
            </span>
          </button>
        </Tooltip>

        {/* Progress Bar */}
        <div className="flex-1 mx-4">
          <div
            className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer"
            onClick={handleProgressClick}
          >
            <div
              className="absolute inset-y-0 left-0 bg-blue-600 rounded-full"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-blue-600 rounded-full shadow-lg"
              style={{ left: `calc(${progress}% - 8px)` }}
            />
          </div>
        </div>

        {/* Time Display */}
        <div className="flex items-center gap-1 text-sm font-mono text-gray-700 dark:text-gray-300 flex-shrink-0">
          <span>{formatDuration(interpolatedPosition)}</span>
          <span>/</span>
          <span>{formatDuration(duration)}</span>
        </div>

        {/* Key shift (issue #90): per-loaded-song, resets on load, never saved */}
        {onKeyShift && (
          <>
            <div className="flex items-center flex-shrink-0">
              <button
                onClick={() => onKeyShift(keyShift - 1)}
                disabled={loading || keyShift <= KEY_SHIFT_MIN}
                className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition disabled:opacity-40 flex items-center justify-center"
              >
                <span className="material-icons text-gray-700 dark:text-gray-300 text-lg leading-none">
                  remove
                </span>
              </button>
              <Tooltip text="Key shift (music and guide vocal, never the mic)">
                <span
                  className={`text-sm font-mono text-center px-0.5 ${
                    keyShift !== 0
                      ? 'text-blue-600 dark:text-blue-400 font-semibold'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {keyShift === 0
                    ? songKey || 'Key'
                    : `${keyShift > 0 ? '+' : ''}${keyShift}${
                        songKey && shiftKeyName(songKey, keyShift)
                          ? ` ${shiftKeyName(songKey, keyShift)}`
                          : ''
                      }`}
                </span>
              </Tooltip>
              <button
                onClick={() => onKeyShift(keyShift + 1)}
                disabled={loading || keyShift >= KEY_SHIFT_MAX}
                className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition disabled:opacity-40 flex items-center justify-center"
              >
                <span className="material-icons text-gray-700 dark:text-gray-300 text-lg leading-none">
                  add
                </span>
              </button>
            </div>
          </>
        )}

        {/* Divider */}
        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 mx-2" />

        {/* Effects Controls */}
        {onPreviousEffect && (
          <Tooltip text="Previous Effect">
            <button
              onClick={onPreviousEffect}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition flex items-center justify-center"
            >
              <span className="material-icons text-gray-700 dark:text-gray-300 leading-none">
                chevron_left
              </span>
            </button>
          </Tooltip>
        )}
        {/* Full name on hover: the label itself is truncated to 28 chars. */}
        <Tooltip text={currentEffect || 'No Effect'}>
          <span className="px-3 py-1 bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium min-w-[120px] text-center">
            {truncateEffectName(currentEffect || 'No Effect')}
          </span>
        </Tooltip>
        {onNextEffect && (
          <Tooltip text="Next Effect">
            <button
              onClick={onNextEffect}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition flex items-center justify-center"
            >
              <span className="material-icons text-gray-700 dark:text-gray-300 leading-none">
                chevron_right
              </span>
            </button>
          </Tooltip>
        )}
        {onOpenCanvasWindow && (
          <Tooltip text="Open Canvas Window">
            <button
              onClick={onOpenCanvasWindow}
              data-gamepad-skip="external"
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition flex items-center justify-center"
            >
              <span className="material-icons text-gray-700 dark:text-gray-300 leading-none">
                open_in_new
              </span>
            </button>
          </Tooltip>
        )}
        {onOpenViewer && (
          <Tooltip text="Open Browser Viewer">
            <button
              onClick={onOpenViewer}
              data-gamepad-skip="external"
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition flex items-center justify-center"
            >
              <span className="material-icons text-gray-700 dark:text-gray-300 leading-none">
                open_in_new
              </span>
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
