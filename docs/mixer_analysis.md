# Mixer Component Analysis

## Current Situation

### ✅ What's Shared (Good!)

**`src/shared/components/MixerPanel.jsx`:**
- **Gain controls** for PA, IEM, and Mic buses
- Mute buttons for all buses
- Works with both ElectronBridge and WebBridge
- Already used in web admin

**Functionality:**
- PA (Main) - Music + Mic to audience
- IEM (Monitors) - Vocals only (mono)
- Mic Input - Microphone gain

This is **already fully shared** between renderer and web admin! ✅

### ⚠️ What's Duplicated (Bad!)

**`src/renderer/js/mixer.js`:**
- **DUPLICATE implementation** of the same gain controls
- 160 lines of vanilla JS doing exactly what MixerPanel.jsx does
- Called `MixerController` class
- Renders the same 3 faders: PA, IEM, Mic
- Same functionality, different implementation

**This is unnecessary duplication!** The renderer should just use `MixerPanel.jsx`.

### 🔧 What's Renderer-Specific (Needs Work)

**Audio Device Selection UI** (in index.html, lines 172-207):
- PA Output device dropdown
- IEM Output device dropdown
- Mic Input device dropdown
- "IEM Vocals in Mono" checkbox
- "Mic to Speakers" checkbox
- "Enable Mic" checkbox

**This is NOT in web admin** because:
- Web admin can't access native audio devices (browser limitation)
- Only Electron renderer has access to `navigator.mediaDevices` and Web Audio device enumeration
- This is genuinely **renderer-only** UI

## What Should Happen

### 1. Remove Duplicate `mixer.js` ❌

The vanilla `MixerController` in `mixer.js` should be **deleted** and replaced with:

```jsx
// Use the shared component
import { MixerPanel } from '../../shared/components/MixerPanel.jsx';

<MixerPanel
  mixerState={mixerState}
  onSetMasterGain={handleSetMasterGain}
  onToggleMasterMute={handleToggleMasterMute}
/>
```

### 2. Create Renderer-Only Audio Device Component ✅

**New component: `src/renderer/components/AudioDeviceSettings.jsx`**

```jsx
export function AudioDeviceSettings({
  devices,           // { pa: [], iem: [], input: [] }
  selected,          // { pa: 'deviceId', iem: 'deviceId', input: 'deviceId' }
  settings,          // { iemMonoVocals: true, micToSpeakers: true, enableMic: true }
  onDeviceChange,    // (type, deviceId) => {}
  onSettingChange,   // (setting, value) => {}
  onRefreshDevices   // () => {}
}) {
  return (
    <div className="audio-settings-section">
      <h3>
        Audio Devices
        <button onClick={onRefreshDevices} className="refresh-btn">↻</button>
      </h3>

      {/* PA Output */}
      <div className="device-selector">
        <label>PA Output:</label>
        <select
          value={selected.pa}
          onChange={(e) => onDeviceChange('pa', e.target.value)}
        >
          {devices.pa.map(dev => (
            <option key={dev.deviceId} value={dev.deviceId}>
              {dev.label}
            </option>
          ))}
        </select>
      </div>

      {/* IEM Output */}
      <div className="device-selector">
        <label>IEM Output:</label>
        <select
          value={selected.iem}
          onChange={(e) => onDeviceChange('iem', e.target.value)}
        >
          {devices.iem.map(dev => (
            <option key={dev.deviceId} value={dev.deviceId}>
              {dev.label}
            </option>
          ))}
        </select>
      </div>

      {/* Mic Input */}
      <div className="device-selector">
        <label>Mic Input:</label>
        <select
          value={selected.input}
          onChange={(e) => onDeviceChange('input', e.target.value)}
        >
          {devices.input.map(dev => (
            <option key={dev.deviceId} value={dev.deviceId}>
              {dev.label}
            </option>
          ))}
        </select>
      </div>

      {/* Renderer-only settings */}
      <div className="device-settings">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.iemMonoVocals}
            onChange={(e) => onSettingChange('iemMonoVocals', e.target.checked)}
          />
          <span>IEM Vocals in Mono (for single earpiece)</span>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.micToSpeakers}
            onChange={(e) => onSettingChange('micToSpeakers', e.target.checked)}
          />
          <span>Mic to Speakers</span>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.enableMic}
            onChange={(e) => onSettingChange('enableMic', e.target.checked)}
          />
          <span>Enable Mic</span>
        </label>
      </div>
    </div>
  );
}
```

### 3. Combine in Renderer's Mixer Tab

**In renderer App.jsx or MixerTab.jsx:**

```jsx
import { MixerPanel } from '../../shared/components/MixerPanel.jsx';
import { AudioDeviceSettings } from './AudioDeviceSettings.jsx';

function MixerTab() {
  return (
    <div className="mixer-tab">
      {/* Shared gain controls */}
      <MixerPanel
        mixerState={mixerState}
        onSetMasterGain={handleSetMasterGain}
        onToggleMasterMute={handleToggleMasterMute}
      />

      {/* Renderer-only device selection */}
      <AudioDeviceSettings
        devices={audioDevices}
        selected={selectedDevices}
        settings={audioSettings}
        onDeviceChange={handleDeviceChange}
        onSettingChange={handleSettingChange}
        onRefreshDevices={handleRefreshDevices}
      />
    </div>
  );
}
```

## Benefits

1. **No Duplication** ✅
   - Gain controls in one place (MixerPanel.jsx)
   - Shared between web admin and renderer
   - Bug fixes apply to both UIs

2. **Clear Separation** ✅
   - **Shared:** Gain/mute controls (works everywhere)
   - **Renderer-only:** Device selection (Electron-specific)

3. **Consistent UX** ✅
   - Same mixer controls in both UIs
   - Same look and feel
   - Same behavior

## Summary

**Current state:**
- ✅ MixerPanel.jsx exists and works (shared gain controls)
- ❌ mixer.js duplicates this functionality (should be deleted)
- ⚠️ Audio device UI is vanilla HTML (needs AudioDeviceSettings.jsx)

**Action items:**
1. Delete `src/renderer/js/mixer.js`
2. Create `src/renderer/components/AudioDeviceSettings.jsx`
3. Use MixerPanel.jsx in renderer (already works!)
4. Combine both in renderer's Mixer tab

**Result:** Shared gain controls + renderer-specific device selection, zero duplication!
