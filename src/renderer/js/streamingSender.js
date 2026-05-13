/**
 * Streaming Sender - Broadcasts the karaoke canvas + PA audio to browser viewers via WebRTC.
 *
 * One renderer-side instance holds a Map<viewerId, RTCPeerConnection>. Each browser tab
 * that opens the /viewer page (after admin auth) becomes a viewer with its own peer
 * connection. The web server brokers signaling between this sender and each viewer
 * over Socket.IO.
 *
 * Separate from webrtcManager.js (which handles the single Electron canvas window).
 * Both can run simultaneously.
 */

const ICE_SERVERS = []; // LAN-only by default; the web server is reachable so direct ICE works

export class StreamingSender {
  constructor() {
    /** @type {Map<string, RTCPeerConnection>} */
    this.peers = new Map();
    /** @type {Map<string, Array>} ICE candidates queued before remote description is set */
    this.pendingICE = new Map();

    this.canvasStream = null;
    this.audioStream = null;

    this._listenersBound = false;
  }

  /** Lazily capture the karaoke canvas video + PA bus audio. */
  ensureSourceStreams() {
    if (!this.canvasStream) {
      const canvas = document.getElementById('karaokeCanvas');
      if (!canvas) throw new Error('karaokeCanvas not found');
      this.canvasStream = canvas.captureStream(60);
      console.log(
        '[stream-sender] captured karaokeCanvas, video tracks:',
        this.canvasStream.getVideoTracks().length
      );
    }

    if (!this.audioStream) {
      // KAIPlayer is exposed via window.app.player.kaiPlayer (see ElectronBridge.js)
      const paStream = window.app?.player?.kaiPlayer?.getPAStream?.();
      if (paStream) {
        this.audioStream = paStream;
        console.log(
          '[stream-sender] grabbed PA stream, audio tracks:',
          paStream.getAudioTracks().length
        );
      } else {
        console.warn('[stream-sender] 🔇 No PA stream; viewers will get video only');
      }
    }
  }

  /** Wire up IPC listeners for signaling events from the web server. Idempotent. */
  bindSignalingListeners() {
    if (this._listenersBound) return;
    if (!window.kaiAPI?.streaming) {
      console.error('[stream-sender] streaming IPC bridge not exposed');
      return;
    }

    window.kaiAPI.streaming.onViewerJoin(({ viewerId }) => {
      console.log('[stream-sender] viewer joined:', viewerId);
      this.handleViewerJoin(viewerId);
    });
    window.kaiAPI.streaming.onViewerAnswer(({ viewerId, answer }) => {
      console.log('[stream-sender] received answer from', viewerId);
      this.handleViewerAnswer(viewerId, answer);
    });
    window.kaiAPI.streaming.onViewerICE(({ viewerId, candidate }) => {
      this.handleViewerICE(viewerId, candidate);
    });
    window.kaiAPI.streaming.onViewerLeave(({ viewerId }) => {
      console.log('[stream-sender] viewer left:', viewerId);
      this.cleanupViewer(viewerId);
    });

    this._listenersBound = true;
    console.log('[stream-sender] signaling listeners bound');
  }

  /** A new viewer joined — build a peer connection, attach tracks, send an offer. */
  async handleViewerJoin(viewerId) {
    try {
      this.ensureSourceStreams();

      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 4,
        bundlePolicy: 'balanced',
        rtcpMuxPolicy: 'require',
      });

      this.peers.set(viewerId, pc);
      this.pendingICE.set(viewerId, []);

      // Video track from canvas
      let videoSender = null;
      let videoTransceiver = null;
      this.canvasStream.getVideoTracks().forEach((track) => {
        const tx = pc.addTransceiver(track, {
          direction: 'sendonly',
          streams: [this.canvasStream],
        });
        videoSender = tx.sender;
        videoTransceiver = tx;
      });

