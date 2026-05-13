import { log } from '../logger.js';
import { ipcMain, shell } from 'electron';

/**
 * Streaming IPC Handlers
 *
 * Bridges signaling between the embedded web server's Socket.IO (admin-authed
 * `viewer-clients` room) and the renderer-side StreamingSender. Also exposes a
 * helper for opening the viewer URL in the system browser.
 */

/**
 * Register all streaming-related IPC handlers.
 * @param {Object} mainApp - Main application instance
 */
export function registerStreamingHandlers(mainApp) {
  // Compute the URL the admin should open to view the stream.
  const getViewerUrl = () => {
    const port = mainApp.webServer?.port;
    if (!port) return null;
    // Use loopback by default; admin can manually substitute the LAN IP when
    // pointing a TV/phone browser at this URL.
    return `http://localhost:${port}/viewer`;
  };

  ipcMain.handle('streaming:getViewerUrl', () => {
    return { url: getViewerUrl() };
  });

  ipcMain.handle('streaming:openViewer', async () => {
    const url = getViewerUrl();
    if (!url) {
      return { success: false, error: 'Web server not running' };
    }
    try {
      await shell.openExternal(url);
      return { success: true, url };
    } catch (err) {
      log('Failed to open viewer URL:', err);
      return { success: false, error: err.message };
    }
  });

  // Renderer → web server: forward an offer to a specific viewer socket
  ipcMain.handle('streaming:sendViewerOffer', (_event, { viewerId, offer }) => {
    mainApp.webServer?.sendToViewer?.(viewerId, 'viewer:offer', { offer });
  });

  // Renderer → web server: forward an ICE candidate to a specific viewer socket
  ipcMain.handle('streaming:sendViewerICE', (_event, { viewerId, candidate }) => {
    mainApp.webServer?.sendToViewer?.(viewerId, 'viewer:ice', { candidate });
  });

  // Stats for debugging
  ipcMain.handle('streaming:getStats', () => {
    const count = mainApp.webServer?.getViewerCount?.() ?? 0;
    return { viewerCount: count };
  });
}

/**
 * Forward signaling events from the web server (called from webServer.js
 * when a viewer socket sends an event) to the main renderer where the
 * StreamingSender lives.
 */
export function forwardViewerEvent(mainApp, event, payload) {
  if (mainApp.mainWindow && !mainApp.mainWindow.isDestroyed()) {
    mainApp.mainWindow.webContents.send(`streaming:${event}`, payload);
  }
}
