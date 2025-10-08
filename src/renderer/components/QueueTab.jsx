/**
 * QueueTab - Queue management tab for renderer
 *
 * Combines:
 * - QueueList (shared queue display)
 * - QuickSearch (shared quick search)
 */

import React, { useState, useEffect } from 'react';
import { QueueList } from '../../shared/components/QueueList.jsx';
import { QuickSearch } from '../../shared/components/QuickSearch.jsx';
import './QueueTab.css';

export function QueueTab({ bridge }) {
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

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

  return (
    <div className="queue-tab-container">
      <QuickSearch bridge={bridge} requester="KJ" />

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
