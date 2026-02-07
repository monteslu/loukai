/**
 * Canvas App - WebRTC receiver for canvas window
 * Handles receiving and displaying the karaoke canvas stream
 */

// Access the preloaded API (exposed via contextBridge with contextIsolation enabled)
const { webrtc } = window.kaiAPI;

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
  webrtc.onSetupReceiver(async () => {
    const result = await webrtcManager.setupReceiver();
    webrtc.sendSetupReceiverResponse(result);
  });

  // Check receiver ready
  webrtc.onCheckReceiverReady(() => {
    const result = webrtcManager.checkReceiverReady();
    webrtc.sendCheckReceiverReadyResponse(result);
  });

  // Set offer and create answer
  webrtc.onSetOfferAndCreateAnswer(async (event, offer) => {
    const result = await webrtcManager.setOfferAndCreateAnswer(offer);
    webrtc.sendSetOfferAndCreateAnswerResponse(result);
  });

  // Get receiver status
  webrtc.onGetReceiverStatus(() => {
    const result = webrtcManager.getReceiverStatus();
    webrtc.sendGetReceiverStatusResponse(result);
  });

  // Add ICE candidate
  webrtc.onAddReceiverICECandidate(async (event, candidate) => {
    await webrtcManager.addReceiverICECandidate(candidate);
  });

  // Cleanup receiver
  webrtc.onCleanupReceiver(async () => {
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
  webrtc.sendChildReady();
  console.log('📢 Sent canvas:childReady signal to main process');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
