/**
 * QuickSearch - Shared quick search component
 * Used by both renderer and web admin for quick library search above queue
 */

import React, { useState, useEffect, useRef } from 'react';
import { getFormatIcon } from '../formatUtils.js';
import './QuickSearch.css';

export function QuickSearch({ bridge, requester = 'KJ' }) {
  const [searchResults, setSearchResults] = useState([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef(null);
  const dropdownRef = useRef(null);

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
      const songs = result.songs || [];
      setSearchResults(songs.slice(0, 8)); // Limit to 8 results
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
      requester: requester,
      addedVia: requester === 'Web Admin' ? 'web' : 'ui'
    };

    await bridge.addToQueue(queueItem);

    // Clear search
    setSearchTerm('');
    setShowSearchDropdown(false);
    setSearchResults([]);
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
  );
}
