# Mixer UI Sync Issue - Investigation & Fixes

**Issue:** Mixer controls send updates and change audio, but UI doesn't update (sliders don't move, mute buttons don't toggle)

---

## What Was Fixed

### 1. ✅ Removed Excessive Logging in Main Process

**File:** `src/shared/services/mixerService.js`

**Removed:**
```javascript
console.log(`🎚️ Setting ${bus} gain: ${currentMixer[bus].gain} → ${gainDb} dB`);
console.log(`🔇 Toggling ${bus} mute: ${oldMuted} → ${newMuted}`);
console.log(`🔇 Setting ${bus} mute: ${currentMixer[bus].muted} → ${muted}`);
```

Main process is now quieter.

### 2. ✅ Added Debug Logging to MixerTab

**File:** `src/renderer/components/MixerTab.jsx`

**Added:**
```javascript
const unsubscribe = bridge.onMixerChanged?.((mixer) => {
  console.log('🎚️ MixerTab received state update:', mixer);
  setMixerState(mixer);
});

bridge.getMixerState?.()
  .then(state => {
    console.log('🎚️ MixerTab initial state:', state);
    setMixerState(state);
  })
```

This will show if React component is receiving updates.

---

## How State Updates Should Work

### The Chain:

1. **User drags slider** → `bridge.setMasterGain(bus, gainDb)` called
2. **IPC to main** → `ipcRenderer.invoke('mixer:setMasterGain', bus, gainDb)`
3. **Main handler** → `mixerService.setMasterGain(mainApp, bus, gainDb)`
4. **Update AppState** → `mainApp.appState.updateMixerState(updatedMixer)`
5. **AppState emits** → `emit('mixerChanged', mixer)`
6. **Main listens** → `appState.on('mixerChanged', (mixer) => { ... })`
7. **Broadcast to renderer** → `sendToRenderer('mixer:state', mixer)`
8. **Renderer receives** → `ipcRenderer.on('mixer:state', callback)`
9. **Bridge triggers** → `bridge.onMixerChanged(callback)` fires
10. **React updates** → `setMixerState(mixer)` updates UI

### Files Involved:

```
User Action
    ↓
MixerTab.jsx (calls bridge)
    ↓ IPC invoke
mixerHandlers.js (receives IPC)
    ↓
mixerService.js (business logic)
    ↓
appState.js (updates state, emits event)
    ↓ emit('mixerChanged')
main.js (listens to appState)
    ↓ sendToRenderer('mixer:state')
preload.js (exposes IPC to renderer)
    ↓ ipcRenderer.on('mixer:state')
ElectronBridge.js (wraps IPC)
    ↓ onMixerChanged callback
MixerTab.jsx (setState)
    ↓
MixerPanel.jsx (renders)
```

---

## Debugging Steps

### 1. Check if MixerTab receives initial state

**Look for in console:**
```
🎚️ MixerTab initial state: { PA: { gain: 0, muted: false }, ... }
```

If you DON'T see this, the bridge isn't getting state from main process.

### 2. Check if MixerTab receives updates

**Drag a slider, look for:**
```
🎚️ MixerTab received state update: { PA: { gain: -5, muted: false }, ... }
```

If you see the audio change but NOT this log, then the IPC event isn't being received.

### 3. Check if appState is emitting

**Add this to main.js temporarily:**
```javascript
this.appState.on('mixerChanged', (mixer) => {
  console.log('📢 appState emitted mixerChanged:', mixer);
  // ... rest of code
});
```

If you see this log, appState is working.

### 4. Check if main is sending to renderer

**Add this to main.js temporarily:**
```javascript
this.appState.on('mixerChanged', (mixer) => {
  // ... existing code
  console.log('📤 Sending mixer:state to renderer:', mixer);
  this.sendToRenderer('mixer:state', mixer);
});
```

If you see this log, main is sending.

### 5. Check if preload is listening

