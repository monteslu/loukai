const { ipcRenderer } = require('electron');

// Mirrors GAMEPAD_CHANNELS in shared/ipcContracts.js. Duplicated as literals
// because the preload is loaded raw (CommonJS) and cannot import the ESM
// contracts module; a gamepadShim test asserts the two stay in sync.
const GAMEPAD_CHANNELS = {
  GET_SNAPSHOT: 'gamepad:getSnapshot',
  STATE_CHANGE: 'gamepad:state',
  CONNECTED: 'gamepad:connected',
  DISCONNECTED: 'gamepad:disconnected',
};

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getState: () => ipcRenderer.invoke('app:getState'),
  },

  file: {
    openSong: () => ipcRenderer.invoke('file:openSong'),
    loadSongFromPath: (filePath) => ipcRenderer.invoke('file:loadSongFromPath', filePath),
  },

  audio: {
    getDevices: () => ipcRenderer.invoke('audio:getDevices'),
    enumerateDevices: () => ipcRenderer.invoke('audio:enumerateDevices'),
    setDevice: (deviceType, deviceId) =>
      ipcRenderer.invoke('audio:setDevice', deviceType, deviceId),

    onXRun: (callback) => ipcRenderer.on('audio:xrun', callback),
    onLatencyUpdate: (callback) => ipcRenderer.on('audio:latency', callback),

    removeXRunListener: (callback) => ipcRenderer.removeListener('audio:xrun', callback),
    removeLatencyListener: (callback) => ipcRenderer.removeListener('audio:latency', callback),
  },

  mixer: {
    setMasterGain: (bus, gainDb) => ipcRenderer.invoke('mixer:setMasterGain', bus, gainDb),
    toggleMasterMute: (bus) => ipcRenderer.invoke('mixer:toggleMasterMute', bus),
    // Per-bus per-stem mixer (stem×bus mixer, #49)
    setStemGain: (bus, stem, gain) => ipcRenderer.invoke('mixer:setStemGain', bus, stem, gain),
    setStemMute: (bus, stem, muted) => ipcRenderer.invoke('mixer:setStemMute', bus, stem, muted),
    toggleStemMute: (bus, stem) => ipcRenderer.invoke('mixer:toggleStemMute', bus, stem),
    // Key shift for the loaded song (issue #90) - ephemeral, never persisted
    setKeyShift: (semitones) => ipcRenderer.invoke('mixer:setKeyShift', semitones),
    onKeyShift: (callback) => ipcRenderer.on('mixer:keyShift', callback),

    onStateChange: (callback) => ipcRenderer.on('mixer:state', callback),
    removeStateListener: (callback) => ipcRenderer.removeListener('mixer:state', callback),

    // Listen for commands from main process (for web admin)
    onSetMasterGain: (callback) => ipcRenderer.on('mixer:setMasterGain', callback),
    onToggleMasterMute: (callback) => ipcRenderer.on('mixer:toggleMasterMute', callback),
    onStemGain: (callback) => ipcRenderer.on('mixer:stemGain', callback),
    onStemMute: (callback) => ipcRenderer.on('mixer:stemMute', callback),
    onSetMasterMute: (callback) => ipcRenderer.on('mixer:setMasterMute', callback),
  },

  player: {
    play: () => ipcRenderer.invoke('player:play'),
    pause: () => ipcRenderer.invoke('player:pause'),
    seek: (positionSec) => ipcRenderer.invoke('player:seek', positionSec),
    restart: () => ipcRenderer.invoke('player:restart'),
    next: () => ipcRenderer.invoke('player:next'),

    onPlaybackState: (callback) => ipcRenderer.on('playback:state', callback),
    removePlaybackListener: (callback) => ipcRenderer.removeListener('playback:state', callback),

    // Events from main process for playback control
    onTogglePlayback: (callback) => ipcRenderer.on('player:togglePlayback', callback),
    onRestart: (callback) => ipcRenderer.on('player:restart', callback),
    onSetPosition: (callback) => ipcRenderer.on('player:setPosition', callback),
    removeTogglePlaybackListener: (callback) =>
      ipcRenderer.removeListener('player:togglePlayback', callback),
    removeRestartListener: (callback) => ipcRenderer.removeListener('player:restart', callback),
    removeSetPositionListener: (callback) =>
      ipcRenderer.removeListener('player:setPosition', callback),
  },

  autotune: {
    setEnabled: (enabled) => ipcRenderer.invoke('autotune:setEnabled', enabled),
    setSettings: (settings) => ipcRenderer.invoke('autotune:setSettings', settings),
  },

  song: {
    onLoaded: (callback) => ipcRenderer.on('song:loaded', callback),
    onData: (callback) => ipcRenderer.on('song:data', callback),
    onChanged: (callback) => ipcRenderer.on('song:changed', callback),
    removeSongListener: (callback) => ipcRenderer.removeListener('song:loaded', callback),
    removeDataListener: (callback) => ipcRenderer.removeListener('song:data', callback),
    removeChangedListener: (callback) => ipcRenderer.removeListener('song:changed', callback),
    getCurrentSong: () => ipcRenderer.invoke('song:getCurrentSong'),
  },

  editor: {
    load: (filePath) => ipcRenderer.invoke('editor:load', filePath),
    save: (songData, originalPath) => ipcRenderer.invoke('editor:save', songData, originalPath),
    reload: (filePath) => ipcRenderer.invoke('editor:reload', filePath),
  },

  window: {
    openCanvas: () => ipcRenderer.invoke('window:openCanvas'),
  },

  canvas: {
    startStreaming: () => ipcRenderer.invoke('canvas:startStreaming'),
    stopStreaming: () => ipcRenderer.invoke('canvas:stopStreaming'),
    sendImageData: (imageDataArray, width, height) =>
      ipcRenderer.invoke('canvas:sendImageData', imageDataArray, width, height),
    sendICECandidate: (source, candidate) =>
      ipcRenderer.invoke('canvas:sendICECandidate', source, candidate),
    toggleFullscreen: (shouldBeFullscreen) =>
      ipcRenderer.invoke('canvas:toggleFullscreen', shouldBeFullscreen),
    sendFrame: (dataUrl) => ipcRenderer.invoke('canvas:sendFrame', dataUrl),
  },

  streaming: {
    // Open the browser viewer URL via the system browser
    openViewer: () => ipcRenderer.invoke('streaming:openViewer'),
    // Get the viewer URL (for showing in UI without opening)
    getViewerUrl: () => ipcRenderer.invoke('streaming:getViewerUrl'),

    // Outbound signaling to viewers (sent through the web server's Socket.IO)
    sendViewerOffer: ({ viewerId, offer }) =>
      ipcRenderer.invoke('streaming:sendViewerOffer', { viewerId, offer }),
    sendViewerICE: ({ viewerId, candidate }) =>
      ipcRenderer.invoke('streaming:sendViewerICE', { viewerId, candidate }),

    // Inbound signaling from viewers (forwarded from the web server)
    onViewerJoin: (callback) =>
      ipcRenderer.on('streaming:viewerJoin', (_e, payload) => callback(payload)),
    onViewerAnswer: (callback) =>
      ipcRenderer.on('streaming:viewerAnswer', (_e, payload) => callback(payload)),
    onViewerICE: (callback) =>
      ipcRenderer.on('streaming:viewerICE', (_e, payload) => callback(payload)),
    onViewerLeave: (callback) =>
      ipcRenderer.on('streaming:viewerLeave', (_e, payload) => callback(payload)),

    getStats: () => ipcRenderer.invoke('streaming:getStats'),
  },

  library: {
    getSongsFolder: () => ipcRenderer.invoke('library:getSongsFolder'),
    setSongsFolder: () => ipcRenderer.invoke('library:setSongsFolder'),
    scanFolder: () => ipcRenderer.invoke('library:scanFolder'),
    syncLibrary: () => ipcRenderer.invoke('library:syncLibrary'),
    getCachedSongs: () => ipcRenderer.invoke('library:getCachedSongs'),
    getSongInfo: (filePath) => ipcRenderer.invoke('library:getSongInfo', filePath),
    search: (query, opts) => ipcRenderer.invoke('library:search', query, opts),
    writeChords: (path, chords) => ipcRenderer.invoke('library:writeChords', { path, chords }),

    onFolderSet: (callback) => ipcRenderer.on('library:folderSet', callback),
    removeFolderSetListener: (callback) =>
      ipcRenderer.removeListener('library:folderSet', callback),
  },

  webServer: {
    getPort: () => ipcRenderer.invoke('webServer:getPort'),
    getUrl: () => ipcRenderer.invoke('webServer:getUrl'),
    getLocalUrl: () => ipcRenderer.invoke('webServer:getLocalUrl'),
    getSettings: () => ipcRenderer.invoke('webServer:getSettings'),
    updateSettings: (settings) => ipcRenderer.invoke('webServer:updateSettings', settings),
    getSongRequests: () => ipcRenderer.invoke('webServer:getSongRequests'),
    approveRequest: (requestId) => ipcRenderer.invoke('webServer:approveRequest', requestId),
    rejectRequest: (requestId) => ipcRenderer.invoke('webServer:rejectRequest', requestId),
    refreshCache: () => ipcRenderer.invoke('webServer:refreshCache'),
    setAdminPassword: (password) => ipcRenderer.invoke('webServer:setAdminPassword', password),
    clearAllRequests: () => ipcRenderer.invoke('webServer:clearAllRequests'),
  },

  settings: {
    get: (key, defaultValue) => ipcRenderer.invoke('settings:get', key, defaultValue),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    updateBatch: (updates) => ipcRenderer.invoke('settings:updateBatch', updates),
    onUpdate: (callback) => ipcRenderer.on('settings:update', callback),
    removeUpdateListener: (callback) => ipcRenderer.removeListener('settings:update', callback),
  },

  queue: {
    addSong: (queueItem) => ipcRenderer.invoke('queue:addSong', queueItem),
    removeSong: (itemId) => ipcRenderer.invoke('queue:removeSong', itemId),
    get: () => ipcRenderer.invoke('queue:get'),
    clear: () => ipcRenderer.invoke('queue:clear'),
    load: (itemId) => ipcRenderer.invoke('queue:load', itemId),
    reorderQueue: (songId, newIndex) => ipcRenderer.invoke('queue:reorderQueue', songId, newIndex),

    onUpdated: (callback) => ipcRenderer.on('queue:updated', callback),
    removeUpdatedListener: (callback) => ipcRenderer.removeListener('queue:updated', callback),
  },

  effect: {
    onNext: (callback) => ipcRenderer.on('effect:next', callback),
    onPrevious: (callback) => ipcRenderer.on('effect:previous', callback),
    removeNextListener: (callback) => ipcRenderer.removeListener('effect:next', callback),
    removePreviousListener: (callback) => ipcRenderer.removeListener('effect:previous', callback),
  },

  effects: {
    getList: () => ipcRenderer.invoke('effects:getList'),
    select: (effectName) => ipcRenderer.invoke('effects:select', effectName),
    toggle: (effectName, enabled) => ipcRenderer.invoke('effects:toggle', effectName, enabled),
    next: () => ipcRenderer.invoke('effects:next'),
    previous: () => ipcRenderer.invoke('effects:previous'),
    random: () => ipcRenderer.invoke('effects:random'),

    onChanged: (callback) => ipcRenderer.on('effects:changed', callback),
    removeChangedListener: (callback) => ipcRenderer.removeListener('effects:changed', callback),
  },

  preferences: {
    setAutoTune: (prefs) => ipcRenderer.invoke('preferences:setAutoTune', prefs),
    setMicrophone: (prefs) => ipcRenderer.invoke('preferences:setMicrophone', prefs),
    setEffects: (prefs) => ipcRenderer.invoke('preferences:setEffects', prefs),

    onUpdated: (callback) => ipcRenderer.on('preferences:updated', callback),
    removeUpdatedListener: (callback) =>
      ipcRenderer.removeListener('preferences:updated', callback),
  },

  // admin.onPlay/onNext/onRestart removed - web admin calls window.app methods directly via executeJavaScript

  renderer: {
    sendPlaybackState: (state) => ipcRenderer.send('renderer:playbackState', state),
    updatePlaybackState: (updates) => ipcRenderer.send('renderer:updatePlaybackState', updates),
    songLoaded: (songData) => ipcRenderer.send('renderer:songLoaded', songData),
    updateMixerState: (mixerState) => ipcRenderer.send('renderer:updateMixerState', mixerState),
    updateEffectsState: (effectsState) =>
      ipcRenderer.send('renderer:updateEffectsState', effectsState),
    sendEffectsList: (effects) => ipcRenderer.send('effects:getList-response', effects),
    sendCurrentEffect: (effectName) => ipcRenderer.send('effects:getCurrent-response', effectName),
    sendDisabledEffects: (disabled) => ipcRenderer.send('effects:getDisabled-response', disabled),
    sendWebRTCResponse: (command, result) => {
      // SECURITY FIX (#24): Whitelist allowed WebRTC commands to prevent IPC channel injection
      const ALLOWED_COMMANDS = [
        // Receiver side (canvas window)
        'setupReceiver',
        'checkReceiverReady',
        'setOfferAndCreateAnswer',
        'getReceiverStatus',
        // Sender side (main window)
        'setupSender',
        'createOffer',
        'setAnswer',
        'getSenderStatus',
      ];
      if (!ALLOWED_COMMANDS.includes(command)) {
        console.warn('Blocked invalid WebRTC command:', command);
        return;
      }
      ipcRenderer.send(`webrtc:${command}-response`, result);
    },
  },

  events: {
    on: (channel, callback) => ipcRenderer.on(channel, callback),
    removeListener: (channel, callback) => ipcRenderer.removeListener(channel, callback),
  },

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  creator: {
    // The creator runs entirely in-browser (WebGPU) — no native install/convert.
    getStatus: () => ipcRenderer.invoke('creator:getStatus'),
    // Accept EITHER an object payload ({ title, artist[, existingLyrics] }) OR positional
    // args; normalize to an object (a positional object had been landing in `title`,
    // producing "[object Object]" lyric queries).
    searchLyrics: (a, b) =>
      ipcRenderer.invoke(
        'creator:searchLyrics',
        a && typeof a === 'object' ? a : { title: a, artist: b }
      ),
    prepareWhisperContext: (a, b, c) =>
      ipcRenderer.invoke(
        'creator:prepareWhisperContext',
        a && typeof a === 'object' ? a : { title: a, artist: b, existingLyrics: c }
      ),
    selectFile: () => ipcRenderer.invoke('creator:selectFile'),
    saveWebGpuStems: (payload) => ipcRenderer.invoke('creator:saveWebGpuStems', payload),
    correctLyrics: (payload) => ipcRenderer.invoke('creator:correctLyrics', payload),
    updateStemLyrics: (payload) => ipcRenderer.invoke('creator:updateStemLyrics', payload),

    // LLM settings (powers server-side lyric correction)
    getLLMSettings: () => ipcRenderer.invoke('creator:getLLMSettings'),
    saveLLMSettings: (settings) => ipcRenderer.invoke('creator:saveLLMSettings', settings),
    testLLMConnection: (settings) => ipcRenderer.invoke('creator:testLLMConnection', settings),

    // Subscribe to the single-job descriptor (start / progress / finish), broadcast by
    // main whenever a creation runs on ANY surface. Returns an unsubscribe fn so a
    // React effect can clean up. Lets a Create tab opened/refreshed mid-job show the
    // live job instead of a blank form.
    onJob: (callback) => {
      const handler = (_e, job) => callback(job);
      ipcRenderer.on('creator:job', handler);
      return () => ipcRenderer.removeListener('creator:job', handler);
    },

    // ---- Headless host-create (a phone commands the player to create on its GPU) ----
    // main → renderer: a 'create this' command { jobId, audioBytes, opts }. The player
    // app root registers this once and runs the same compute the panel uses.
    onHostCreate: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('creator:hostCreate', handler);
      return () => ipcRenderer.removeListener('creator:hostCreate', handler);
    },
    // renderer → main: stream progress, then the final result (or error), keyed by jobId.
    sendHostCreateProgress: (jobId, progress) =>
      ipcRenderer.send('creator:hostCreate:progress', { jobId, progress }),
    sendHostCreateResult: (jobId, result) =>
      ipcRenderer.send(`creator:hostCreate:response:${jobId}`, result),
  },
};

