/**
 * TabNavigation - Renderer tab navigation component
 *
 * Manages tab switching between different app sections
 */

import React, { useState } from 'react';
import './TabNavigation.css';

export function TabNavigation({ requestsCount = 0 }) {
  const [activeTab, setActiveTab] = useState('player');

  const tabs = [
    { id: 'player', label: 'Player' },
    { id: 'library', label: 'Library' },
    { id: 'mixer', label: 'Audio Settings' },
    { id: 'effects', label: 'Effects' },
    { id: 'requests', label: 'Song Requests', badge: requestsCount },
    { id: 'server', label: 'Server' },
    { id: 'editor', label: 'Lyrics Editor' }
  ];

  const handleTabClick = (tabId) => {
    // Remove active class from all tabs
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    // Add active class to selected tab
    const targetPane = document.getElementById(`${tabId}-tab`);
    if (targetPane) {
      targetPane.classList.add('active');
    }

    setActiveTab(tabId);

    // Handle resize for player tab to update canvas styling
    if (tabId === 'player' && window.kaiPlayerApp?.player?.karaokeRenderer?.resizeHandler) {
      setTimeout(() => {
        window.kaiPlayerApp.player.karaokeRenderer.resizeHandler();
      }, 10);
    }
  };

  return (
    <div className="tab-nav">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => handleTabClick(tab.id)}
        >
          {tab.label}
          {tab.badge > 0 && (
            <span className="tab-badge">{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