**Add this to preload.js temporarily in mixer section:**
```javascript
mixer: {
  // ... existing code
  onStateChange: (callback) => {
    const wrapped = (event, data) => {
      console.log('📥 preload received mixer:state:', data);
      callback(data);
    };
    ipcRenderer.on('mixer:state', wrapped);
  },
  // ...
}
```

If you see this log, preload is receiving.

---

## Potential Issues & Fixes

### Issue 1: AppState not emitting mixerChanged

**Symptom:** Audio changes but no 'mixerChanged' event

**Check:** `src/main/appState.js` - Does `updateMixerState()` call `this.update('mixer', mixerState)`?

**Fix:** Make sure StateManager (parent class) emits events on `update()`.

### Issue 2: Main not listening to appState

**Symptom:** appState emits but main doesn't receive

**Check:** `src/main/main.js` - Is there `this.appState.on('mixerChanged', ...)`?

**Fix:** Should already exist (verified above).

### Issue 3: Renderer not listening to IPC

**Symptom:** Main sends but renderer doesn't receive

**Check:** ElectronBridge's `onMixerChanged()` - Is it calling `this.api.mixer.onStateChange()`?

**Fix:** Already correct (verified above).

### Issue 4: React not re-rendering

**Symptom:** State updates but UI doesn't change

**Possible causes:**
- State object is same reference (not a new object)
- React thinks nothing changed
- MixerPanel not using the state prop correctly

**Check:** MixerPanel.jsx - Does it use `mixerState[bus.id]?.gain` and `mixerState[bus.id]?.muted`?

**Fix:** Ensure new object creation in mixerService (already done).

---

## Most Likely Issue