// Since contextIsolation is disabled, directly assign to window
window.kaiAPI = api;

/**
 * navigator.getGamepads() shim, installed from the preload.
 *
 * Chromium only reports `mapping: "standard"` for a short list of well-known
 * pads, so most controllers are unusable through the stock Gamepad API. The main
 * process reads them through SDL (whose mapping DB covers nearly everything) and
 * streams normalized state here; this replaces `navigator.getGamepads` so any
 * standard Gamepad API consumer transparently gets SDL-quality data.
 *
 * Deliberately keeps the standard API shape rather than inventing a bespoke
 * event API, so gamepad-aware code stays portable to the web admin (which has no
 * SDL and falls through to Chromium's implementation).
 *
 * .cjs: the Electron preload is loaded raw (not bundled) and uses require(), so
 * this cannot be ESM, and the package is "type": "module" so the extension is
 * what makes Node/vitest treat it as CommonJS.
 */

/**
 * @param {object} deps
 * @param {(channel: string, handler: Function) => void} deps.on - subscribe to main->renderer events
 * @param {(channel: string) => Promise<any>} deps.invoke - request/response to main
 * @param {object} deps.channels - GAMEPAD_CHANNELS
 * @param {object} [deps.target] - object hosting getGamepads (defaults to navigator)
 */
