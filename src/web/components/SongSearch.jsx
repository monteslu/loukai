import { useState, useEffect, useRef } from 'react';
import { getFormatIcon, formatDuration } from '../../shared/formatUtils.js';

export function SongSearch({ onAddToQueue }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (searchTerm.trim().length >= 2) {
        setLoading(true);
        try {
          const response = await fetch(
            `/api/songs?search=${encodeURIComponent(searchTerm)}&limit=20`,
            { credentials: 'include' }
          );
          const data = await response.json();
          setResults(data.songs || []);
          setShowDropdown(true);
        } catch (error) {
          console.error('Search failed:', error);
          setResults([]);
        } finally {
          setLoading(false);
        }
      } else {
        setResults([]);
        setShowDropdown(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  const handleLoadSong = async (song) => {
    try {
      const response = await fetch('/admin/player/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ path: song.path }),
      });

      if (response.ok) {
        setSearchTerm('');
        setShowDropdown(false);
      }
    } catch (error) {
      console.error('Load song failed:', error);
    }
  };

  const handleAddToQueue = async (song) => {
    try {
      const response = await fetch('/admin/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          song: {
            path: song.path,
            title: song.title,
            artist: song.artist,
            duration: song.duration,
          },
          requester: 'Admin',
        }),
      });

      if (response.ok) {
        if (onAddToQueue) onAddToQueue(song);
        setSearchTerm('');
        setShowDropdown(false);
      }
    } catch (error) {
      console.error('Add to queue failed:', error);
    }
  };

  return (
    <div className="relative w-full" ref={searchRef}>
      <input
        type="text"
        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-900 dark:text-white text-base transition-colors focus:outline-none focus:border-blue-600 dark:focus:border-blue-500"
        placeholder="Search songs to queue..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => {
          if (results.length > 0) setShowDropdown(true);
        }}
      />

      {showDropdown && (
        <div
          className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md max-h-[400px] overflow-y-auto shadow-lg z-[1000]"
          ref={dropdownRef}
        >
          {loading ? (
            <div className="p-4 text-center text-gray-600 dark:text-gray-400 text-sm">
              Searching...
            </div>
          ) : results.length > 0 ? (
            <div className="flex flex-col">
              {results.map((song, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white whitespace-nowrap overflow-hidden text-ellipsis mb-0.5">
                      <span className="text-xs mr-2">{getFormatIcon(song.format)}</span>{' '}
                      {song.title}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                        {song.artist}
                      </span>
                      {song.duration && (
                        <>
                          <span className="text-gray-300 dark:text-gray-600">•</span>
                          <span className="flex-shrink-0">{formatDuration(song.duration)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      className="btn btn-sm min-w-[32px] px-2 py-1 text-base font-semibold bg-blue-600 dark:bg-blue-500 border-blue-600 dark:border-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600"
                      onClick={() => handleLoadSong(song)}
                      title="Load & Play Now"
                    >
                      ▶
                    </button>
                    <button
                      className="btn btn-sm min-w-[32px] px-2 py-1 text-base font-semibold bg-green-600 dark:bg-green-500 border-green-600 dark:border-green-500 text-white hover:bg-green-700 dark:hover:bg-green-600"
                      onClick={() => handleAddToQueue(song)}
                      title="Add to Queue"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : searchTerm.trim().length >= 2 ? (
            <div className="p-4 text-center text-gray-600 dark:text-gray-400 text-sm">
              No songs found
            </div>
          ) : (
            <div className="p-4 text-center text-gray-600 dark:text-gray-400 text-sm">
              Type to search your library
            </div>
          )}
        </div>
      )}
    </div>
  );
}
