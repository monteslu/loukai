/**
 * App - Main application component
 *
 * Contains the complete UI layout with all tabs and components
 */

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
  return (
    <div className="app-container">
      {/* Song Info Bar */}
      <SongInfoBarWrapper bridge={bridge} />

      {/* Main Content */}
      <div className="main-content">
        {/* Sidebar */}
        <div className="sidebar">
          <VisualizationSettings bridge={bridge} />
        </div>

        {/* Center Content */}
        <div className="center-content">
          {/* Tab Navigation */}
          <TabNavigation requestsCount={0} />

          {/* Tab Content */}
          <div className="tab-content">
            {/* Library Tab */}
            <div id="library-tab" className="tab-pane">
              <LibraryPanel bridge={bridge} showSetFolder={true} showFullRefresh={true} />
            </div>

            {/* Mixer Tab */}
            <div id="mixer-tab" className="tab-pane">
              <MixerTab bridge={bridge} />
            </div>

            {/* Player Tab */}
            <div id="player-tab" className="tab-pane active">
              <div className="player-container">
                {/* Top Section: Queue Sidebar + Canvas */}
                <div className="player-top-section">
                  {/* Queue Sidebar (Left 1/3) */}
                  <div className="player-queue-sidebar">
                    <QueueTab bridge={bridge} />
                  </div>

                  {/* Canvas Area (Right 2/3) */}
                  <div className="player-canvas-area">
                    <div className="karaoke-display">
                      <canvas id="karaokeCanvas" width="1920" height="1080" style={{ cursor: 'pointer' }} onClick={toggleCanvasFullscreen}></canvas>
                      <div className="lyrics-container" id="lyricsContainer" style={{ display: 'none' }}>
                        <div className="no-lyrics">No lyrics available</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Section: Transport Controls */}
                <TransportControlsWrapper bridge={bridge} />
              </div>
            </div>

            {/* Effects Tab */}
            <div id="effects-tab" className="tab-pane">
              <EffectsPanelWrapper bridge={bridge} />
            </div>

            {/* Song Requests Tab */}
            <div id="requests-tab" className="tab-pane">
              <RequestsListWrapper />
            </div>

            {/* Server Tab */}
            <div id="server-tab" className="tab-pane">
              <ServerTab bridge={bridge} />
            </div>

            {/* Lyrics Editor Tab */}
            <div id="editor-tab" className="tab-pane">
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
