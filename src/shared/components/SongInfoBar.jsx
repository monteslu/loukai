/**
 * SongInfoBar - Displays current song info at the top
 *
 * Shows song title, artist, format icon, and optional hamburger menu
 * Works with both ElectronBridge and WebBridge
 */

import { getFormatIcon } from '../formatUtils.js';
import './SongInfoBar.css';

export function SongInfoBar({
  currentSong,
  onMenuClick,
  sidebarCollapsed = false,
  className = ''
}) {
  const formatIcon = currentSong?.format ? getFormatIcon(currentSong.format) : '';

  // Check for loading state
  const songDisplay = currentSong?.isLoading
    ? '⏳ Loading...'
    : currentSong
    ? `${currentSong.title || 'Unknown'} - ${currentSong.artist || 'Unknown Artist'}`
    : 'No song loaded';

  return (
    <div className={`song-info-bar ${className}`}>
      <div className="song-info-left">
        {onMenuClick && (
          <button onClick={onMenuClick} className="hamburger-btn-info">
            <span className="material-icons">
              {sidebarCollapsed ? 'menu_open' : 'menu'}
            </span>
          </button>
        )}
      </div>
      <div className="song-info-center">
        <div className="song-info">
          {formatIcon && <span className="format-icon">{formatIcon}</span>}
          <span className="song-display">{songDisplay}</span>
        </div>
      </div>
      <div className="song-info-right">
        {/* Reserved for future use (e.g., notifications) */}
      </div>
    </div>
  );
}
