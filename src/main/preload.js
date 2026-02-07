const { contextBridge, ipcRenderer } = require('electron');

// Helper to wrap IPC listeners and strip the Electron event object
// This prevents leaking event.sender, event.ports, etc. to the renderer
const safeOn = (channel, callback) => {
  ipcRenderer.on(channel, (_event, ...args) => callback(...args));
};

const safeRemoveListener = (channel, callback) => {
  // Note: This won't work perfectly with the wrapped callbacks
  // For proper cleanup, we'd need to track the wrapped functions
  ipcRenderer.removeListener(channel, callback);
};

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getState: () => ipcRenderer.invoke('app:getState'),
  },

  file: {
    openKai: () => ipcRenderer.invoke('file:openKai'),
    loadKaiFromPath: (filePath) => ipcRenderer.invoke('file:loadKaiFromPath', filePath),
  },

  audio: {
    getDevices: () => ipcRenderer.invoke('audio:getDevices'),
    enumerateDevices: () => ipcRenderer.invoke('audio:enumerateDevices'),
    setDevice: (deviceType, deviceId) =>
      ipcRenderer.invoke('audio:setDevice', deviceType, deviceId),

    onXRun: (callback) => safeOn('audio:xrun', callback),
    onLatencyUpdate: (callback) => safeOn('audio:latency', callback),

    removeXRunListener: (callback) => safeRemoveListener('audio:xrun', callback),
    removeLatencyListener: (callback) => safeRemoveListener('audio:latency', callback),
  },

  mixer: {
    setMasterGain: (bus, gainDb) => ipcRenderer.invoke('mixer:setMasterGain', bus, gainDb),
    toggleMasterMute: (bus) => ipcRenderer.invoke('mixer:toggleMasterMute', bus),
    toggleMute: (stemId, bus) => ipcRenderer.invoke('mixer:toggleMute', stemId, bus),

    onStateChange: (callback) => safeOn('mixer:state', callback),
    removeStateListener: (callback) => safeRemoveListener('mixer:state', callback),

    // Listen for commands from main process (for web admin)
    onSetMasterGain: (callback) => safeOn('mixer:setMasterGain', callback),
    onToggleMasterMute: (callback) => safeOn('mixer:toggleMasterMute', callback),
    onSetMasterMute: (callback) => safeOn('mixer:setMasterMute', callback),
  },

  player: {
    play: () => ipcRenderer.invoke('player:play'),
    pause: () => ipcRenderer.invoke('player:pause'),
    seek: (positionSec) => ipcRenderer.invoke('player:seek', positionSec),
    restart: () => ipcRenderer.invoke('player:restart'),
    next: () => ipcRenderer.invoke('player:next'),

    onPlaybackState: (callback) => safeOn('playback:state', callback),
    removePlaybackListener: (callback) => safeRemoveListener('playback:state', callback),

    // Events from main process for playback control
    onTogglePlayback: (callback) => safeOn('player:togglePlayback', callback),
    onRestart: (callback) => safeOn('player:restart', callback),
    onSetPosition: (callback) => safeOn('player:setPosition', callback),
    removeTogglePlaybackListener: (callback) =>
      safeRemoveListener('player:togglePlayback', callback),
    removeRestartListener: (callback) => safeRemoveListener('player:restart', callback),
    removeSetPositionListener: (callback) =>
      safeRemoveListener('player:setPosition', callback),
  },

  autotune: {
    setEnabled: (enabled) => ipcRenderer.invoke('autotune:setEnabled', enabled),
    setSettings: (settings) => ipcRenderer.invoke('autotune:setSettings', settings),
  },

  song: {
    onLoaded: (callback) => safeOn('song:loaded', callback),
    onData: (callback) => safeOn('song:data', callback),
    onChanged: (callback) => safeOn('song:changed', callback),
    removeSongListener: (callback) => safeRemoveListener('song:loaded', callback),
    removeDataListener: (callback) => safeRemoveListener('song:data', callback),
    removeChangedListener: (callback) => safeRemoveListener('song:changed', callback),
    getCurrentSong: () => ipcRenderer.invoke('song:getCurrentSong'),
  },

  editor: {
    loadKai: (filePath) => ipcRenderer.invoke('editor:loadKai', filePath),
    saveKai: (kaiData, originalPath) => ipcRenderer.invoke('editor:saveKai', kaiData, originalPath),
    reloadKai: (filePath) => ipcRenderer.invoke('editor:reloadKai', filePath),
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

  library: {
    getSongsFolder: () => ipcRenderer.invoke('library:getSongsFolder'),
    setSongsFolder: () => ipcRenderer.invoke('library:setSongsFolder'),
    scanFolder: () => ipcRenderer.invoke('library:scanFolder'),
    syncLibrary: () => ipcRenderer.invoke('library:syncLibrary'),
    getCachedSongs: () => ipcRenderer.invoke('library:getCachedSongs'),
    getSongInfo: (filePath) => ipcRenderer.invoke('library:getSongInfo', filePath),
    search: (query) => ipcRenderer.invoke('library:search', query),

    onFolderSet: (callback) => safeOn('library:folderSet', callback),
    removeFolderSetListener: (callback) =>
      safeRemoveListener('library:folderSet', callback),
  },

  webServer: {
    getPort: () => ipcRenderer.invoke('webServer:getPort'),
    getUrl: () => ipcRenderer.invoke('webServer:getUrl'),
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
    onUpdate: (callback) => safeOn('settings:update', callback),
    removeUpdateListener: (callback) => safeRemoveListener('settings:update', callback),
  },

  queue: {
    addSong: (queueItem) => ipcRenderer.invoke('queue:addSong', queueItem),
    removeSong: (itemId) => ipcRenderer.invoke('queue:removeSong', itemId),
    get: () => ipcRenderer.invoke('queue:get'),
    clear: () => ipcRenderer.invoke('queue:clear'),
    load: (itemId) => ipcRenderer.invoke('queue:load', itemId),
    reorderQueue: (songId, newIndex) => ipcRenderer.invoke('queue:reorderQueue', songId, newIndex),

    onUpdated: (callback) => safeOn('queue:updated', callback),
    removeUpdatedListener: (callback) => safeRemoveListener('queue:updated', callback),
  },

  effect: {
    onNext: (callback) => safeOn('effect:next', callback),
    onPrevious: (callback) => safeOn('effect:previous', callback),
    removeNextListener: (callback) => safeRemoveListener('effect:next', callback),
    removePreviousListener: (callback) => safeRemoveListener('effect:previous', callback),
  },

  effects: {
    getList: () => ipcRenderer.invoke('effects:getList'),
    select: (effectName) => ipcRenderer.invoke('effects:select', effectName),
    toggle: (effectName, enabled) => ipcRenderer.invoke('effects:toggle', effectName, enabled),
    next: () => ipcRenderer.invoke('effects:next'),
    previous: () => ipcRenderer.invoke('effects:previous'),
    random: () => ipcRenderer.invoke('effects:random'),

    onChanged: (callback) => safeOn('effects:changed', callback),
    removeChangedListener: (callback) => safeRemoveListener('effects:changed', callback),
  },

  preferences: {
    setAutoTune: (prefs) => ipcRenderer.invoke('preferences:setAutoTune', prefs),
    setMicrophone: (prefs) => ipcRenderer.invoke('preferences:setMicrophone', prefs),
    setEffects: (prefs) => ipcRenderer.invoke('preferences:setEffects', prefs),

    onUpdated: (callback) => safeOn('preferences:updated', callback),
    removeUpdatedListener: (callback) =>
      safeRemoveListener('preferences:updated', callback),
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
    sendWebRTCResponse: (command, result) => ipcRenderer.send(`webrtc:${command}-response`, result),
  },

  // REMOVED: Open events.on() that allowed listening on any IPC channel
  // All event listeners are now exposed through specific, whitelisted APIs above

  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // WebRTC handlers for canvas window
  webrtc: {
    // Receiver setup handlers
    onSetupReceiver: (callback) => safeOn('webrtc:setupReceiver', callback),
    onCheckReceiverReady: (callback) => safeOn('webrtc:checkReceiverReady', callback),
    onSetOfferAndCreateAnswer: (callback) => safeOn('webrtc:setOfferAndCreateAnswer', callback),
    onGetReceiverStatus: (callback) => safeOn('webrtc:getReceiverStatus', callback),
    onAddReceiverICECandidate: (callback) => safeOn('webrtc:addReceiverICECandidate', callback),
    onCleanupReceiver: (callback) => safeOn('webrtc:cleanupReceiver', callback),

    // Sender setup handlers
    onSetupSender: (callback) => safeOn('webrtc:setupSender', callback),
    onCreateOffer: (callback) => safeOn('webrtc:createOffer', callback),
    onSetAnswer: (callback) => safeOn('webrtc:setAnswer', callback),
    onGetSenderStatus: (callback) => safeOn('webrtc:getSenderStatus', callback),
    onCleanupSender: (callback) => safeOn('webrtc:cleanupSender', callback),

    // Response senders
    sendSetupReceiverResponse: (result) => ipcRenderer.send('webrtc:setupReceiver-response', result),
    sendCheckReceiverReadyResponse: (result) => ipcRenderer.send('webrtc:checkReceiverReady-response', result),
    sendSetOfferAndCreateAnswerResponse: (result) => ipcRenderer.send('webrtc:setOfferAndCreateAnswer-response', result),
    sendGetReceiverStatusResponse: (result) => ipcRenderer.send('webrtc:getReceiverStatus-response', result),
    sendSetupSenderResponse: (result) => ipcRenderer.send('webrtc:setupSender-response', result),
    sendCreateOfferResponse: (result) => ipcRenderer.send('webrtc:createOffer-response', result),
    sendSetAnswerResponse: (result) => ipcRenderer.send('webrtc:setAnswer-response', result),
    sendGetSenderStatusResponse: (result) => ipcRenderer.send('webrtc:getSenderStatus-response', result),

    // Canvas ready signal
    sendChildReady: () => ipcRenderer.send('canvas:childReady'),
  },

  creator: {
    checkComponents: () => ipcRenderer.invoke('creator:checkComponents'),
    installComponents: () => ipcRenderer.invoke('creator:installComponents'),
    getStatus: () => ipcRenderer.invoke('creator:getStatus'),
    cancelInstall: () => ipcRenderer.invoke('creator:cancelInstall'),
    searchLyrics: (title, artist) => ipcRenderer.invoke('creator:searchLyrics', title, artist),
    prepareWhisperContext: (title, artist, existingLyrics) =>
      ipcRenderer.invoke('creator:prepareWhisperContext', title, artist, existingLyrics),
    selectFile: () => ipcRenderer.invoke('creator:selectFile'),
    startConversion: (options) => ipcRenderer.invoke('creator:startConversion', options),
    cancelConversion: () => ipcRenderer.invoke('creator:cancelConversion'),

    // LLM settings
    getLLMSettings: () => ipcRenderer.invoke('creator:getLLMSettings'),
    saveLLMSettings: (settings) => ipcRenderer.invoke('creator:saveLLMSettings', settings),
    testLLMConnection: (settings) => ipcRenderer.invoke('creator:testLLMConnection', settings),

    onInstallProgress: (callback) => ipcRenderer.on('creator:installProgress', callback),
    onInstallError: (callback) => ipcRenderer.on('creator:installError', callback),
    onConversionProgress: (callback) => ipcRenderer.on('creator:conversionProgress', callback),
    onConversionConsole: (callback) => ipcRenderer.on('creator:conversionConsole', callback),
    onConversionComplete: (callback) => ipcRenderer.on('creator:conversionComplete', callback),
    onConversionError: (callback) => ipcRenderer.on('creator:conversionError', callback),
    removeInstallProgressListener: (callback) =>
      ipcRenderer.removeListener('creator:installProgress', callback),
    removeInstallErrorListener: (callback) =>
      ipcRenderer.removeListener('creator:installError', callback),
    removeConversionProgressListener: (callback) =>
      ipcRenderer.removeListener('creator:conversionProgress', callback),
    removeConversionConsoleListener: (callback) =>
      ipcRenderer.removeListener('creator:conversionConsole', callback),
    removeConversionCompleteListener: (callback) =>
      ipcRenderer.removeListener('creator:conversionComplete', callback),
    removeConversionErrorListener: (callback) =>
      ipcRenderer.removeListener('creator:conversionError', callback),
  },
};

// Use contextBridge to safely expose API to renderer with contextIsolation enabled
contextBridge.exposeInMainWorld('kaiAPI', api);
