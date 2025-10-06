import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getFormatIcon, formatDuration } from '../../shared/formatUtils.js';
import { Toast } from '../../shared/components/Toast.jsx';
import './SongRequestPage.css';

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
      .then(res => res.json())
      .then(info => {
        setServerName(info.serverName || 'Loukai Karaoke');
        setAllowRequests(info.allowRequests !== false);
        document.title = `${info.serverName || 'Karaoke'} - Song Requests`;
      })
      .catch(err => console.error('Failed to load server info:', err));
  }, [userName]);

  // Load available letters when user is set
  useEffect(() => {
    if (!userName) return;

    fetch('/api/letters')
      .then(res => res.json())
      .then(data => {
        const letters = data.letters || [];
        setAvailableLetters(letters);
        const firstLetter = letters.includes('A') ? 'A' : letters[0];
        if (firstLetter) {
          loadLetterPage(firstLetter, 1);
        }
      })
      .catch(err => console.error('Failed to load letters:', err));
  }, [userName]);

  // Load queue periodically
  useEffect(() => {
    if (!userName) return;

    const loadQueue = () => {
      fetch('/api/queue')
        .then(res => res.json())
        .then(data => setQueue(data.queue || []))
        .catch(err => console.error('Failed to load queue:', err));
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
      const res = await fetch(`/api/songs/letter/${encodeURIComponent(letter)}?page=${page}&limit=50`);
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
          message: requestMessage
        })
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
      <div className="name-prompt-overlay">
        <div className="name-prompt-modal">
          <div className="name-prompt-title">Welcome to Karaoke!</div>
          <div className="name-prompt-subtitle">Please enter your name to request songs</div>
          <input
            type="text"
            className="name-input"
            placeholder="Your name..."
            maxLength={50}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && nameInput.trim() && handleNameSubmit()}
            autoFocus
          />
          <button
            className="name-submit-btn"
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
    <div className="song-request-page">
      <div className="header">
        <h1>{serverName}</h1>
        <div className="subtitle">Request your favorite songs!</div>
      </div>

      <div className="container">
        {/* Quick Search */}
        <div className="quick-search-section" ref={quickSearchRef}>
          <div className="quick-search-title">
            <span className="material-icons">search</span>
            <span>Quick Song Search</span>
          </div>
          <input
            type="text"
            className="quick-search-input"
            placeholder="Search songs to request..."
            value={quickSearchTerm}
            onChange={(e) => setQuickSearchTerm(e.target.value)}
            onFocus={() => quickSearchTerm && setShowQuickSearch(true)}
          />
          {showQuickSearch && (
            <div className="quick-search-dropdown">
              {quickSearchResults.length === 0 ? (
                <div className="no-search-message">No songs found</div>
              ) : (
                quickSearchResults.slice(0, 8).map(song => (
                  <div
                    key={song.path}
                    className="quick-search-item"
                    onClick={() => {
                      handleRequestSong(song);
                      setShowQuickSearch(false);
                      setQuickSearchTerm('');
                    }}
                  >
                    <div className="quick-search-info">
                      <div className="quick-search-header">
                        <div className="quick-search-title">
                          <span className="format-icon">{getFormatIcon(song.format)}</span>
                          {song.title}
                        </div>
                        <div className="quick-search-artist">{song.artist}</div>
                      </div>
                      {(song.album || song.year || song.genre) && (
                        <div className="quick-search-metadata">
                          {song.album && <span>{song.album}</span>}
                          {song.year && <span>{song.year}</span>}
                          {song.genre && <span>{song.genre}</span>}
                        </div>
                      )}
                    </div>
                    <span className="song-duration">{formatDuration(song.duration)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Songs Section */}
        <div className="songs-section">
          <div className="section-header">
            <div className="section-title">Available Songs</div>
            <div className="songs-count">{songs.length} songs</div>
          </div>

          {/* Alphabet Navigation */}
          <div className="alphabet-nav">
            <div className="alphabet-title">Browse by Artist:</div>
            <div className="alphabet-buttons">
              {allLetters.map(letter => {
                const hasContent = availableLetters.includes(letter);
                return (
                  <button
                    key={letter}
                    className={`alphabet-btn ${currentLetter === letter ? 'active' : ''} ${!hasContent ? 'disabled' : ''}`}
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
          <div className="songs-list">
            {songs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon material-icons">library_music</div>
                <div>No songs found</div>
              </div>
            ) : (
              songs.map(song => (
                <div
                  key={song.path}
                  className="song-item"
                >
                  <div className="song-info">
                    <div className="song-header">
                      <div className="song-title">
                        {getFormatIcon(song.format)} {song.title}
                      </div>
                      <div className="song-artist">{song.artist}</div>
                    </div>
                    {(song.album || song.year || song.genre) && (
                      <div className="song-metadata">
                        {song.album && <span>{song.album}</span>}
                        {song.year && <span>{song.year}</span>}
                        {song.genre && <span>{song.genre}</span>}
                      </div>
                    )}
                  </div>
                  <div className="song-actions">
                    <span className="song-duration">{formatDuration(song.duration)}</span>
                    <button
                      className="request-btn"
                      disabled={!allowRequests}
                      onClick={() => handleRequestSong(song)}
                    >
                      <span className="material-icons" style={{ fontSize: 18 }}>add</span>
                      Request
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Page Navigation */}
          {totalPages > 1 && (
            <div className="page-nav">
              <button
                className="page-nav-btn"
                onClick={() => loadLetterPage(currentLetter, currentPage - 1)}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <div className="page-numbers">
                {getPageNumbers().map((page, index) => {
                  if (page === '...') {
                    return (
                      <span key={`ellipsis-${index}`} className="page-ellipsis">
                        ...
                      </span>
                    );
                  }
                  return (
                    <button
                      key={page}
                      className={`page-number ${page === currentPage ? 'active' : ''}`}
                      onClick={() => loadLetterPage(currentLetter, page)}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>
              <span className="page-info">({songs.length} songs)</span>
              <button
                className="page-nav-btn"
                onClick={() => loadLetterPage(currentLetter, currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Queue Section */}
        <div className="queue-section">
          <div className="queue-title">
            <span className="material-icons">queue_music</span>
            Queue ({queue.length})
          </div>
          <ul className="queue-list">
            {queue.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon material-icons">queue_music</div>
                <div>Queue is empty</div>
              </div>
            ) : (
              queue.map((item, index) => (
                <li key={item.id} className="queue-item">
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="queue-number">{index + 1}</div>
                    <div className="queue-info">
                      <div className="queue-title">{item.title}</div>
                      <div className="queue-artist">
                        {item.artist} • Singer: {item.requester}
                      </div>
                    </div>
                  </div>
                  <span className="queue-duration">{formatDuration(item.duration)}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {/* Request Modal */}
      {showRequestModal && selectedSong && (
        <div className="modal active" onClick={() => setShowRequestModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Request Song</div>
              <div className="modal-song-info">
                {selectedSong.title} - {selectedSong.artist}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Your Name</label>
              <div className="requester-display">{userName}</div>
            </div>

            <div className="form-group">
              <label className="form-label">Message (optional)</label>
              <textarea
                className="form-input form-textarea"
                placeholder="Any special requests or notes..."
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="modal-buttons">
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
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
