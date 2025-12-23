import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getFormatIcon, formatDuration } from '../../shared/formatUtils.js';
import { Toast } from '../../shared/components/Toast.jsx';
import { ThemeToggle } from '../../shared/components/ThemeToggle.jsx';

export function SongRequestPage() {
  const [userName, setUserName] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [serverName, setServerName] = useState('Loukai Karaoke');
  const [allowRequests, setAllowRequests] = useState(true);
  const [songs, setSongs] = useState([]);
  const [availableLetters, setAvailableLetters] = useState([]);
  const [currentLetter, setCurrentLetter] = useState('A');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [queue, setQueue] = useState([]);
  const [quickSearchTerm, setQuickSearchTerm] = useState('');
  const [quickSearchResults, setQuickSearchResults] = useState([]);
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [toast, setToast] = useState(null);

  const socketRef = useRef(null);
  const quickSearchRef = useRef(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  // Load user name from localStorage on mount
  useEffect(() => {
    const storedName = localStorage.getItem('karaoke-user-name');
    if (storedName && storedName.trim()) {
      setUserName(storedName.trim());
    }
  }, []);

  // Initialize socket connection
  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('queue-update', (data) => {
      setQueue(data.queue || []);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // Load server info when user is set
  useEffect(() => {
    if (!userName) return;

    fetch('/api/info')
      .then((res) => res.json())
      .then((info) => {
        setServerName(info.serverName || 'Loukai Karaoke');
        setAllowRequests(info.allowRequests !== false);
        document.title = `${info.serverName || 'Karaoke'} - Song Requests`;
      })
      .catch((err) => console.error('Failed to load server info:', err));
  }, [userName]);

  // Load available letters when user is set
  useEffect(() => {
    if (!userName) return;

    fetch('/api/letters')
      .then((res) => res.json())
      .then((data) => {
        const letters = data.letters || [];
        setAvailableLetters(letters);
        const firstLetter = letters.includes('A') ? 'A' : letters[0];
        if (firstLetter) {
          loadLetterPage(firstLetter, 1);
        }
      })
      .catch((err) => console.error('Failed to load letters:', err));
  }, [userName]);

  // Load queue periodically
  useEffect(() => {
    if (!userName) return;

    const loadQueue = () => {
      fetch('/api/queue')
        .then((res) => res.json())
        .then((data) => setQueue(data.queue || []))
        .catch((err) => console.error('Failed to load queue:', err));
    };

    loadQueue();
    const interval = setInterval(loadQueue, 10000);
    return () => clearInterval(interval);
  }, [userName]);

  // Quick search handler
  useEffect(() => {
    if (!quickSearchTerm.trim()) {
      setQuickSearchResults([]);
      setShowQuickSearch(false);
      return;
    }

    const search = async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(quickSearchTerm)}`);
        const data = await res.json();
        setQuickSearchResults(data.results || []);
        setShowQuickSearch(true);
      } catch (err) {
        console.error('Search failed:', err);
        setQuickSearchResults([]);
      }
    };

    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [quickSearchTerm]);

  // Click outside to close quick search
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (quickSearchRef.current && !quickSearchRef.current.contains(e.target)) {
        setShowQuickSearch(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadLetterPage = async (letter, page) => {
    try {
      const res = await fetch(
        `/api/songs/letter/${encodeURIComponent(letter)}?page=${page}&limit=50`
      );
      const data = await res.json();

      setSongs(data.songs || []);
      setCurrentLetter(letter);
      setCurrentPage(page);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (err) {
      console.error('Failed to load songs:', err);
      setSongs([]);
    }
  };

  const handleNameSubmit = () => {
    const name = nameInput.trim();
    if (name) {
      setUserName(name);
      localStorage.setItem('karaoke-user-name', name);
    }
  };

  const handleRequestSong = (song) => {
    if (!allowRequests) return;
    setSelectedSong(song);
    setRequestMessage('');
    setShowRequestModal(true);
  };

  const submitRequest = async () => {
    if (!selectedSong) return;

    try {
      const res = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId: selectedSong.path,
          requesterName: userName,
          message: requestMessage,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setShowRequestModal(false);
        setSelectedSong(null);
        setRequestMessage('');
        showToast(data.message || 'Request submitted!', 'success');
      } else {
        const error = await res.json();
        showToast(error.error || 'Request failed', 'error');
      }
    } catch (err) {
      console.error('Request failed:', err);
      showToast('Failed to submit request', 'error');
    }
  };

  // Smart pagination - show limited page numbers around current page
  const getPageNumbers = () => {
    const maxButtons = 7; // Show max 7 page buttons
    if (totalPages <= maxButtons) {
      // Show all pages if total is small
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages = [];
    const halfRange = Math.floor((maxButtons - 3) / 2); // Reserve 3 for first, last, and ellipsis

    // Always show first page
    pages.push(1);

    let startPage = Math.max(2, currentPage - halfRange);
    let endPage = Math.min(totalPages - 1, currentPage + halfRange);

    // Adjust if we're near the beginning
    if (currentPage <= halfRange + 2) {
      endPage = Math.min(maxButtons - 1, totalPages - 1);
    }

    // Adjust if we're near the end
    if (currentPage >= totalPages - halfRange - 1) {
      startPage = Math.max(2, totalPages - maxButtons + 2);
    }

    // Add ellipsis if needed before
    if (startPage > 2) {
      pages.push('...');
    }

    // Add middle pages
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    // Add ellipsis if needed after
    if (endPage < totalPages - 1) {
      pages.push('...');
    }

    // Always show last page
    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  };

  const allLetters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#'];

  // Name prompt modal
  if (!userName) {
    return (
      <div className="fixed top-0 left-0 w-full h-full bg-black/90 flex items-center justify-center z-[1000]">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 max-w-md w-[90%] text-center border border-gray-300 dark:border-gray-600">
          <div className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">
            Loukai Karaoke
          </div>
          <div className="text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
            Please enter your name to request songs
          </div>
          <input
            type="text"
            className="w-full px-3 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white text-base mb-6 focus:outline-none focus:border-blue-600 dark:focus:border-blue-500"
            placeholder="Your name..."
            maxLength={50}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && nameInput.trim() && handleNameSubmit()}
            autoFocus
          />
          <button
            className="bg-blue-600 text-white border-none px-6 py-3 rounded-lg text-base cursor-pointer w-full hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            disabled={!nameInput.trim()}
            onClick={handleNameSubmit}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // Main content
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <div className="bg-white dark:bg-gray-800 py-8 px-8 text-center border-b-2 border-blue-600 dark:border-blue-500 relative">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <h1 className="m-0 mb-2 text-4xl text-gray-900 dark:text-white">{serverName}</h1>
        <div className="text-gray-600 dark:text-gray-400 text-lg">Request your favorite songs!</div>
      </div>

      <div className="max-w-6xl mx-auto p-5">
        {/* Quick Search */}
        <div
          className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-5 border border-gray-200 dark:border-gray-700 relative"
          ref={quickSearchRef}
        >
          <div className="text-base mb-2 flex items-center gap-2 text-gray-900 dark:text-white">
            <span className="material-icons">search</span>
            <span>Quick Song Search</span>
          </div>
          <input
            type="text"
            className="w-full px-3 py-3 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-gray-900 dark:text-white text-base focus:outline-none focus:border-blue-600 dark:focus:border-blue-500 focus:bg-white dark:focus:bg-gray-600"
            placeholder="Search songs to request..."
            value={quickSearchTerm}
            onChange={(e) => setQuickSearchTerm(e.target.value)}
            onFocus={() => quickSearchTerm && setShowQuickSearch(true)}
          />
          {showQuickSearch && (
            <div className="absolute top-full left-4 right-4 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 border-t-0 rounded-b-md max-h-[300px] overflow-y-auto z-[1000] -mt-px">
              {quickSearchResults.length === 0 ? (
                <div className="p-5 text-center text-gray-500 dark:text-gray-400">
                  No songs found
                </div>
              ) : (
                quickSearchResults.slice(0, 8).map((song) => (
                  <div
                    key={song.path}
                    className="p-3.5 cursor-pointer border-b border-gray-200 dark:border-gray-600 flex justify-between items-start gap-3 transition-colors hover:bg-gray-200 dark:hover:bg-gray-600 last:border-b-0"
                    onClick={() => {
                      handleRequestSong(song);
                      setShowQuickSearch(false);
                      setQuickSearchTerm('');
                    }}
                  >
                    <div className="flex-1 flex flex-col items-start">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <div className="font-semibold text-[0.95rem] inline-flex items-center gap-2 text-gray-900 dark:text-white">
                          <span className="text-xs">{getFormatIcon(song.format)}</span>
                          {song.title}
                        </div>
                        <div className="text-[0.9rem] text-gray-600 dark:text-gray-400">
                          {song.artist}
                        </div>
                      </div>
                      {(song.album || song.year || song.genre) && (
                        <div className="text-[0.82rem] text-gray-500 dark:text-gray-500 mt-1">
                          {song.album && <span>{song.album}</span>}
                          {song.year && (
                            <span className="before:content-['_•_'] before:text-gray-400 dark:before:text-gray-600">
                              {song.year}
                            </span>
                          )}
                          {song.genre && (
                            <span className="before:content-['_•_'] before:text-gray-400 dark:before:text-gray-600">
                              {song.genre}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-gray-500 dark:text-gray-400 text-[0.9rem] font-medium">
                      {formatDuration(song.duration)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Songs Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 mb-5 border border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <div className="text-xl font-semibold text-gray-900 dark:text-white">
              Available Songs
            </div>
            <div className="text-gray-500 dark:text-gray-400 text-sm">{songs.length} songs</div>
          </div>

          {/* Alphabet Navigation */}
          <div className="mb-4">
            <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">Browse by Artist:</div>
            <div className="flex flex-wrap gap-1.5">
              {allLetters.map((letter) => {
                const hasContent = availableLetters.includes(letter);
                return (
                  <button
                    key={letter}
                    className={`px-3 py-2 rounded border transition-all text-sm min-w-[40px] ${
                      currentLetter === letter
                        ? 'bg-blue-600 dark:bg-blue-500 border-blue-600 dark:border-blue-500 text-white'
                        : hasContent
                          ? 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600 hover:border-blue-600 dark:hover:border-blue-500'
                          : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white opacity-30 cursor-not-allowed'
                    }`}
                    disabled={!hasContent}
                    onClick={() => loadLetterPage(letter, 1)}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Songs List */}
          <div className="max-h-[500px] overflow-y-auto">
            {songs.length === 0 ? (
              <div className="text-center py-16 px-5 text-gray-500 dark:text-gray-500">
                <div className="material-icons text-6xl mb-5 opacity-30">library_music</div>
                <div>No songs found</div>
              </div>
            ) : (
              songs.map((song) => (
                <div
                  key={song.path}
                  className="flex justify-between items-start p-4 bg-gray-100 dark:bg-gray-700 rounded-md mb-2 transition-colors gap-4"
                >
                  <div className="flex-1 flex flex-col items-start">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <div className="font-semibold text-base text-gray-900 dark:text-white inline-flex items-center gap-2">
                        {getFormatIcon(song.format)} {song.title}
                      </div>
                      <div className="text-[0.95rem] text-gray-600 dark:text-gray-400">
                        {song.artist}
                      </div>
                    </div>
                    {(song.album || song.year || song.genre) && (
                      <div className="text-[0.85rem] text-gray-500 dark:text-gray-500 mt-1">
                        {song.album && <span>{song.album}</span>}
                        {song.year && (
                          <span className="before:content-['_•_'] before:text-gray-400 dark:before:text-gray-600">
                            {song.year}
                          </span>
                        )}
                        {song.genre && (
                          <span className="before:content-['_•_'] before:text-gray-400 dark:before:text-gray-600">
                            {song.genre}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-4 flex-shrink-0 pt-0.5">
                    <span className="text-gray-500 dark:text-gray-400 text-sm font-medium min-w-[45px] text-right">
                      {formatDuration(song.duration)}
                    </span>
                    <button
                      className="px-5 py-2.5 bg-blue-600 dark:bg-blue-500 border-none rounded-md text-white cursor-pointer flex items-center gap-1.5 font-medium text-[0.95rem] transition-all whitespace-nowrap hover:bg-blue-700 dark:hover:bg-blue-600 hover:-translate-y-px disabled:bg-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!allowRequests}
                      onClick={() => handleRequestSong(song)}
                    >
                      <span className="material-icons" style={{ fontSize: 18 }}>
                        add
                      </span>
                      Request
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Page Navigation */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-md flex-wrap">
              <button
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white cursor-pointer text-sm transition-colors hover:bg-gray-200 dark:hover:bg-gray-600 hover:border-blue-600 dark:hover:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => loadLetterPage(currentLetter, currentPage - 1)}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <div className="flex gap-1 items-center">
                {getPageNumbers().map((page, index) => {
                  if (page === '...') {
                    return (
                      <span
                        key={`ellipsis-${index}`}
                        className="px-2 text-gray-500 dark:text-gray-400 text-sm"
                      >
                        ...
                      </span>
                    );
                  }
                  return (
                    <button
                      key={page}
                      className={`px-3 py-2 border rounded cursor-pointer text-sm min-w-[40px] transition-all ${
                        page === currentPage
                          ? 'bg-blue-600 dark:bg-blue-500 border-blue-600 dark:border-blue-500 font-semibold text-white'
                          : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-600 hover:border-blue-600 dark:hover:border-blue-500'
                      }`}
                      onClick={() => loadLetterPage(currentLetter, page)}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>
              <span className="text-gray-500 dark:text-gray-400 text-[0.85rem] ml-2">
                ({songs.length} songs)
              </span>
              <button
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white cursor-pointer text-sm transition-colors hover:bg-gray-200 dark:hover:bg-gray-600 hover:border-blue-600 dark:hover:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => loadLetterPage(currentLetter, currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Queue Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700">
          <div className="text-xl font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
            <span className="material-icons">queue_music</span>
            Queue ({queue.length})
          </div>
          <ul className="list-none p-0 m-0">
            {queue.length === 0 ? (
              <div className="text-center py-16 px-5 text-gray-500 dark:text-gray-500">
                <div className="material-icons text-6xl mb-5 opacity-30">queue_music</div>
                <div>Queue is empty</div>
              </div>
            ) : (
              queue.map((item, index) => (
                <li
                  key={item.id}
                  className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-md mb-2"
                >
                  <div className="flex items-center">
                    <div className="w-8 h-8 flex items-center justify-center bg-blue-600 dark:bg-blue-500 rounded-full font-semibold mr-3 text-white">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium mb-1 text-gray-900 dark:text-white">
                        {item.title}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {item.artist} • Singer: {item.requester}
                      </div>
                    </div>
                  </div>
                  <span className="text-gray-500 dark:text-gray-400 text-sm">
                    {formatDuration(item.duration)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Footer */}
        <footer className="mt-8 py-6 text-center">
          <a
            href="https://loukai.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-sm"
          >
            <img src="/static/loukai-logo.png" alt="Loukai" className="w-6 h-6 rounded" />
            <span>Powered by Loukai</span>
          </a>
        </footer>
      </div>

      {/* Request Modal */}
      {showRequestModal && selectedSong && (
        <div
          className="fixed top-0 left-0 w-full h-full bg-black/80 z-[1000] flex items-center justify-center"
          onClick={() => setShowRequestModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg p-8 max-w-lg w-[90%] border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5">
              <div className="text-2xl mb-2 text-gray-900 dark:text-white">Request Song</div>
              <div className="text-gray-900 dark:text-white text-xl font-bold mb-2 p-2.5 bg-gray-100 dark:bg-gray-700 rounded-md border-l-4 border-blue-600 dark:border-blue-500">
                {selectedSong.title} - {selectedSong.artist}
              </div>
            </div>

            <div className="mb-5">
              <label className="block mb-2 text-gray-600 dark:text-gray-300 text-sm">
                Your Name
              </label>
              <div className="px-3 py-2 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white font-medium">
                {userName}
              </div>
            </div>

            <div className="mb-5">
              <label className="block mb-2 text-gray-600 dark:text-gray-300 text-sm">
                Message (optional)
              </label>
              <textarea
                className="w-full px-2.5 py-2.5 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white text-base resize-y min-h-[80px] focus:outline-none focus:border-blue-600 dark:focus:border-blue-500"
                placeholder="Any special requests or notes..."
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="flex gap-2.5 justify-end">
              <button className="btn btn-secondary" onClick={() => setShowRequestModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitRequest}>
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