Based on the symptoms (audio changes but UI doesn't), the most likely issue is:

**The slider onChange is calling setMasterGain BUT not letting React controlled component update first.**

### Current MixerPanel code:
```jsx
<input
  type="range"
  value={gain}
  onChange={(e) => handleGainChangeLocal(bus.id, e.target.value)}
/>
```

### The problem:
1. User drags slider
2. `onChange` fires with new value
3. `handleGainChangeLocal()` calls `bridge.setMasterGain()`
4. IPC round-trip happens
5. State update comes back
6. BUT the slider is still showing old `value={gain}` because React hasn't re-rendered yet

### The fix:

The slider IS controlled (has `value={gain}`), so it SHOULD update when `gain` changes from props.

**Verify MixerPanel is getting new props:**

Add to MixerPanel.jsx:
```jsx
useEffect(() => {
  console.log('🎛️ MixerPanel mixerState changed:', mixerState);
}, [mixerState]);
```

If this doesn't log on slider drag, MixerTab isn't passing updated state to MixerPanel.

---

## Quick Test

1. Open DevTools console
2. Drag PA slider
3. Look for these logs IN ORDER:

```
(nothing yet - just audio changes)
📢 appState emitted mixerChanged: { PA: { gain: -5 ... } }
📤 Sending mixer:state to renderer: { PA: { gain: -5 ... } }
📥 preload received mixer:state: { PA: { gain: -5 ... } }
🎚️ MixerTab received state update: { PA: { gain: -5 ... } }
🎛️ MixerPanel mixerState changed: { PA: { gain: -5 ... } }
```

Wherever the chain breaks, that's where the bug is.

---

## Next Steps

1. **Add the debug logs** from "Debugging Steps" above
2. **Test slider drag** and watch console
3. **Find where chain breaks** and fix that specific link
4. **Remove debug logs** once working
5. **Profit!** ✨

---

## Update 2025-10-04: Debug Logging Added

### Changes Made:

#### 1. StateManager.js - Line 148-151
Added debug logging to see when mixer state updates are emitted:
```javascript
// Debug logging for mixer updates
if (domain === 'mixer') {
  console.log(`📢 StateManager: emitting ${domain}Changed:`, JSON.stringify(this.state[domain], null, 2));
}
```

#### 2. main.js - Line 104
Added logging to see when main receives mixerChanged and sends to renderer:
```javascript
console.log('📤 Main: received mixerChanged event, sending to renderer:', JSON.stringify(mixer, null, 2));
```

#### 3. main.js - Line 1725
Added logging to see when renderer reports back:
```javascript
console.log('📥 Main: renderer reported mixer state:', JSON.stringify(mixerState, null, 2));
```

#### 4. MixerPanel.jsx - Line 24-26
Added useEffect to see when component receives new state:
```javascript
useEffect(() => {
  console.log('🎛️ MixerPanel received new state:', JSON.stringify(state, null, 2));
}, [state]);
```

### Expected Log Sequence When Dragging Slider:

```
📢 StateManager: emitting mixerChanged: { PA: { gain: -5, muted: false }, ... }
📤 Main: received mixerChanged event, sending to renderer: { PA: { gain: -5, muted: false }, ... }
🎚️ MixerTab received state update: { PA: { gain: -5, muted: false }, ... }
🎛️ MixerPanel received new state: { PA: { gain: -5, muted: false }, ... }
[Audio plays at -5dB]
📥 Main: renderer reported mixer state: { PA: { gain: -5, muted: false }, ... }
📢 StateManager: emitting mixerChanged: { PA: { gain: -5, muted: false }, ... }
📤 Main: received mixerChanged event, sending to renderer: { PA: { gain: -5, muted: false }, ... }
🎚️ MixerTab received state update: { PA: { gain: -5, muted: false }, ... }
🎛️ MixerPanel received new state: { PA: { gain: -5, muted: false }, ... }
```

### Potential Issue Identified:

The `useEffect` dependency `[state]` might not trigger if React thinks `state` is the same object reference. The issue is likely in MixerPanel.jsx line 21:

```javascript
const state = mixer || mixerState || {};
```

If `mixerState` prop changes but still has the same object reference (even with different contents), React won't re-render and the useEffect won't fire.

**Next debugging step:** Check if MixerPanel logs show the state is actually changing, or if React is skipping the re-render due to reference equality.

---

## ✅ SOLUTION FOUND - 2025-10-04

### Root Cause

The bug was in **MixerPanel.jsx prop default values interfering with fallback logic**.

#### The Problem:
```javascript
export function MixerPanel({
  mixer = {},         // ← Default value
  mixerState = {},    // ← Default value
  ...
}) {
  const state = mixer || mixerState || {};  // ← WRONG ORDER + defaults break this
}
```

When both `mixer` and `mixerState` props are `undefined`:
1. Default values assign `mixer = {}` and `mixerState = {}`
2. Expression `mixer || mixerState || {}` evaluates to the FIRST `{}` (from `mixer`)
3. Even when `mixerState` updates to `{ PA: {...}, IEM: {...}, mic: {...} }`, the expression still evaluates `mixer` first
4. Since `mixer` is always `{}` (truthy), `mixerState` is never checked
5. Result: `state` is always `{}`, UI never updates

#### The Fix:
```javascript
export function MixerPanel({
  mixer,              // ← NO default value
  mixerState,         // ← NO default value
  ...
}) {
  const state = mixerState || mixer || {};  // ← Correct order: check mixerState first
}
```

Now:
1. When `mixerState` is provided (Electron renderer): uses `mixerState`
2. When `mixer` is provided (web admin): uses `mixer`
3. When both undefined: uses `{}`

### Additional Fix: Extract Bus-Level Mixer

The renderer's mixer state contained BOTH stem-level mixer (from AudioEngine) AND bus-level mixer (from AppState). MixerTab now extracts only the bus-level properties:

```javascript
const busLevelMixer = {
  PA: mixer.PA || { gain: 0, muted: false },
  IEM: mixer.IEM || { gain: 0, muted: false },
  mic: mixer.mic || { gain: 0, muted: false }
};
setMixerState(busLevelMixer);
```

### Files Modified:
- `src/shared/components/MixerPanel.jsx` - Removed prop defaults, fixed state precedence
- `src/renderer/components/MixerTab.jsx` - Extract only bus-level mixer properties

### Result:
✅ Mixer UI now updates correctly in both Electron renderer and web admin
✅ Sliders move when dragged
✅ Mute buttons toggle properly
✅ Audio changes are reflected in UI
