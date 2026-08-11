/**
 * QueueList - Unified queue display component
 *
 * Based on renderer's player-queue-sidebar design
 * Works with both ElectronBridge and WebBridge via callbacks
 */

import { useState } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { Tooltip } from './Tooltip.jsx';

/**
 * TooltipButton - icon button with a hint.
 *
 * The tooltip used to be hand-rolled here (this file predates the shared
 * component); it now delegates, which also fixes the stale-anchor drift the
 * local copy had.
 */
function TooltipButton({ icon, tooltip, onClick, className, iconSize = 'text-base' }) {
  return (
    <Tooltip text={tooltip}>
      <button onClick={onClick} className={className}>
        <span className={`material-icons ${iconSize}`}>{icon}</span>
      </button>
    </Tooltip>
  );
}

export function QueueList({
  queue = [],
  currentIndex = -1,
  currentSongId = null, // Support web's currentSongId prop
  onPlayFromQueue,
  onRemoveFromQueue,
  onLoad, // Alias for web compatibility
  onRemove, // Alias for web compatibility
  onClearQueue,
  onClear, // Alias for web compatibility
  onShuffleQueue,
  onReorderQueue, // New: drag and drop reordering
  onQuickSearch,
  className = '',
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Support both prop names
  const handlePlay = onPlayFromQueue || onLoad;
  const handleRemove = onRemoveFromQueue || onRemove;
  const handleClear = onClearQueue || onClear;
  const [confirmDialog, confirmModal] = useConfirm();

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
      // When moving down, account for the shift caused by removing the dragged item
      // Without this adjustment, items dropped below their origin end up one position too far down
      let targetIndex = dropIndex;
      if (draggedIndex < dropIndex) {
        targetIndex = dropIndex - 1;
      }
      onReorderQueue(item.id, targetIndex);
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
      <div className={`flex flex-col gap-1 flex-1 min-h-0 ${className}`}>
        {onQuickSearch && (
          <div className="relative mb-2">
            <input
              type="text"
              id="quickLibrarySearch"
              className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-400"
              placeholder="Search..."
              onInput={(e) => onQuickSearch(e.target.value)}
            />
            <div
              className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg z-50 hidden"
              id="quickSearchResults"
            >
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                Type to search your library
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center py-1">
          <h4 className="m-0 text-base font-semibold text-gray-900 dark:text-white">Queue</h4>
          <div className="flex gap-1">
            {handleClear && (
              <TooltipButton
                icon="delete"
                tooltip="Clear Queue"
                onClick={async () => {
                  if (await confirmDialog('Clear the whole queue?', { confirmLabel: 'Clear' })) {
                    handleClear();
                  }
                }}
                iconSize="text-lg"
                className="p-1.5 px-2 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center justify-center transition-all text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
              />
            )}
            {onShuffleQueue && (
              <TooltipButton
                icon="shuffle"
                tooltip="Shuffle"
                onClick={onShuffleQueue}
                iconSize="text-lg"
                className="p-1.5 px-2 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center justify-center transition-all text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
              />
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1">
          <div className="flex flex-col items-center justify-center p-8 text-gray-400 dark:text-gray-500">
            <span className="material-icons text-5xl mb-2 opacity-50">queue_music</span>
            <div className="text-sm">Queue is empty</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 flex-1 min-h-0 ${className}`}>
      {onQuickSearch && (
        <div className="relative mb-2">
          <input
            type="text"
            id="quickLibrarySearch"
            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-400"
            placeholder="Search..."
            onInput={(e) => onQuickSearch(e.target.value)}
          />
          <div
            className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg z-50 hidden"
            id="quickSearchResults"
          >
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              Type to search your library
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center py-1">
        <h4 className="m-0 text-base font-semibold text-gray-900 dark:text-white">Queue</h4>
        <div className="flex gap-1">
          {handleClear && (
            <TooltipButton
              icon="delete"
              tooltip="Clear Queue"
              onClick={handleClear}
              iconSize="text-lg"
              className="p-1.5 px-2 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center justify-center transition-all text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
            />
          )}
          {onShuffleQueue && (
            <TooltipButton
              icon="shuffle"
              tooltip="Shuffle"
              onClick={onShuffleQueue}
              iconSize="text-lg"
              className="p-1.5 px-2 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center justify-center transition-all text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1">
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

          const requesterText = item.requester ? ` • Singer: ${item.requester}` : '';

          const isDragging = draggedIndex === index;
          const isDragOver = dragOverIndex === index;

          // Build item classes
          const itemClasses = [
            'flex items-center gap-2 px-2 py-1.5 rounded transition-all',
            'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
            'hover:bg-gray-200 dark:hover:bg-gray-750',
          ];

          if (isCurrentSong) {
            itemClasses.push(
              'bg-green-100 dark:bg-green-900/20 border-green-500 dark:border-green-600'
            );
          }
          if (isDragging) {
            itemClasses.push('opacity-50 cursor-grabbing');
          }
          if (isDragOver) {
            itemClasses.push('border-t-2 border-t-cyan-500');
          }
          if (onReorderQueue) {
            itemClasses.push('cursor-grab');
          }

          return (
            <div
              key={item.id}
              className={itemClasses.join(' ')}
              data-item-id={item.id}
              draggable={Boolean(onReorderQueue)}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <div className="flex items-center justify-center w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded text-xs font-semibold text-gray-600 dark:text-gray-400 flex-shrink-0">
                {index + 1}
              </div>
              <div className="flex-1 min-w-0">
                {/* Hover reveals the full text: these lines are ellipsized. */}
                <Tooltip text={item.title}>
                  <div className="font-medium text-gray-900 dark:text-white whitespace-nowrap overflow-hidden text-ellipsis mb-0.5 text-sm">
                    {item.title}
                  </div>
                </Tooltip>
                <Tooltip text={`${item.artist}${requesterText}`}>
                  <div className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis">
                    {item.artist}
                    {requesterText}
                  </div>
                </Tooltip>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {/* Up/Down reorder buttons - only show if more than one item */}
                {onReorderQueue && queue.length > 1 && (
                  <>
                    {index > 0 && (
                      <TooltipButton
                        icon="arrow_upward"
                        tooltip="Move Up"
                        onClick={() => onReorderQueue(item.id, index - 1)}
                        className="p-1 bg-transparent border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center justify-center transition-all text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                      />
                    )}
                    {index < queue.length - 1 && (
                      <TooltipButton
                        icon="arrow_downward"
                        tooltip="Move Down"
                        onClick={() => onReorderQueue(item.id, index + 1)}
                        className="p-1 bg-transparent border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center justify-center transition-all text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                      />
                    )}
                  </>
                )}
                {handlePlay && (
                  <TooltipButton
                    icon="queue_play_next"
                    tooltip="Load Song"
                    onClick={() => handlePlay(item.id || item.path)}
                    className="p-1 px-2 bg-transparent border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center justify-center transition-all text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                  />
                )}
                {handleRemove && (
                  <TooltipButton
                    icon="close"
                    tooltip="Remove"
                    onClick={() => handleRemove(item.id)}
                    className="p-1 px-2 bg-transparent border border-gray-300 dark:border-gray-600 rounded cursor-pointer flex items-center justify-center transition-all text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {confirmModal}
    </div>
  );
}
