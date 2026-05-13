/**
 * AppRoot - Top-level app component
 *
 * Wraps app with context providers and initializes audio engine
 */

import { PlayerProvider } from '../../shared/contexts/PlayerContext.jsx';
import { AudioProvider } from '../../shared/contexts/AudioContext.jsx';
import { SettingsProvider } from '../../shared/contexts/SettingsContext.jsx';
import { useAudioEngine } from '../../shared/hooks/useAudioEngine.js';
import { useSettingsPersistence } from '../../shared/hooks/useSettingsPersistence.js';
import { useWebRTC } from '../../shared/hooks/useWebRTC.js';
import { useStreamingSender } from '../../shared/hooks/useStreamingSender.js';

function AppInitializer({ children }) {
  // Initialize audio engine
  useAudioEngine();

  // Load/save settings
  useSettingsPersistence();

  // Initialize WebRTC
  useWebRTC();

  // Initialize streaming sender (broadcasts canvas to /viewer browser tabs)
  useStreamingSender();

  return <>{children}</>;
}

export function AppRoot({ children }) {
  return (
    <SettingsProvider>
      <AudioProvider>
        <PlayerProvider>
          <AppInitializer>{children}</AppInitializer>
        </PlayerProvider>
      </AudioProvider>
    </SettingsProvider>
  );
}
