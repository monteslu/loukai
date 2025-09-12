const { ipcRenderer } = require('electron');

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },
  
  file: {
    openKai: () => ipcRenderer.invoke('file:openKai')
  },
  
  audio: {
    getDevices: () => ipcRenderer.invoke('audio:getDevices'),
    enumerateDevices: () => ipcRenderer.invoke('audio:enumerateDevices'),
    setDevice: (deviceType, deviceId) => ipcRenderer.invoke('audio:setDevice', deviceType, deviceId),
    
    onXRun: (callback) => ipcRenderer.on('audio:xrun', callback),
    onLatencyUpdate: (callback) => ipcRenderer.on('audio:latency', callback),
    
    removeXRunListener: (callback) => ipcRenderer.removeListener('audio:xrun', callback),
    removeLatencyListener: (callback) => ipcRenderer.removeListener('audio:latency', callback)
  },
  
  mixer: {
    toggleMute: (stemId, bus) => ipcRenderer.invoke('mixer:toggleMute', stemId, bus),
    toggleSolo: (stemId) => ipcRenderer.invoke('mixer:toggleSolo', stemId),
    setGain: (stemId, gainDb) => ipcRenderer.invoke('mixer:setGain', stemId, gainDb),
    applyPreset: (presetId) => ipcRenderer.invoke('mixer:applyPreset', presetId),
    recallScene: (sceneId) => ipcRenderer.invoke('mixer:recallScene', sceneId),
    
    onStateChange: (callback) => ipcRenderer.on('mixer:state', callback),
    removeStateListener: (callback) => ipcRenderer.removeListener('mixer:state', callback)
  },
  
  player: {
    play: () => ipcRenderer.invoke('player:play'),
    pause: () => ipcRenderer.invoke('player:pause'),
    seek: (positionSec) => ipcRenderer.invoke('player:seek', positionSec)
  },
  
  autotune: {
    setEnabled: (enabled) => ipcRenderer.invoke('autotune:setEnabled', enabled),
    setSettings: (settings) => ipcRenderer.invoke('autotune:setSettings', settings)
  },
  
  song: {
    onLoaded: (callback) => ipcRenderer.on('song:loaded', callback),
    onData: (callback) => ipcRenderer.on('song:data', callback),
    removeSongListener: (callback) => ipcRenderer.removeListener('song:loaded', callback),
    removeDataListener: (callback) => ipcRenderer.removeListener('song:data', callback)
  },
  
  editor: {
    saveKai: (kaiData, originalPath) => ipcRenderer.invoke('editor:saveKai', kaiData, originalPath),
    reloadKai: (filePath) => ipcRenderer.invoke('editor:reloadKai', filePath)
  }
};

// Since contextIsolation is disabled, directly assign to window
window.kaiAPI = api;