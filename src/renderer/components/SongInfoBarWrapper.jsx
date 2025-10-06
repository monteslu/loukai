/**
 * SongInfoBarWrapper - Renderer-specific wrapper for SongInfoBar
 * Manages state and bridge integration
 */

import React, { useState, useEffect } from 'react';
import { SongInfoBar } from '../../shared/components/SongInfoBar.jsx';

export function SongInfoBarWrapper({ bridge }) {
  const [currentSong, setCurrentSong] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!bridge) return;

    // Subscribe to current song changes
    const unsubscribe = bridge.onCurrentSongChanged?.((song) => {
      setCurrentSong(song);
    });

    // Fetch initial state
    bridge.getQueue?.()
      .then(data => {
        if (data.currentSong) {
          setCurrentSong(data.currentSong);
        }
      })
      .catch(console.error);

    // Load sidebar state
    bridge.api?.settings.get('sidebarCollapsed', false)
      .then(collapsed => {
        setSidebarCollapsed(collapsed);
        // Apply initial state to sidebar
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && collapsed) {
          sidebar.classList.add('collapsed');
        }
      })
      .catch(console.error);

    return () => unsubscribe && unsubscribe();
  }, [bridge]);

  const handleMenuClick = async () => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const newCollapsedState = !sidebarCollapsed;
    setSidebarCollapsed(newCollapsedState);

    // Toggle CSS class
    if (newCollapsedState) {
      sidebar.classList.add('collapsed');
    } else {
      sidebar.classList.remove('collapsed');
    }

    // Save state
    try {
      await bridge.api?.settings.set('sidebarCollapsed', newCollapsedState);
    } catch (error) {
      console.error('Failed to save sidebar state:', error);
    }
  };

  return (
    <SongInfoBar
      currentSong={currentSong}
      onMenuClick={handleMenuClick}
      sidebarCollapsed={sidebarCollapsed}
    />
  );
}
