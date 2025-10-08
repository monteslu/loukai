/**
 * useWebRTC - WebRTC manager wrapper
 *
 * Wraps webrtcManager for streaming functionality
 */

import { useEffect, useRef } from 'react';

export function useWebRTC() {
  const webrtcManagerRef = useRef(null);

  useEffect(() => {
    async function loadWebRTC() {
      try {
        const module = await import('../../renderer/js/webrtcManager.js');
        webrtcManagerRef.current = module.default;
        console.log('✅ WebRTC manager loaded');

        // Setup IPC handlers for WebRTC commands from main process
        if (window.kaiAPI?.events) {
          setupIPCHandlers(webrtcManagerRef.current);
        }
      } catch (error) {
        console.error('❌ Failed to load WebRTC manager:', error);
      }
    }

    loadWebRTC();
  }, []);

  // Setup IPC handlers for WebRTC commands
  function setupIPCHandlers(manager) {
    if (!window.kaiAPI?.events) return;

    // Setup sender
    window.kaiAPI.events.on('webrtc:setupSender', async () => {
      const result = await manager.setupSender();
      if (window.kaiAPI?.renderer) {
        window.kaiAPI.renderer.sendWebRTCResponse('setupSender', result);
      }
    });

    // Create offer
    window.kaiAPI.events.on('webrtc:createOffer', async () => {
      const result = await manager.createOffer();
      if (window.kaiAPI?.renderer) {
        window.kaiAPI.renderer.sendWebRTCResponse('createOffer', result);
      }
    });

    // Set answer
    window.kaiAPI.events.on('webrtc:setAnswer', async (event, answer) => {
      const result = await manager.setAnswer(answer);
      if (window.kaiAPI?.renderer) {
        window.kaiAPI.renderer.sendWebRTCResponse('setAnswer', result);
      }
    });

    // Get sender status
    window.kaiAPI.events.on('webrtc:getSenderStatus', () => {
      const result = manager.getSenderStatus();
      if (window.kaiAPI?.renderer) {
        window.kaiAPI.renderer.sendWebRTCResponse('getSenderStatus', result);
      }
    });

    // Add ICE candidate
    window.kaiAPI.events.on('webrtc:addICECandidate', async (event, candidate) => {
      await manager.addICECandidate(candidate);
    });

    // Cleanup sender
    window.kaiAPI.events.on('webrtc:cleanupSender', async () => {
      await manager.cleanupSender();
    });

    console.log('✅ Main window WebRTC IPC handlers registered');
  }

  const setupSender = async () => {
    if (!webrtcManagerRef.current) return null;
    return await webrtcManagerRef.current.setupSender();
  };

  const createOffer = async () => {
    if (!webrtcManagerRef.current) return null;
    return await webrtcManagerRef.current.createOffer();
  };

  const setAnswer = async (answer) => {
    if (!webrtcManagerRef.current) return null;
    return await webrtcManagerRef.current.setAnswer(answer);
  };

  const stopPainting = () => {
    if (!webrtcManagerRef.current) return;
    webrtcManagerRef.current.stopPainting();
  };

  const getSenderStatus = () => {
    if (!webrtcManagerRef.current) return null;
    return webrtcManagerRef.current.getSenderStatus();
  };

  const addICECandidate = async (candidate) => {
    if (!webrtcManagerRef.current) return;
    await webrtcManagerRef.current.addICECandidate(candidate);
  };

  const cleanupSender = async () => {
    if (!webrtcManagerRef.current) return;
    await webrtcManagerRef.current.cleanupSender();
  };

  return {
    setupSender,
    createOffer,
    setAnswer,
    stopPainting,
    getSenderStatus,
    addICECandidate,
    cleanupSender,
  };
}
