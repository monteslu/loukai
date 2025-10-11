/**
 * App - Main application component
 *
 * Contains the complete UI layout with all tabs and components
 */

import { useState, useEffect } from 'react';
import { LibraryPanel } from '../../shared/components/LibraryPanel.jsx';
import { EffectsPanelWrapper } from './EffectsPanelWrapper.jsx';
import { RequestsListWrapper } from './RequestsListWrapper.jsx';
import { SongEditor } from '../../shared/components/SongEditor.jsx';
import { MixerTab } from './MixerTab.jsx';
import { QueueTab } from './QueueTab.jsx';
import { SongInfoBarWrapper } from './SongInfoBarWrapper.jsx';
import { TransportControlsWrapper } from './TransportControlsWrapper.jsx';
import { StatusBar } from './StatusBar.jsx';
import { TabNavigation } from './TabNavigation.jsx';
import { ServerTab } from './ServerTab.jsx';
import { VisualizationSettings } from '../../shared/components/VisualizationSettings.jsx';
import { toggleCanvasFullscreen } from '../hooks/useKeyboardShortcuts.js';

export function App({ bridge }) {
  const [requests, setRequests] = useState([]);

  // Load and subscribe to requests
  useEffect(() => {
    const loadRequests = async () => {
      try {
        const requestsList = await window.kaiAPI.webServer.getSongRequests();
        setRequests(requestsList || []);
      } catch (error) {
        console.error('Failed to load requests:', error);
      }
    };

    loadRequests();

    // Auto-refresh every 5 seconds
    const interval = setInterval(loadRequests, 5000);

    // Listen for real-time updates
    if (window.kaiAPI?.events) {
      const onNewRequest = (event, request) => {
        console.log('📨 New song request:', request);
        loadRequests();
      };

      const onApproved = (event, request) => {
        console.log('✅ Request approved:', request);
        loadRequests();
      };

      const onRejected = (event, request) => {
        console.log('❌ Request rejected:', request);
        loadRequests();
      };

      window.kaiAPI.events.on('songRequest:new', onNewRequest);
      window.kaiAPI.events.on('songRequest:approved', onApproved);
      window.kaiAPI.events.on('songRequest:rejected', onRejected);

      return () => {
        clearInterval(interval);
        window.kaiAPI.events.removeListener('songRequest:new', onNewRequest);
        window.kaiAPI.events.removeListener('songRequest:approved', onApproved);
        window.kaiAPI.events.removeListener('songRequest:rejected', onRejected);
      };
    }

    return () => clearInterval(interval);
  }, []);

  // Calculate pending requests count
  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {/* Song Info Bar */}
      <SongInfoBarWrapper bridge={bridge} />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          id="app-sidebar"
          className="w-80 bg-white dark:bg-gray-800 p-4 overflow-y-auto border-r border-gray-200 dark:border-gray-700 transition-all duration-300"
        >
          <VisualizationSettings bridge={bridge} />
        </div>

        {/* Center Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Navigation */}
          <TabNavigation requestsCount={pendingCount} />

          {/* Tab Content */}
          <div className="flex-1 overflow-auto">
            {/* Library Tab */}
            <div id="library-tab" className="hidden h-full">
              <LibraryPanel bridge={bridge} showSetFolder={true} showFullRefresh={true} />
            </div>

            {/* Mixer Tab */}
            <div id="mixer-tab" className="hidden h-full overflow-auto">
              <MixerTab bridge={bridge} />
            </div>

            {/* Player Tab */}
            <div id="player-tab" className="h-full flex flex-col">
              {/* Top Section: Queue Sidebar + Canvas */}
              <div className="flex flex-1 gap-1 min-h-0">
                {/* Queue Sidebar (Left 30%) */}
                <div className="w-[30%] min-w-[280px] flex flex-col min-h-0">
                  <QueueTab bridge={bridge} />
                </div>

                {/* Canvas Area (Right 70%) */}
                <div className="flex-1 flex flex-col p-0 m-0 min-w-0">
                  <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-900">
                    <canvas
                      id="karaokeCanvas"
                      width="1920"
                      height="1080"
                      className="max-w-full max-h-full w-auto h-auto cursor-pointer"
                      onClick={toggleCanvasFullscreen}
                    />
                    <div id="lyricsContainer" className="hidden">
                      <div className="text-center text-gray-500">No lyrics available</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Section: Transport Controls */}
              <TransportControlsWrapper bridge={bridge} />
            </div>

            {/* Effects Tab */}
            <div id="effects-tab" className="hidden h-full">
              <EffectsPanelWrapper bridge={bridge} />
            </div>

            {/* Song Requests Tab */}
            <div id="requests-tab" className="hidden h-full">
              <RequestsListWrapper />
            </div>

            {/* Server Tab */}
            <div id="server-tab" className="hidden h-full overflow-auto">
              <ServerTab bridge={bridge} />
            </div>

            {/* Lyrics Editor Tab */}
            <div id="editor-tab" className="hidden h-full">
              <SongEditor bridge={bridge} />
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar bridge={bridge} />
    </div>
  );
}
