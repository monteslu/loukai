/**
 * QueueTab - Queue management tab for renderer
 *
 * Combines:
 * - QueueList (shared queue display)
 * - Quick search functionality (renderer-only)
 */

import React, { useState, useEffect, useRef } from 'react';
import { QueueList } from '../../shared/components/QueueList.jsx';
import { getFormatIcon } from '../../shared/formatUtils.js';
import './QueueTab.css';

export function QueueTab({ bridge }) {
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [searchResults, setSearchResults] = useState([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Subscribe to queue updates
  useEffect(() => {
    if (!bridge) return;

    const unsubscribe = bridge.onQueueChanged?.((queueData) => {
      setQueue(queueData.queue || []);
      // Update current index if current song changed
      if (queueData.currentSong && queueData.currentSong.queueItemId) {
        const queue = queueData.queue || [];
        const index = queue.findIndex(item => item.id === queueData.currentSong.queueItemId);
        setCurrentIndex(index);
      } else {
        setCurrentIndex(-1);
      }
    });

    // Fetch initial state
    bridge.getQueue?.()
      .then(data => {
        setQueue(data.queue || []);
        if (data.currentSong && data.currentSong.queueItemId) {
          const queue = data.queue || [];
          const index = queue.findIndex(item => item.id === data.currentSong.queueItemId);
          setCurrentIndex(index);
        } else {
          setCurrentIndex(-1);
        }
      })
      .catch(console.error);

    return () => unsubscribe && unsubscribe();
  }, [bridge]);

  // Listen for current song changes to update currentIndex
  useEffect(() => {
    if (!bridge) return;

    const unsubscribe = bridge.onCurrentSongChanged?.((song) => {
      if (song && song.queueItemId) {
        console.log('🎵 Matching by queueItemId:', song.queueItemId, 'in queue:', queue.map(q => q.id));
        const index = queue.findIndex(item => item.id === song.queueItemId);
        console.log('  → Found at index:', index);
        setCurrentIndex(index);
      } else {
        console.log('🎵 No queueItemId, setting currentIndex to -1');
        setCurrentIndex(-1);
      }
    });

    return () => unsubscribe && unsubscribe();
  }, [bridge, queue]);

  // Handle quick search
  const handleQuickSearch = async (value) => {
    setSearchTerm(value);

    if (!value.trim()) {
      setShowSearchDropdown(false);
      setSearchResults([]);
      return;
    }

    try {
      const result = await bridge.searchSongs(value);

      if (!result.success || !result.songs) {
        setSearchResults([]);
        setShowSearchDropdown(true);
        return;
      }

      setSearchResults(result.songs.slice(0, 8)); // Limit to 8 results
      setShowSearchDropdown(true);
    } catch (error) {
      console.error('Quick search error:', error);
      setSearchResults([]);
      setShowSearchDropdown(true);
    }
  };

  // Add song to queue from search
  const handleAddFromSearch = async (song) => {
    const queueItem = {
      path: song.path,
      title: song.title || song.name.replace('.kai', ''),
      artist: song.artist || 'Unknown Artist',
      duration: song.duration,
      requester: 'KJ',
      addedVia: 'ui'
    };

    await bridge.addToQueue(queueItem);

    // Clear search
    setSearchTerm('');
    setShowSearchDropdown(false);
    setSearchResults([]);
  };

  // Queue operations
  const handlePlayFromQueue = async (songId) => {
    // Pass the ID to the bridge (it will handle queue lookup)
    await bridge.playFromQueue(songId);
  };

  const handleRemoveFromQueue = async (songId) => {
    await bridge.removeFromQueue(songId);
  };

  const handleClearQueue = async () => {
    if (queue.length > 0 && confirm('Are you sure you want to clear the queue?')) {
      await bridge.clearQueue();
    }
  };

  const handleShuffleQueue = async () => {
    // TODO: Add shuffle to bridge
    console.warn('Shuffle not implemented in bridge yet');
  };

  const handleReorderQueue = async (songId, newIndex) => {
    await bridge.reorderQueue(songId, newIndex);
  };

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target)) {
        setShowSearchDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="queue-tab-container">
      {/* Quick search section */}
      <div className="quick-search-section">
        <input
          ref={searchInputRef}
          type="text"
          className="quick-search-input"
          placeholder="Quick search library..."
          value={searchTerm}
          onChange={(e) => handleQuickSearch(e.target.value)}
          onFocus={() => searchTerm && setShowSearchDropdown(true)}
        />

        {showSearchDropdown && (
          <div ref={dropdownRef} className="quick-search-dropdown">
            {searchResults.length === 0 ? (
              <div className="no-search-message">
                {searchTerm ? 'No matches found' : 'Type to search your library'}
              </div>
            ) : (
              searchResults.map(song => (
                <div key={song.path} className="quick-search-item">
                  <div className="quick-search-info">
                    <div className="quick-search-title">
                      <span className="format-icon">{getFormatIcon(song.format)}</span>
                      {song.title}
                    </div>
                    <div className="quick-search-artist">{song.artist}</div>
                  </div>
                  <button
                    className="quick-search-add-btn"
                    onClick={() => handleAddFromSearch(song)}
                    title="Add to Queue"
                  >
                    <span className="material-icons">playlist_add</span>
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Queue list */}
      <QueueList
        queue={queue}
        currentIndex={currentIndex}
        onPlayFromQueue={handlePlayFromQueue}
        onRemoveFromQueue={handleRemoveFromQueue}
        onClearQueue={handleClearQueue}
        onShuffleQueue={handleShuffleQueue}
        onReorderQueue={handleReorderQueue}
      />
    </div>
  );
}
