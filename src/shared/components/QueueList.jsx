/**
 * QueueList - Unified queue display component
 *
 * Based on renderer's player-queue-sidebar design
 * Works with both ElectronBridge and WebBridge via callbacks
 */

import { useState } from 'react';
import { getFormatIcon, formatDuration } from '../formatUtils.js';
import './QueueList.css';

export function QueueList({
  queue = [],
  currentIndex = -1,
  currentSongId = null,     // Support web's currentSongId prop
  onPlayFromQueue,
  onRemoveFromQueue,
  onLoad,                   // Alias for web compatibility
  onRemove,                 // Alias for web compatibility
  onClearQueue,
  onClear,                  // Alias for web compatibility
  onShuffleQueue,
  onReorderQueue,           // New: drag and drop reordering
  onQuickSearch,
  className = ''
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Support both prop names
  const handlePlay = onPlayFromQueue || onLoad;
  const handleRemove = onRemoveFromQueue || onRemove;
  const handleClear = onClearQueue || onClear;

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    if (!onReorderQueue) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget);
  };

  const handleDragOver = (e, index) => {
    if (!onReorderQueue || draggedIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e, dropIndex) => {
    if (!onReorderQueue || draggedIndex === null) return;
    e.preventDefault();

    if (draggedIndex !== dropIndex) {
      const item = queue[draggedIndex];
      onReorderQueue(item.id, dropIndex);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  if (queue.length === 0) {
    return (
      <div className={`player-queue-section ${className}`}>
        {onQuickSearch && (
          <div className="quick-search-controls">
            <input
              type="text"
              id="quickLibrarySearch"
              placeholder="Search..."
              onInput={(e) => onQuickSearch(e.target.value)}
            />
            <div className="quick-search-dropdown" id="quickSearchResults" style={{display: 'none'}}>
              <div className="no-search-message">Type to search your library</div>
            </div>
          </div>
        )}

        <div className="player-queue-header">
          <h4>Queue</h4>
          <div className="queue-actions">
            {handleClear && (
              <button onClick={handleClear} className="queue-action-btn" title="Clear Queue">
                <span className="material-icons">delete</span>
              </button>
            )}
            {onShuffleQueue && (
              <button onClick={onShuffleQueue} className="queue-action-btn" title="Shuffle">
                <span className="material-icons">shuffle</span>
              </button>
            )}
          </div>
        </div>

        <div className="player-queue-list">
          <div className="player-queue-empty">
            <span className="material-icons empty-icon">queue_music</span>
            <div className="empty-message">Queue is empty</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`player-queue-section ${className}`}>
      {onQuickSearch && (
        <div className="quick-search-controls">
          <input
            type="text"
            id="quickLibrarySearch"
            placeholder="Search..."
            onInput={(e) => onQuickSearch(e.target.value)}
          />
          <div className="quick-search-dropdown" id="quickSearchResults" style={{display: 'none'}}>
            <div className="no-search-message">Type to search your library</div>
          </div>
        </div>
      )}

      <div className="player-queue-header">
        <h4>Queue</h4>
        <div className="queue-actions">
          {handleClear && (
            <button onClick={handleClear} className="queue-action-btn" title="Clear Queue">
              <span className="material-icons">delete</span>
            </button>
          )}
          {onShuffleQueue && (
            <button onClick={onShuffleQueue} className="queue-action-btn" title="Shuffle">
              <span className="material-icons">shuffle</span>
            </button>
          )}
        </div>
      </div>

      <div className="player-queue-list">
        {queue.map((item, index) => {
          // Support both currentIndex (renderer) and currentSongId (web)
          // ONLY match by queueItemId - no path fallback to avoid duplicate song highlighting
          let isCurrentSong = false;

          // Renderer uses currentIndex
          if (currentIndex >= 0 && index === currentIndex) {
            isCurrentSong = true;
          }
          // Web uses currentSongId (queueItemId only - must be a number)
          else if (typeof currentSongId === 'number') {
            isCurrentSong = item.id === currentSongId;
          }

          const itemClass = isCurrentSong ? 'player-queue-item current' : 'player-queue-item';
          const requesterText = item.requester ? ` • Singer: ${item.requester}` : '';

          const isDragging = draggedIndex === index;
          const isDragOver = dragOverIndex === index;
          const dragClass = `${itemClass}${isDragging ? ' dragging' : ''}${isDragOver ? ' drag-over' : ''}`;

          return (
            <div
              key={item.id}
              className={dragClass}
              data-item-id={item.id}
              draggable={!!onReorderQueue}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <div className="queue-item-number">{index + 1}</div>
              <div className="queue-item-info">
                <div className="queue-item-title" title={item.title}>{item.title}</div>
                <div className="queue-item-artist" title={`${item.artist}${requesterText}`}>
                  {item.artist}{requesterText}
                </div>
              </div>
              <div className="queue-item-actions">
                {handlePlay && (
                  <button
                    onClick={() => handlePlay(item.id || item.path)}
                    className="queue-item-btn"
                    title="Load Song"
                  >
                    <span className="material-icons">queue_play_next</span>
                  </button>
                )}
                {handleRemove && (
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="queue-item-btn"
                    title="Remove"
                  >
                    <span className="material-icons">close</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
