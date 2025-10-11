/**
 * SongInfoBar - Displays current song info at the top
 *
 * Shows song title, artist, format icon, and optional hamburger menu
 * Works with both ElectronBridge and WebBridge
 */

import { getFormatIcon } from '../formatUtils.js';
import { ThemeToggle } from './ThemeToggle.jsx';

export function SongInfoBar({
  currentSong,
  onMenuClick,
  sidebarCollapsed = false,
  className = '',
}) {
  const formatIcon = currentSong?.format ? getFormatIcon(currentSong.format) : '';

  // Check for loading state
  const songDisplay = currentSong?.isLoading
    ? '⏳ Loading...'
    : currentSong
      ? `${currentSong.title || 'Unknown'} - ${currentSong.artist || 'Unknown Artist'}`
      : 'No song loaded';

  return (
    <div
      className={`bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between ${className}`}
    >
      <div className="flex items-center">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
          >
            <span className="material-icons text-gray-700 dark:text-gray-300">
              {sidebarCollapsed ? 'menu_open' : 'menu'}
            </span>
          </button>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
          {formatIcon && <span className="text-xl">{formatIcon}</span>}
          <span className="font-medium truncate max-w-2xl">{songDisplay}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
      </div>
    </div>
  );
}
