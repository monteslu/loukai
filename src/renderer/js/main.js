class KaiPlayerApp {
    constructor() {
        this.currentSong = null;
        this.isPlaying = false;
        this.currentPosition = 0;
        this.devices = [];
        
        this.mixer = null;
        this.player = null;
        this.coaching = null;
        this.audioEngine = null;
        
        // Device preferences
        this.devicePreferences = {
            PA: null,
            IEM: null,
            input: null
        };
        
        this.init();
    }

    async init() {
        await this.setupEventListeners();
        await this.loadAudioDevices();
        this.setupTabs();
        this.setupKeyboardShortcuts();
        
        this.audioEngine = new RendererAudioEngine();
        await this.audioEngine.initialize();
        
        // Set up callback for when songs end
        this.audioEngine.setOnSongEndedCallback(() => {
            this.handleSongEnded();
        });
        
        // Now that audio engine is ready, restore device selections
        await this.restoreDeviceSelections();
        
        this.mixer = new MixerController(this.audioEngine);
        this.player = new PlayerController(this.audioEngine);
        this.coaching = new CoachingController();
        this.editor = new LyricsEditorController();
        
        this.updateStatus('Ready');
        
        const version = await kaiAPI.app.getVersion();
        console.log(`KAI Player v${version} initialized`);
    }

    async setupEventListeners() {
        document.getElementById('loadKaiBtn').addEventListener('click', () => {
            this.loadKaiFile();
        });

        document.getElementById('refreshDevicesBtn').addEventListener('click', () => {
            this.loadAudioDevices();
        });

        document.getElementById('songInfoBtn').addEventListener('click', () => {
            this.showSongInfo();
        });

        document.getElementById('closeSongInfoBtn').addEventListener('click', () => {
            document.getElementById('songInfoModal').style.display = 'none';
        });

        // Close modal when clicking outside
        document.getElementById('songInfoModal').addEventListener('click', (e) => {
            if (e.target.id === 'songInfoModal') {
                document.getElementById('songInfoModal').style.display = 'none';
            }
        });

        document.getElementById('playPauseBtn').addEventListener('click', () => {
            this.togglePlayback();
        });


        document.getElementById('seekBackBtn').addEventListener('click', () => {
            this.seekRelative(-10);
        });

        document.getElementById('seekForwardBtn').addEventListener('click', () => {
            this.seekRelative(10);
        });

        document.getElementById('paDeviceSelect').addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            kaiAPI.audio.setDevice('PA', parseInt(deviceId));
            
            // Save device preference
            this.saveDevicePreference('PA', deviceId);
            
            // Also set device on renderer audio engine
            if (this.audioEngine && this.audioEngine.setOutputDevice) {
                await this.audioEngine.setOutputDevice('PA', deviceId);
            }
        });

        document.getElementById('iemDeviceSelect').addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            kaiAPI.audio.setDevice('IEM', parseInt(deviceId));
            
            // Save device preference
            this.saveDevicePreference('IEM', deviceId);
            
            // Also set device on renderer audio engine
            if (this.audioEngine && this.audioEngine.setOutputDevice) {
                await this.audioEngine.setOutputDevice('IEM', deviceId);
            }
        });

        document.getElementById('inputDeviceSelect').addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            console.log('Input device selected:', deviceId);
            
            // Start microphone input with selected device
            if (this.audioEngine && deviceId !== '') {
                await this.audioEngine.startMicrophoneInput(deviceId);
            }
            
            // Save device preference
            this.saveDevicePreference('input', deviceId);
        });

        document.getElementById('sceneABtn').addEventListener('click', () => {
            this.recallScene('A');
        });

        document.getElementById('sceneBBtn').addEventListener('click', () => {
            this.recallScene('B');
        });

        document.getElementById('saveSceneBtn').addEventListener('click', () => {
            this.saveCurrentScene();
        });

        document.getElementById('autotuneEnabled').addEventListener('change', (e) => {
            kaiAPI.autotune.setEnabled(e.target.checked);
        });

        document.getElementById('autotuneStrength').addEventListener('input', (e) => {
            const value = e.target.value;
            document.querySelector('#autotuneStrength + .slider-value').textContent = `${value}%`;
            this.updateAutotuneSettings();
        });

        document.getElementById('autotuneSpeed').addEventListener('input', (e) => {
            const value = e.target.value;
            document.querySelector('#autotuneSpeed + .slider-value').textContent = value;
            this.updateAutotuneSettings();
        });

        kaiAPI.song.onLoaded((event, metadata) => {
            this.onSongLoaded(metadata);
        });

        kaiAPI.audio.onXRun((event, count) => {
            document.getElementById('xrunDisplay').textContent = `XRuns: ${count}`;
        });

        kaiAPI.audio.onLatencyUpdate((event, latency) => {
            document.getElementById('latencyDisplay').textContent = `Latency: ${latency.toFixed(1)} ms`;
        });

        kaiAPI.mixer.onStateChange((event, state) => {
            if (this.mixer) {
                this.mixer.updateState(state);
            }
        });

        kaiAPI.song.onData((event, songData) => {
            console.log('Received song data in renderer');
            this.currentSong = songData;
            
            // Immediately pass lyrics to player if available
            if (this.player && songData.lyrics) {
                const fullMetadata = {
                    title: songData.metadata?.title || 'Unknown',
                    artist: songData.metadata?.artist || 'Unknown',
                    lyrics: songData.lyrics,
                    duration: songData.metadata?.duration || 0
                };
                this.player.onSongLoaded(fullMetadata);
            }
            
            // Load song data into editor
            if (this.editor && this.currentSong) {
                console.log('Main calling editor.onSongLoaded with currentSong:', this.currentSong);
                this.editor.onSongLoaded(this.currentSong);
            }
            
            if (this.audioEngine) {
                this.audioEngine.loadSong(songData).then(() => {
                    console.log('Audio engine loaded song successfully');
                }).catch(error => {
                    console.error('Failed to load song in audio engine:', error);
                });
            }
        });
    }

    async loadAudioDevices() {
        try {
            // Load saved device preferences
            this.loadDevicePreferences();
            
            // First try to enumerate real devices from renderer process
            const realDevices = await this.enumerateRealDevices();
            if (realDevices.length > 0) {
                this.devices = realDevices;
            } else {
                // Fallback to main process devices
                this.devices = await kaiAPI.audio.getDevices();
            }
            this.populateDeviceSelectors();
            
            // Don't restore device selections here - wait for audio engine to be ready
        } catch (error) {
            console.error('Failed to load audio devices:', error);
            this.updateStatus('Error loading audio devices');
        }
    }

    async enumerateRealDevices() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                console.warn('MediaDevices API not available');
                return [];
            }

            // Request permission first
            await navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    stream.getTracks().forEach(track => track.stop());
                })
                .catch(err => {
                    console.warn('Microphone permission denied:', err);
                });

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevices = [];
            
            devices.forEach((device, index) => {
                if (device.kind === 'audiooutput' || device.kind === 'audioinput') {
                    audioDevices.push({
                        id: device.deviceId,
                        name: device.label || `${device.kind === 'audiooutput' ? 'Speaker' : 'Microphone'} ${index + 1}`,
                        maxInputChannels: device.kind === 'audioinput' ? 2 : 0,
                        maxOutputChannels: device.kind === 'audiooutput' ? 2 : 0,
                        defaultSampleRate: 48000,
                        hostApi: 'Web Audio API',
                        deviceKind: device.kind,
                        groupId: device.groupId
                    });
                }
            });
            
            console.log(`Found ${audioDevices.length} real audio devices:`, 
                audioDevices.map(d => `${d.name} (${d.deviceKind})`));
            
            // Also update status to show device count
            this.updateStatus(`Found ${audioDevices.length} audio devices`);
            
            return audioDevices;
            
        } catch (error) {
            console.error('Failed to enumerate real audio devices:', error);
            return [];
        }
    }

    populateDeviceSelectors() {
        const selectors = [
            { id: 'paDeviceSelect', filter: 'output' },
            { id: 'iemDeviceSelect', filter: 'output' },
            { id: 'inputDeviceSelect', filter: 'input' }
        ];

        selectors.forEach(({ id, filter }) => {
            const select = document.getElementById(id);
            select.innerHTML = '<option value="">Select device...</option>';
            
            this.devices.forEach((device, index) => {
                let isCompatible = false;
                
                if (filter === 'output') {
                    isCompatible = (device.maxOutputChannels > 0) || (device.deviceKind === 'audiooutput');
                } else if (filter === 'input') {
                    isCompatible = (device.maxInputChannels > 0) || (device.deviceKind === 'audioinput');
                }
                
                if (isCompatible) {
                    const option = document.createElement('option');
                    option.value = device.id || index;
                    option.textContent = device.name;
                    select.appendChild(option);
                }
            });
        });
    }

    setupTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabPanes = document.querySelectorAll('.tab-pane');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                
                tabBtns.forEach(b => b.classList.remove('active'));
                tabPanes.forEach(p => p.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(`${targetTab}-tab`).classList.add('active');
            });
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                return;
            }

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlayback();
                    break;
                
                case 'v':
                case 'V':
                    if (e.ctrlKey || e.metaKey) {
                        this.toggleVocalsPA();
                    } else {
                        this.toggleVocalsGlobal();
                    }
                    break;
                
                case 'a':
                case 'A':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                    } else {
                        this.recallScene('A');
                    }
                    break;
                
                case 'b':
                case 'B':
                    this.recallScene('B');
                    break;
                
                case 's':
                case 'S':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.saveCurrentScene();
                    }
                    break;
                
                default:
                    if (e.key >= '1' && e.key <= '9') {
                        const stemIndex = parseInt(e.key) - 1;
                        if (e.shiftKey) {
                            this.toggleStemSolo(stemIndex);
                        } else {
                            this.toggleStemMute(stemIndex);
                        }
                    }
                    break;
            }
        });
    }

    async loadKaiFile() {
        try {
            this.updateStatus('Loading KAI file...');
            const result = await kaiAPI.file.openKai();
            
            if (result && result.success) {
                this.currentSong = result;
                this.setupPresets(result.stems);
                this.enableControls();
                this.updateStatus(`Loaded: ${result.metadata?.title || 'Unknown Song'}`);
            } else if (result) {
                this.updateStatus(`Error: ${result.error}`);
            }
        } catch (error) {
            console.error('Failed to load KAI file:', error);
            this.updateStatus('Error loading file');
        }
    }

    async onSongLoaded(metadata) {
        console.log('Frontend received metadata:', metadata);
        
        const title = metadata?.title || 'Unknown Song';
        const artist = metadata?.artist || 'Unknown Artist';
        
        document.querySelector('.song-title').textContent = title;
        document.querySelector('.song-artist').textContent = artist;
        
        // Enable song info button
        document.getElementById('songInfoBtn').disabled = false;
        
        if (this.audioEngine && this.currentSong) {
            await this.audioEngine.loadSong(this.currentSong);
        }
        
        if (this.player && this.currentSong) {
            // Pass full song data which includes lyrics and updated duration from audio engine
            const fullMetadata = {
                ...metadata,
                lyrics: this.currentSong.lyrics,
                duration: this.audioEngine ? this.audioEngine.getDuration() : (this.currentSong.metadata?.duration || 0)
            };
            console.log('Main.js passing duration to player:', fullMetadata.duration);
            this.player.onSongLoaded(fullMetadata);
        }
        
        if (this.coaching) {
            this.coaching.onSongLoaded(metadata || {});
        }
        
        if (this.editor && this.currentSong) {
            console.log('Main calling editor.onSongLoaded with currentSong:', this.currentSong);
            this.editor.onSongLoaded(this.currentSong);
        } else {
            console.log('Editor or currentSong missing:', !!this.editor, !!this.currentSong);
        }
        
        if (this.mixer && this.audioEngine) {
            this.mixer.updateFromAudioEngine();
        }
    }

    showSongInfo() {
        if (!this.currentSong) return;
        
        const modal = document.getElementById('songInfoModal');
        const content = document.getElementById('songInfoContent');
        
        const metadata = this.currentSong.metadata;
        const meta = this.currentSong.meta || {};
        
        // Extract filename from originalFilePath
        const filePath = this.currentSong.originalFilePath || '';
        const fileName = filePath ? filePath.split('/').pop().split('\\').pop() : 'Unknown';

        let html = `
            <div class="info-section">
                <h3>Song Details</h3>
                <div class="info-grid">
                    <div class="info-label">Title:</div>
                    <div class="info-value">${metadata.title}</div>
                    <div class="info-label">Artist:</div>
                    <div class="info-value">${metadata.artist}</div>
                    <div class="info-label">Album:</div>
                    <div class="info-value">${metadata.album || 'Unknown'}</div>
                    <div class="info-label">Duration:</div>
                    <div class="info-value">${this.formatTime(metadata.duration)}</div>
                    <div class="info-label">Key:</div>
                    <div class="info-value">${metadata.key}</div>
                    <div class="info-label">Tempo:</div>
                    <div class="info-value">${metadata.tempo} BPM</div>`;
        
        // Add comment if it exists
        if (metadata.comment && metadata.comment.trim()) {
            html += `
                    <div class="info-label">Comment:</div>
                    <div class="info-value" style="white-space: pre-wrap; max-width: 400px; word-wrap: break-word;">${metadata.comment}</div>`;
        }
        
        html += `
                </div>
            </div>
            
            <div class="info-section">
                <h3>File Information</h3>
                <div class="info-grid">
                    <div class="info-label">Filename:</div>
                    <div class="info-value">${fileName}</div>
                    <div class="info-label">Full Path:</div>
                    <div class="info-value" style="word-break: break-all; font-family: monospace; font-size: 0.9em;">${filePath || 'Unknown'}</div>
                </div>
            </div>
        `;
        
        // Add stems info
        if (this.currentSong.stems && this.currentSong.stems.length > 0) {
            html += `
                <div class="info-section">
                    <h3>Audio Stems</h3>
                    <div class="info-grid">
            `;
            this.currentSong.stems.forEach(stem => {
                html += `
                    <div class="info-label">${stem}:</div>
                    <div class="info-value">Available</div>
                `;
            });
            html += `</div></div>`;
        }
        
        // Add ID3 info if available and not excluded
        if (meta.id3 && meta.id3.include_raw !== false) {
            html += `
                <div class="info-section">
                    <h3>ID3 Metadata</h3>
                    <div class="processing-info">
                        <pre>${JSON.stringify(meta.id3, null, 2)}</pre>
                    </div>
                </div>
            `;
        }
        
        // Add processing info if available
        if (meta.processing) {
            html += `
                <div class="info-section">
                    <h3>Processing Information</h3>
                    <div class="processing-info">
                        <pre>${JSON.stringify(meta.processing, null, 2)}</pre>
                    </div>
                </div>
            `;
        }
        
        content.innerHTML = html;
        modal.style.display = 'flex';
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    setupPresets(stems) {
        const presetContainer = document.getElementById('presetButtons');
        presetContainer.innerHTML = '';
        
        const presets = [
            { id: 'original', name: 'Original' },
            { id: 'karaoke', name: 'Karaoke' },
            { id: 'band_only', name: 'Band Only' },
            { id: 'acoustic', name: 'Acoustic' }
        ];
        
        presets.forEach(preset => {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.textContent = preset.name;
            btn.addEventListener('click', () => {
                this.applyPreset(preset.id);
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            presetContainer.appendChild(btn);
        });
    }

    enableControls() {
        document.getElementById('playPauseBtn').disabled = false;
    }

    async togglePlayback() {
        if (!this.currentSong || !this.audioEngine) return;
        
        try {
            if (this.isPlaying) {
                await this.audioEngine.pause();
                this.isPlaying = false;
                this.updatePlayButton('▶');
                
                // Also pause the player controller
                if (this.player) {
                    await this.player.pause();
                }
            } else {
                await this.audioEngine.play();
                this.isPlaying = true;
                this.updatePlayButton('⏸');
                this.startPositionUpdater();
                
                // Also play the player controller
                if (this.player) {
                    await this.player.play();
                }
            }
        } catch (error) {
            console.error('Playback error:', error);
            this.updateStatus('Playback error');
        }
    }

    updatePlayButton(text) {
        const playButton = document.getElementById('playPauseBtn');
        if (playButton) {
            playButton.textContent = text;
        }
    }

    handleSongEnded() {
        console.log('Song ended - updating UI state');
        this.isPlaying = false;
        this.updatePlayButton('▶');
        
        // Also update the player controller's state
        if (this.player) {
            this.player.isPlaying = false;
            // Update karaoke renderer
            if (this.player.karaokeRenderer) {
                this.player.karaokeRenderer.setPlaying(false);
            }
        }
        
        // Update status
        this.updateStatus('Song ended');
    }

    async seekRelative(seconds) {
        if (!this.currentSong || !this.audioEngine) return;
        
        const newPosition = Math.max(0, this.audioEngine.getCurrentPosition() + seconds);
        await this.audioEngine.seek(newPosition);
    }

    startPositionUpdater() {
        if (this.positionTimer) return;
        
        this.positionTimer = setInterval(() => {
            if (this.isPlaying && this.audioEngine) {
                this.currentPosition = this.audioEngine.getCurrentPosition();
                
                if (this.player) {
                    this.player.currentPosition = this.currentPosition;
                }
                
                if (this.coaching) {
                    this.coaching.setPosition(this.currentPosition);
                }
                
                const duration = this.audioEngine.getDuration();
                if (this.currentPosition >= duration) {
                    this.isPlaying = false;
                    this.updatePlayButton('▶');
                    if (this.positionTimer) {
                        clearInterval(this.positionTimer);
                        this.positionTimer = null;
                    }
                }
            }
        }, 100);
    }

    async applyPreset(presetId) {
        if (this.audioEngine) {
            this.audioEngine.applyPreset(presetId);
            if (this.mixer) {
                this.mixer.updateFromAudioEngine();
            }
        }
    }

    async recallScene(sceneId) {
        await kaiAPI.mixer.recallScene(sceneId);
        
        document.querySelectorAll('.scene-btn').forEach(btn => {
            btn.classList.toggle('active', btn.textContent === sceneId);
        });
    }

    async saveCurrentScene() {
        const activeScene = document.querySelector('.scene-btn.active');
        if (activeScene) {
            const sceneId = activeScene.textContent;
            console.log(`Saving current mix to scene ${sceneId}`);
        }
    }

    async toggleVocalsGlobal() {
        await kaiAPI.mixer.toggleMute('vocals', 'PA');
        await kaiAPI.mixer.toggleMute('vocals', 'IEM');
    }

    async toggleVocalsPA() {
        await kaiAPI.mixer.toggleMute('vocals', 'PA');
    }

    async toggleStemMute(stemIndex) {
        if (this.mixer) {
            this.mixer.toggleStemMute(stemIndex);
        }
    }

    async toggleStemSolo(stemIndex) {
        if (this.mixer) {
            this.mixer.toggleStemSolo(stemIndex);
        }
    }

    updateAutotuneSettings() {
        const strength = document.getElementById('autotuneStrength').value;
        const speed = document.getElementById('autotuneSpeed').value;
        
        kaiAPI.autotune.setSettings({
            strength: parseInt(strength),
            speed: parseInt(speed)
        });
    }

    updateStatus(message) {
        document.getElementById('statusText').textContent = message;
    }
    
    // Device persistence methods
    loadDevicePreferences() {
        try {
            const saved = localStorage.getItem('kaiPlayerDevicePrefs');
            if (saved) {
                this.devicePreferences = { ...this.devicePreferences, ...JSON.parse(saved) };
                console.log('Loaded device preferences:', this.devicePreferences);
            }
        } catch (error) {
            console.warn('Failed to load device preferences:', error);
        }
    }
    
    saveDevicePreference(deviceType, deviceId) {
        try {
            // Store device info for better matching
            const device = this.devices.find(d => (d.id || d.deviceId) === deviceId);
            if (device) {
                this.devicePreferences[deviceType] = {
                    id: deviceId,
                    name: device.name || device.label,
                    deviceKind: device.deviceKind
                };
            } else {
                this.devicePreferences[deviceType] = { id: deviceId };
            }
            
            localStorage.setItem('kaiPlayerDevicePrefs', JSON.stringify(this.devicePreferences));
            console.log(`Saved ${deviceType} device preference:`, this.devicePreferences[deviceType]);
        } catch (error) {
            console.warn('Failed to save device preference:', error);
        }
    }
    
    async restoreDeviceSelections() {
        const deviceTypes = [
            { type: 'PA', selectId: 'paDeviceSelect' },
            { type: 'IEM', selectId: 'iemDeviceSelect' },
            { type: 'input', selectId: 'inputDeviceSelect' }
        ];
        
        for (const { type, selectId } of deviceTypes) {
            const savedDevice = this.devicePreferences[type];
            if (!savedDevice) continue;
            
            const select = document.getElementById(selectId);
            let matchedDevice = null;
            
            // First try exact ID match
            matchedDevice = this.devices.find(d => (d.id || d.deviceId) === savedDevice.id);
            
            // If no exact match, try name match (for when device IDs change)
            if (!matchedDevice && savedDevice.name) {
                matchedDevice = this.devices.find(d => 
                    (d.name || d.label) === savedDevice.name && 
                    (!savedDevice.deviceKind || d.deviceKind === savedDevice.deviceKind)
                );
            }
            
            if (matchedDevice) {
                const deviceId = matchedDevice.id || matchedDevice.deviceId;
                select.value = deviceId;
                
                // Apply the device selection
                if (type === 'PA') {
                    kaiAPI.audio.setDevice('PA', parseInt(deviceId));
                    if (this.audioEngine && this.audioEngine.setOutputDevice) {
                        await this.audioEngine.setOutputDevice('PA', deviceId);
                    }
                } else if (type === 'IEM') {
                    kaiAPI.audio.setDevice('IEM', parseInt(deviceId));
                    if (this.audioEngine && this.audioEngine.setOutputDevice) {
                        await this.audioEngine.setOutputDevice('IEM', deviceId);
                    }
                } else if (type === 'input') {
                    kaiAPI.audio.setDevice('input', parseInt(deviceId));
                }
                
                console.log(`Restored ${type} device: ${matchedDevice.name || matchedDevice.label}`);
            } else {
                console.log(`Saved ${type} device not found: ${savedDevice.name || savedDevice.id}`);
                // Clear invalid preference
                this.devicePreferences[type] = null;
                localStorage.setItem('kaiPlayerDevicePrefs', JSON.stringify(this.devicePreferences));
            }
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.appInstance = new KaiPlayerApp();
});