      // Prefer H.264 baseline (hardware decode on virtually every device —
      // phone GPUs, smart-TV browsers, Steam Deck). Fall back to VP8.
      if (videoTransceiver && typeof videoTransceiver.setCodecPreferences === 'function') {
        try {
          const caps = RTCRtpSender.getCapabilities('video');
          const preferred = (caps?.codecs ?? [])
            .filter((c) => {
              if (
                c.mimeType.includes('H264') &&
                c.sdpFmtpLine?.includes('profile-level-id=42e01f')
              ) {
                return true;
              }
              if (c.mimeType.includes('VP8')) return true;
              return false;
            })
            .sort((a, _b) => (a.mimeType.includes('H264') ? -1 : 1));
          if (preferred.length > 0) {
            videoTransceiver.setCodecPreferences(preferred);
            console.log(
              '[stream-sender] preferred codecs:',
              preferred.map((c) => c.mimeType).join(', ')
            );
          }
        } catch (err) {
          console.warn('[stream-sender] codec preference failed:', err);
        }
      }

      // Audio track from PA bus
      if (this.audioStream) {
        this.audioStream.getAudioTracks().forEach((track) => {
          pc.addTransceiver(track, { direction: 'sendonly', streams: [this.audioStream] });
        });
      }

      // Apply video encoding parameters. getParameters() before negotiation
      // can return an empty `encodings` array — retry after negotiation
      // settles. The peers-map guard prevents these timers from running
      // after the viewer has disconnected.
      const applyVideoEncoding = async () => {
        if (!this.peers.has(viewerId)) return;
        if (!videoSender) return;
        try {
          const params = videoSender.getParameters();
          params.degradationPreference = 'maintain-resolution';
          if (params.encodings?.length) {
            // High ceiling for LAN viewers; WebRTC's bandwidth estimator
            // will adapt downward automatically for any viewer on a worse
            // path (cellular, congested WiFi, slow Ethernet, etc.).
            // No min-bitrate floor — would force quality loss to fail
            // instead of degrade on poor links.
            params.encodings[0].maxBitrate = 25_000_000; // 25 Mbps
            params.encodings[0].maxFramerate = 60;
            params.encodings[0].scaleResolutionDownBy = 1.0;
          }
          await videoSender.setParameters(params);
        } catch (err) {
          console.warn(`[stream-sender] setParameters for ${viewerId} failed:`, err.message);
        }
      };
      applyVideoEncoding();
      setTimeout(applyVideoEncoding, 2000);
      setTimeout(applyVideoEncoding, 5000);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          window.kaiAPI.streaming.sendViewerICE({
            viewerId,
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            },
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed' ||
          pc.connectionState === 'disconnected'
        ) {
          this.cleanupViewer(viewerId);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      window.kaiAPI.streaming.sendViewerOffer({
        viewerId,
        offer: { type: offer.type, sdp: offer.sdp },
      });
    } catch (err) {
      console.error(`Failed to handle viewer join (${viewerId}):`, err);
      this.cleanupViewer(viewerId);
    }
  }

  async handleViewerAnswer(viewerId, answer) {
    const pc = this.peers.get(viewerId);
    if (!pc) {
      console.warn(`Answer for unknown viewer ${viewerId}`);
      return;
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      // Drain any ICE candidates that arrived before the remote description was set
      const queue = this.pendingICE.get(viewerId) ?? [];
      for (const candidate of queue) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Queued ICE add failed:', err);
        }
      }
      this.pendingICE.set(viewerId, []);
    } catch (err) {
      console.error(`Failed to set answer for ${viewerId}:`, err);
      this.cleanupViewer(viewerId);
    }
  }

  async handleViewerICE(viewerId, candidate) {
    const pc = this.peers.get(viewerId);
    if (!pc) return;

    if (!pc.remoteDescription) {
      this.pendingICE.get(viewerId)?.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn(`Failed to add ICE for ${viewerId}:`, err);
    }
  }

  cleanupViewer(viewerId) {
    const pc = this.peers.get(viewerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        // already closed
      }
      this.peers.delete(viewerId);
    }
    this.pendingICE.delete(viewerId);
  }

  cleanupAll() {
    for (const viewerId of this.peers.keys()) {
      this.cleanupViewer(viewerId);
    }

    if (this.canvasStream) {
      this.canvasStream.getTracks().forEach((t) => t.stop());
      this.canvasStream = null;
    }
    // audioStream is owned by kaiPlayer — don't stop its tracks
    this.audioStream = null;
  }

  getStats() {
    return {
      viewerCount: this.peers.size,
      viewers: Array.from(this.peers.entries()).map(([id, pc]) => ({
        id,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
      })),
    };
  }
}

const streamingSender = new StreamingSender();
export default streamingSender;
