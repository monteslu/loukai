class PlayerController {
    constructor(audioEngine = null) {
        this.audioEngine = audioEngine;
        this.lyricsContainer = document.getElementById('lyricsContainer');
        
        // Initialize karaoke renderer
        console.log('PlayerController initializing karaoke renderer...');
        this.karaokeRenderer = new KaraokeRenderer('karaokeCanvas');
        console.log('PlayerController karaoke renderer:', this.karaokeRenderer);
        
        this.currentTime = document.getElementById('currentTime');
        this.totalTime = document.getElementById('totalTime');
        
        // Progress bar elements
        this.progressFill = document.getElementById('progressFill');
        this.progressHandle = document.getElementById('progressHandle');
        this.progressBar = document.querySelector('.progress-bar');
        
        this.songDuration = 0;
        this.currentPosition = 0;
        this.lyrics = null;
        
        this.isPlaying = false;
        this.animationFrame = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        
        this.updateTimer = setInterval(() => {
            if (this.isPlaying) {
                this.updatePosition();
                if (Math.random() < 0.05) { // Debug occasionally
                    console.log('PlayerController timer tick - isPlaying:', this.isPlaying, 'position:', this.currentPosition.toFixed(2));
                }
            }
        }, 100);
    }


    setupEventListeners() {
        // Progress bar click for seeking
        if (this.progressBar) {
            this.progressBar.addEventListener('click', (e) => {
                this.seekToProgressPosition(e);
            });
        }
        
        // Transport controls
        const seekBackBtn = document.getElementById('seekBackBtn');
        const seekForwardBtn = document.getElementById('seekForwardBtn');
        
        if (seekBackBtn) {
            seekBackBtn.addEventListener('click', () => {
                this.setPosition(Math.max(0, this.currentPosition - 10));
            });
        }
        
        if (seekForwardBtn) {
            seekForwardBtn.addEventListener('click', () => {
                this.setPosition(Math.min(this.songDuration, this.currentPosition + 10));
            });
        }
    }

    onSongLoaded(metadata) {
        // Get real duration from audio engine if available
        if (this.audioEngine && this.audioEngine.getDuration) {
            this.songDuration = this.audioEngine.getDuration();
        } else {
            this.songDuration = metadata?.duration || 0;
        }
        
        this.lyrics = metadata?.lyrics || null;
        
        // Reset current position to 0 when loading a new song
        this.currentPosition = 0;
        
        // Load lyrics into karaoke renderer with song duration
        if (this.lyrics) {
            this.karaokeRenderer.loadLyrics(this.lyrics, this.songDuration);
        }
        
        console.log('PlayerController song loaded - duration:', this.songDuration + 's');
        this.updateTimeDisplay();
        this.updateProgressBar();
    }





    renderLyrics() {
        if (!this.lyrics) {
            this.lyricsContainer.innerHTML = '<div class="no-lyrics">No lyrics available</div>';
            return;
        }

        this.lyricsContainer.innerHTML = '';
        
        if (Array.isArray(this.lyrics)) {
            this.lyrics.forEach((line, index) => {
                const lineElement = document.createElement('div');
                lineElement.className = 'lyric-line';
                lineElement.dataset.index = index;
                
                // Handle different KAI line formats
                if (typeof line === 'object' && line !== null) {
                    lineElement.dataset.time = line.time || line.start_time || 0;
                    lineElement.textContent = line.text || line.lyrics || line.content || '';
                } else {
                    lineElement.dataset.time = index * 3; // Fallback timing
                    lineElement.textContent = line || '';
                }
                
                this.lyricsContainer.appendChild(lineElement);
            });
        } else if (typeof this.lyrics === 'string') {
            const lines = this.lyrics.split('\n');
            lines.forEach((line, index) => {
                const lineElement = document.createElement('div');
                lineElement.className = 'lyric-line';
                lineElement.dataset.index = index;
                lineElement.textContent = line;
                this.lyricsContainer.appendChild(lineElement);
            });
        }
    }

    updatePosition() {
        // Get real position from audio engine if available
        if (this.audioEngine && this.audioEngine.getCurrentTime) {
            const engineTime = this.audioEngine.getCurrentTime();
            this.currentPosition = engineTime;
            if (Math.random() < 0.02) { // Debug occasionally
                console.log('PlayerController position from engine:', engineTime.toFixed(2) + 's');
            }
        } else {
            // Fallback to increment
            this.currentPosition += 0.1;
            if (Math.random() < 0.02) {
                console.log('PlayerController position fallback:', this.currentPosition.toFixed(2) + 's');
            }
        }
        
        if (this.currentPosition > this.songDuration && this.songDuration > 0) {
            this.currentPosition = this.songDuration;
            this.pause();
        }
        
        this.updateTimeDisplay();
        this.updateProgressBar();
        this.updateKaraokeTime();
    }

    updateKaraokeTime() {
        if (this.karaokeRenderer) {
            this.karaokeRenderer.setCurrentTime(this.currentPosition);
            if (Math.random() < 0.05) { // Debug occasionally
                console.log('PlayerController updating karaoke time:', this.currentPosition.toFixed(2) + 's');
            }
        }
    }

    updateTimeDisplay() {
        if (this.currentTime) {
            this.currentTime.textContent = this.formatTime(this.currentPosition);
        }
        
        if (this.totalTime) {
            this.totalTime.textContent = this.formatTime(this.songDuration);
        }
    }


    updateProgressBar() {
        if (!this.songDuration || !this.progressFill || !this.progressHandle) return;
        
        const progress = (this.currentPosition / this.songDuration) * 100;
        this.progressFill.style.width = progress + '%';
        this.progressHandle.style.left = progress + '%';
    }

    updateActiveLyrics() {
        if (!this.lyrics) return;
        
        const lyricLines = this.lyricsContainer.querySelectorAll('.lyric-line');
        let activeLineFound = false;
        
        lyricLines.forEach((line, index) => {
            const lineTime = parseFloat(line.dataset.time) || 0;
            const nextLineTime = index < lyricLines.length - 1 ? 
                parseFloat(lyricLines[index + 1].dataset.time) || Infinity : 
                Infinity;
            
            // A line is active if current time is between this line's time and next line's time
            const isActive = this.currentPosition >= lineTime && this.currentPosition < nextLineTime;
            
            line.classList.toggle('active', isActive);
            
            if (isActive && !activeLineFound) {
                activeLineFound = true;
                line.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        });
    }


    seekToProgressPosition(event) {
        if (!this.songDuration || !this.progressBar) return;
        
        const rect = this.progressBar.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const progress = Math.max(0, Math.min(1, x / rect.width));
        const newPosition = progress * this.songDuration;
        
        this.setPosition(newPosition);
    }

    async setPosition(positionSec) {
        this.currentPosition = Math.max(0, Math.min(this.songDuration, positionSec));
        
        if (this.audioEngine) {
            try {
                await this.audioEngine.seek(this.currentPosition);
            } catch (error) {
                console.error('Seek error:', error);
            }
        }
        
        this.updateTimeDisplay();
        this.updateProgressBar();
        this.updateActiveLyrics();
    }

    async play() {
        console.log('PlayerController play() called');
        this.isPlaying = true;
        
        if (this.karaokeRenderer) {
            this.karaokeRenderer.setPlaying(true);
        }
        
        if (this.audioEngine) {
            try {
                await this.audioEngine.play();
            } catch (error) {
                console.error('Play error:', error);
                this.isPlaying = false;
                if (this.karaokeRenderer) {
                    this.karaokeRenderer.setPlaying(false);
                }
            }
        }
    }

    async pause() {
        this.isPlaying = false;
        
        if (this.karaokeRenderer) {
            this.karaokeRenderer.setPlaying(false);
        }
        
        if (this.audioEngine) {
            try {
                await this.audioEngine.pause();
            } catch (error) {
                console.error('Pause error:', error);
            }
        }
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    generateDummyWaveform(duration) {
        const sampleRate = 44100;
        const samples = Math.floor(duration * sampleRate);
        const data = new Float32Array(samples);
        
        for (let i = 0; i < samples; i++) {
            const t = i / sampleRate;
            const freq = 440 + Math.sin(t * 0.5) * 200;
            data[i] = Math.sin(t * freq * 2 * Math.PI) * 0.3 * Math.exp(-t * 0.5);
        }
        
        return data;
    }

    resample(audioData, targetSamples) {
        if (!audioData || audioData.length === 0) return [];
        
        const ratio = audioData.length / targetSamples;
        const resampled = new Array(targetSamples);
        
        for (let i = 0; i < targetSamples; i++) {
            const sourceIndex = Math.floor(i * ratio);
            resampled[i] = audioData[sourceIndex] || 0;
        }
        
        return resampled;
    }

    destroy() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        
        if (this.karaokeRenderer) {
            this.karaokeRenderer.destroy();
        }
    }
}