function installGamepadShim({ on, invoke, channels, target }) {
  // `target === undefined` means "use the ambient navigator"; an explicit null
  // means "there is no navigator here", which must not fall through to a global.
  const nav = target === undefined ? (typeof navigator !== 'undefined' ? navigator : null) : target;
  if (!nav) return null;

  const nativeGetGamepads = nav.getGamepads?.bind(nav);
  let pads = [];

  const state = {
    /** True once main has told us about at least one SDL pad. */
    get active() {
      return pads.length > 0;
    },
  };

  nav.getGamepads = () => {
    // Fall back to Chromium whenever SDL has nothing. A machine with no SDL, no
    // controller, or no permission to read input devices must be no worse off
    // than before the shim existed.
    if (pads.length === 0) {
      return nativeGetGamepads ? nativeGetGamepads() : [];
    }
    return pads;
  };

  on(channels.STATE_CHANGE, (_event, next) => {
    const timestamp = performance.now();
    pads = (next || []).map((pad) => ({ ...pad, timestamp }));
  });

  on(channels.CONNECTED, (_event, device) => {
    // Standard-API consumers listen for these rather than polling for arrival.
    dispatchGamepadEvent('gamepadconnected', device);
  });

  on(channels.DISCONNECTED, (_event, device) => {
    pads = [];
    dispatchGamepadEvent('gamepaddisconnected', device);
  });

  // Prime from the current state so a controller connected before the window
  // opened is usable immediately, not only after its first input.
  invoke(channels.GET_SNAPSHOT)
    .then((snapshot) => {
      if (snapshot?.length && pads.length === 0) {
        const timestamp = performance.now();
        pads = snapshot.map((pad) => ({ ...pad, timestamp }));
      }
    })
    .catch(() => {
      // No gamepad support available; the native fallback stays in place.
    });

  return state;
}

function dispatchGamepadEvent(type, device) {
  if (typeof window === 'undefined') return;
  // GamepadEvent's constructor demands a real Gamepad instance, which we can't
  // synthesize, so use a plain Event and hang the detail off it.
  const event = new Event(type);
  event.gamepadInfo = device;
  window.dispatchEvent(event);
}

// Back navigator.getGamepads() with SDL so controllers that Chromium can't map
// still work. Falls through to Chromium when SDL has no pads, so this can only
// add support, never remove it.
window.kaiGamepad = installGamepadShim({
  on: (channel, handler) => ipcRenderer.on(channel, handler),
  invoke: (channel) => ipcRenderer.invoke(channel),
  channels: GAMEPAD_CHANNELS,
});
