/**
 * QuickSearch - Shared quick search component
 * Used by both renderer and web admin for quick library search above queue
 */

import React, { useState, useEffect, useRef } from 'react';
import { getFormatIcon } from '../formatUtils.js';

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
      addedVia: requester === 'Web Admin' ? 'web' : 'ui',
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
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target)
      ) {
        setShowSearchDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative p-2">
      <input
        ref={searchInputRef}
        type="text"
        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        placeholder="Quick search library..."
        value={searchTerm}
        onChange={(e) => handleQuickSearch(e.target.value)}
        onFocus={() => searchTerm && setShowSearchDropdown(true)}
      />

      {showSearchDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-2 right-2 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-80 overflow-y-auto z-50"
        >
          {searchResults.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              {searchTerm ? 'No matches found' : 'Type to search your library'}
            </div>
          ) : (
            searchResults.map((song) => (
              <div
                key={song.path}
                className="flex items-center justify-between gap-3 p-3 hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700 last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100 font-medium truncate">
                    <span className="text-lg">{getFormatIcon(song.format)}</span>
                    {song.title}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 truncate">
                    {song.artist}
                  </div>
                </div>
                <button
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition flex-shrink-0"
                  onClick={() => handleAddFromSearch(song)}
                  title="Add to Queue"
                >
                  <span className="material-icons text-gray-700 dark:text-gray-300">
                    playlist_add
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
