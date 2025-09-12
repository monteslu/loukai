const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const AudioEngine = require('./audioEngine');
const KaiLoader = require('../utils/kaiLoader');
const KaiWriter = require('../utils/kaiWriter');

class KaiPlayerApp {
  constructor() {
    this.mainWindow = null;
    this.audioEngine = null;
    this.currentSong = null;
    this.isDev = process.argv.includes('--dev');
  }

  async initialize() {
    await app.whenReady();
    this.createMainWindow();
    this.createApplicationMenu();
    this.setupIPC();
    this.initializeAudioEngine();
  }

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: path.join(__dirname, 'preload.js')
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#1a1a1a',
        symbolColor: '#ffffff'
      }
    });

    const rendererPath = path.join(__dirname, '../renderer/index.html');
    this.mainWindow.loadFile(rendererPath);

    if (this.isDev) {
      this.mainWindow.webContents.openDevTools();
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      if (this.audioEngine) {
        this.audioEngine.stop();
      }
    });
  }

  createApplicationMenu() {
    const template = [
      {
        label: 'File',
        submenu: [
          {
            label: 'Open KAI File...',
            accelerator: 'CmdOrCtrl+O',
            click: async () => {
              const result = await dialog.showOpenDialog(this.mainWindow, {
                filters: [
                  { name: 'KAI Files', extensions: ['kai'] }
                ],
                properties: ['openFile']
              });

              if (!result.canceled && result.filePaths.length > 0) {
                await this.loadKaiFile(result.filePaths[0]);
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: () => {
              app.quit();
            }
          }
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                focusedWindow.reload();
              }
            }
          },
          {
            label: 'Toggle Developer Tools',
            accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                focusedWindow.webContents.toggleDevTools();
              }
            }
          },
          { type: 'separator' },
          {
            label: 'Actual Size',
            accelerator: 'CmdOrCtrl+0',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                focusedWindow.webContents.setZoomLevel(0);
              }
            }
          },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+Plus',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                const currentZoom = focusedWindow.webContents.getZoomLevel();
                focusedWindow.webContents.setZoomLevel(currentZoom + 0.5);
              }
            }
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: (item, focusedWindow) => {
              if (focusedWindow) {
                const currentZoom = focusedWindow.webContents.getZoomLevel();
                focusedWindow.webContents.setZoomLevel(currentZoom - 0.5);
              }
            }
          }
        ]
      }
    ];

    // macOS specific menu adjustments
    if (process.platform === 'darwin') {
      template.unshift({
        label: app.getName(),
        submenu: [
          {
            label: 'About ' + app.getName(),
            role: 'about'
          },
          { type: 'separator' },
          {
            label: 'Services',
            role: 'services',
            submenu: []
          },
          { type: 'separator' },
          {
            label: 'Hide ' + app.getName(),
            accelerator: 'Command+H',
            role: 'hide'
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Shift+H',
            role: 'hideothers'
          },
          {
            label: 'Show All',
            role: 'unhide'
          },
          { type: 'separator' },
          {
            label: 'Quit',
            accelerator: 'Command+Q',
            click: () => {
              app.quit();
            }
          }
        ]
      });

      // Window menu for macOS
      template.push({
        label: 'Window',
        submenu: [
          {
            label: 'Minimize',
            accelerator: 'CmdOrCtrl+M',
            role: 'minimize'
          },
          {
            label: 'Close',
            accelerator: 'CmdOrCtrl+W',
            role: 'close'
          }
        ]
      });
    }

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  initializeAudioEngine() {
    try {
      this.audioEngine = new AudioEngine();
      this.audioEngine.initialize();
      
      this.audioEngine.on('xrun', (count) => {
        this.sendToRenderer('audio:xrun', count);
      });

      this.audioEngine.on('latencyUpdate', (latency) => {
        this.sendToRenderer('audio:latency', latency);
      });

      this.audioEngine.on('mixChanged', (mixState) => {
        this.sendToRenderer('mixer:state', mixState);
      });

    } catch (error) {
      console.error('Failed to initialize audio engine:', error);
    }
  }

  setupIPC() {
    ipcMain.handle('app:getVersion', () => {
      return app.getVersion();
    });

    ipcMain.handle('file:openKai', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        filters: [
          { name: 'KAI Files', extensions: ['kai'] }
        ],
        properties: ['openFile']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return await this.loadKaiFile(result.filePaths[0]);
      }
      return null;
    });

    ipcMain.handle('audio:getDevices', () => {
      return this.audioEngine ? this.audioEngine.getDevices() : [];
    });

    ipcMain.handle('audio:enumerateDevices', async () => {
      // This will be called from renderer to get real device list
      return [];
    });

    ipcMain.handle('audio:setDevice', (event, deviceType, deviceId) => {
      if (this.audioEngine) {
        return this.audioEngine.setDevice(deviceType, deviceId);
      }
      return false;
    });

    ipcMain.handle('mixer:toggleMute', (event, stemId, bus) => {
      if (this.audioEngine) {
        return this.audioEngine.toggleMute(stemId, bus);
      }
      return false;
    });

    ipcMain.handle('mixer:toggleSolo', (event, stemId) => {
      if (this.audioEngine) {
        return this.audioEngine.toggleSolo(stemId);
      }
      return false;
    });

    ipcMain.handle('mixer:setGain', (event, stemId, gainDb) => {
      if (this.audioEngine) {
        return this.audioEngine.setGain(stemId, gainDb);
      }
      return false;
    });

    ipcMain.handle('mixer:applyPreset', (event, presetId) => {
      if (this.audioEngine) {
        return this.audioEngine.applyPreset(presetId);
      }
      return false;
    });

    ipcMain.handle('mixer:recallScene', (event, sceneId) => {
      if (this.audioEngine) {
        return this.audioEngine.recallScene(sceneId);
      }
      return false;
    });

    ipcMain.handle('player:play', () => {
      if (this.audioEngine) {
        return this.audioEngine.play();
      }
      return false;
    });

    ipcMain.handle('player:pause', () => {
      if (this.audioEngine) {
        return this.audioEngine.pause();
      }
      return false;
    });

    ipcMain.handle('player:seek', (event, positionSec) => {
      if (this.audioEngine) {
        return this.audioEngine.seek(positionSec);
      }
      return false;
    });

    ipcMain.handle('autotune:setEnabled', (event, enabled) => {
      if (this.audioEngine) {
        return this.audioEngine.setAutotuneEnabled(enabled);
      }
      return false;
    });

    ipcMain.handle('autotune:setSettings', (event, settings) => {
      if (this.audioEngine) {
        return this.audioEngine.setAutotuneSettings(settings);
      }
      return false;
    });

    ipcMain.handle('editor:saveKai', async (event, kaiData, originalPath) => {
      try {
        console.log('Save KAI file request:', originalPath);
        console.log('Updated lyrics:', kaiData.lyrics.length, 'lines');
        
        // Use KaiWriter to save the updated lyrics back to the KAI file
        const result = await KaiWriter.save(kaiData, originalPath);
        
        if (result.success) {
          console.log('KAI file saved successfully');
          return { success: true };
        } else {
          console.error('Failed to save KAI file:', result.error);
          return { success: false, error: result.error };
        }
      } catch (error) {
        console.error('Failed to save KAI file:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('editor:reloadKai', async (event, filePath) => {
      try {
        console.log('Reload KAI file request:', filePath);
        
        // Reload the KAI file using the existing loadKaiFile method
        const result = await this.loadKaiFile(filePath);
        
        if (result && result.success) {
          console.log('KAI file reloaded successfully');
          return { success: true };
        } else {
          console.error('Failed to reload KAI file');
          return { success: false, error: 'Failed to reload file' };
        }
      } catch (error) {
        console.error('Failed to reload KAI file:', error);
        return { success: false, error: error.message };
      }
    });
  }

  async loadKaiFile(filePath) {
    try {
      const kaiData = await KaiLoader.load(filePath);
      
      // Add original file path to the song data
      kaiData.originalFilePath = filePath;
      
      if (this.audioEngine) {
        await this.audioEngine.loadSong(kaiData);
      }
      
      this.currentSong = kaiData;
      console.log('Sending to renderer:', {
        metadata: kaiData.metadata,
        hasMetadata: !!kaiData.metadata
      });
      this.sendToRenderer('song:loaded', kaiData.metadata || {});
      this.sendToRenderer('song:data', kaiData);
      
      return {
        success: true,
        metadata: kaiData.metadata,
        meta: kaiData.meta,
        stems: kaiData.audio.sources
      };
    } catch (error) {
      console.error('Failed to load KAI file:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  sendToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}

const kaiApp = new KaiPlayerApp();

app.on('window-all-closed', () => {
  // Quit the app when all windows are closed, even on macOS
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    kaiApp.createMainWindow();
  }
});

kaiApp.initialize().catch(console.error);