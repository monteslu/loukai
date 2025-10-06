/**
 * Canvas Window Application Logic
 * Handles WebRTC receiver and video display
 */

import webrtcManager from './webrtcManager.js';
import { getWindowDimensions, getWindowWidth, getWindowHeight } from './utils/window-dimensions.js';
import { onWindowResize, onWindowLoad, onWindowFocus, onWindowBlur } from './utils/window-events.js';

const { ipcRenderer } = require('electron');
const video = document.getElementById('video');
let isReceivingStream = false;

function maintainAspectRatio() {
    const { width: windowWidth, height: windowHeight } = getWindowDimensions();
    const aspectRatio = 16 / 9;

    let newWidth, newHeight;

    if (windowWidth / windowHeight > aspectRatio) {
        // Window is too wide
        newHeight = windowHeight;
        newWidth = windowHeight * aspectRatio;
    } else {
        // Window is too tall
        newWidth = windowWidth;
        newHeight = windowWidth / aspectRatio;
    }

    video.style.width = newWidth + 'px';
    video.style.height = newHeight + 'px';
}

// Initial sizing
maintainAspectRatio();

// Listen for window resize
onWindowResize(maintainAspectRatio);

// Listen for load event to ensure proper sizing
onWindowLoad(maintainAspectRatio);

// WebRTC IPC handlers - call webrtcManager receiver methods
ipcRenderer.on('webrtc:setupReceiver', async () => {
    const result = await webrtcManager.setupReceiver();
    ipcRenderer.send('webrtc:setupReceiver-response', result);
});

ipcRenderer.on('webrtc:setOfferAndCreateAnswer', async (event, offer) => {
    const result = await webrtcManager.setOfferAndCreateAnswer(offer);
    ipcRenderer.send('webrtc:setOfferAndCreateAnswer-response', result);
});

ipcRenderer.on('webrtc:addReceiverICECandidate', async (event, candidate) => {
    await webrtcManager.addReceiverICECandidate(candidate);
});

ipcRenderer.on('webrtc:getReceiverStatus', () => {
    const status = webrtcManager.getReceiverStatus();
    ipcRenderer.send('webrtc:getReceiverStatus-response', status);
});

ipcRenderer.on('webrtc:checkReceiverReady', () => {
    const status = webrtcManager.checkReceiverReady();
    ipcRenderer.send('webrtc:checkReceiverReady-response', status);
});

ipcRenderer.on('webrtc:cleanupReceiver', async () => {
    await webrtcManager.cleanupReceiver();
});

// Fullscreen functionality
let isFullscreen = false;

const toggleFullscreen = async () => {
    console.log('Toggling fullscreen, current state:', !!document.fullscreenElement);

    try {
        if (!document.fullscreenElement) {
            // Enter fullscreen - use the browser's native Fullscreen API
            await video.requestFullscreen();
            isFullscreen = true;
            console.log('✅ Entered fullscreen mode');
        } else {
            // Exit fullscreen
            await document.exitFullscreen();
            isFullscreen = false;
            console.log('✅ Exited fullscreen mode');
        }
    } catch (error) {
        console.error('❌ Fullscreen toggle failed:', error);
    }
};

// Click handler for video
video.addEventListener('click', toggleFullscreen);

// Keyboard handlers
document.addEventListener('keydown', (e) => {
    // Allow copy/paste and other system shortcuts to work normally
    if (e.ctrlKey || e.metaKey) {
        console.log('Allowing system shortcut:', e.key);
        return; // Don't prevent default for system shortcuts
    }

    // Fullscreen toggle keys
    if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        if (isFullscreen) {
            toggleFullscreen();
        }
    }
});

// Make sure video doesn't capture focus inappropriately but allow clicks
video.style.outline = 'none';
video.tabIndex = -1; // Remove from tab order
video.style.cursor = 'pointer'; // Show it's clickable

// Handle visibility changes
document.addEventListener('visibilitychange', () => {
    console.log('👁️ Visibility changed:', document.hidden ? 'hidden' : 'visible');
});

// Handle fullscreen changes
document.addEventListener('fullscreenchange', () => {
    isFullscreen = !!document.fullscreenElement;
    console.log('🖥️ Fullscreen changed:', isFullscreen ? 'ENTERED' : 'EXITED');

    // Log stream status to help debug freezing
    if (video.srcObject) {
        const stream = video.srcObject;
        const tracks = stream.getVideoTracks();
        console.log('📺 Stream tracks after fullscreen change:', tracks.length);
        tracks.forEach((track, i) => {
            console.log('Track ' + i + ' enabled: ' + track.enabled + ' readyState: ' + track.readyState);
        });
    }
});

document.addEventListener('fullscreenerror', (error) => {
    console.error('❌ Fullscreen error:', error);
});

// Handle window focus/blur
onWindowFocus(() => {
    console.log('🎯 Window focused');
});

onWindowBlur(() => {
    console.log('😴 Window blurred');
});

// Video event handlers to debug stream issues
video.addEventListener('loadedmetadata', () => {
    console.log('🎬 Stream video metadata loaded:', video.videoWidth, 'x', video.videoHeight);

    // Check what the actual stream track settings are
    if (video.srcObject) {
        const stream = video.srcObject;
        const tracks = stream.getVideoTracks();
        if (tracks.length > 0) {
            const settings = tracks[0].getSettings();
            console.log('🔍 RECEIVED track settings:', settings.width, 'x', settings.height);

            if (settings.width !== 1920 || settings.height !== 1080) {
                console.error('❌ RECEIVED TRACK NOT 1080p! Got:', settings.width, 'x', settings.height);
            }
        }
    }

    maintainAspectRatio();

    if (!isReceivingStream) {
        isReceivingStream = true;
        console.log('📺 Started receiving WebRTC stream');
    }
});

video.addEventListener('playing', () => {
    console.log('▶️ Video started playing');
});

video.addEventListener('pause', () => {
    console.log('⏸️ Video paused');
});

video.addEventListener('ended', () => {
    console.log('⏹️ Video ended');
});

video.addEventListener('error', (e) => {
    console.error('❌ Video error:', e, video.error);
});

// Signal to main process that child window is ready for streaming
onWindowLoad(() => {
    console.log('Child window fully loaded, signaling ready for streaming');
    ipcRenderer.send('canvas:childReady');
});

console.log('📺 Child window WebRTC receiver script loaded');
