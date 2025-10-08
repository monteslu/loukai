/**
 * Canvas App - WebRTC receiver for canvas window
 * Handles receiving and displaying the karaoke canvas stream
 */

// Note: Using CommonJS require since nodeIntegration is enabled in canvas window
const { ipcRenderer } = require('electron');

// Dynamically import ES module
let WebRTCManager;

// Will be set after WebRTCManager is loaded
let webrtcManager = null;

// Setup IPC handlers for WebRTC commands from main process
function setupIPCHandlers() {
  if (!webrtcManager) {
    console.error('❌ WebRTC manager not loaded yet');
    return;
  }
  // Setup receiver
  ipcRenderer.on('webrtc:setupReceiver', async () => {
    const result = await webrtcManager.setupReceiver();
    ipcRenderer.send('webrtc:setupReceiver-response', result);
  });

  // Check receiver ready
  ipcRenderer.on('webrtc:checkReceiverReady', () => {
    const result = webrtcManager.checkReceiverReady();
    ipcRenderer.send('webrtc:checkReceiverReady-response', result);
  });

  // Set offer and create answer
  ipcRenderer.on('webrtc:setOfferAndCreateAnswer', async (event, offer) => {
    const result = await webrtcManager.setOfferAndCreateAnswer(offer);
    ipcRenderer.send('webrtc:setOfferAndCreateAnswer-response', result);
  });

  // Get receiver status
  ipcRenderer.on('webrtc:getReceiverStatus', () => {
    const result = webrtcManager.getReceiverStatus();
    ipcRenderer.send('webrtc:getReceiverStatus-response', result);
  });

  // Add ICE candidate
  ipcRenderer.on('webrtc:addReceiverICECandidate', async (event, candidate) => {
    await webrtcManager.addReceiverICECandidate(candidate);
  });

  // Cleanup receiver
  ipcRenderer.on('webrtc:cleanupReceiver', async () => {
    await webrtcManager.cleanupReceiver();
  });

  console.log('✅ Canvas window IPC handlers registered');
}

// Setup receiver when DOM is ready
async function init() {
  console.log('🎬 Canvas window initializing...');

  // Load WebRTC manager
  try {
    const module = await import('./webrtcManager.js');
    WebRTCManager = module.WebRTCManager;
    webrtcManager = new WebRTCManager();
    window.webrtcManager = webrtcManager;
    console.log('✅ WebRTC manager loaded');
  } catch (error) {
    console.error('❌ Failed to load WebRTC manager:', error);
    return;
  }

  // Setup IPC handlers
  setupIPCHandlers();

  // Handle fullscreen on video click
  const video = document.getElementById('video');
  if (video) {
    // Disable context menu (right-click)
    video.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    // Handle fullscreen toggle on click
    video.addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) {
          await video.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (error) {
        console.error('Fullscreen toggle failed:', error);
      }
    });

    // Ensure controls are never shown
    video.controls = false;
    video.removeAttribute('controls');
  }

  // Signal to main process that canvas window is ready
  ipcRenderer.send('canvas:childReady');
  console.log('📢 Sent canvas:childReady signal to main process');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
