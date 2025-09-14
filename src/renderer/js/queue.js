class QueueManager {
    constructor() {
        this.queue = [];
        this.currentIndex = -1;
        this.isPlaying = false;
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Queue control buttons
        document.getElementById('clearQueueBtn')?.addEventListener('click', () => {
            if (this.queue.length > 0 && confirm('Are you sure you want to clear the queue?')) {
                this.clearQueue();
            }
        });

        document.getElementById('shuffleQueueBtn')?.addEventListener('click', () => {
            this.shuffleQueue();
        });

        // Listen for song end events to auto-advance
        // We'll hook this up when we integrate with the audio engine
    }

    // Add song to queue
    addSong(songData) {
        const queueItem = {
            id: Date.now() + Math.random(), // Unique ID
            path: songData.path,
            title: songData.title || songData.name.replace('.kai', ''),
            artist: songData.artist || 'Unknown Artist',
            duration: songData.duration,
            folder: songData.folder,
            addedAt: new Date()
        };
        
        this.queue.push(queueItem);
        this.updateQueueDisplay();
        
        return queueItem;
    }

    // Remove song from queue by ID
    removeSong(itemId) {
        const index = this.queue.findIndex(item => item.id === itemId);
        if (index !== -1) {
            const removed = this.queue.splice(index, 1)[0];
            
            // Adjust current index if necessary
            if (index < this.currentIndex) {
                this.currentIndex--;
            } else if (index === this.currentIndex) {
                this.currentIndex = -1; // Current song was removed
            }
            
            this.updateQueueDisplay();
            return removed;
        }
        return null;
    }

    // Clear entire queue
    clearQueue() {
        this.queue = [];
        this.currentIndex = -1;
        this.updateQueueDisplay();
    }

    // Get next song in queue
    getNextSong() {
        if (this.queue.length === 0) return null;
        
        const nextIndex = this.currentIndex + 1;
        if (nextIndex < this.queue.length) {
            return this.queue[nextIndex];
        }
        return null;
    }

    // Get current song
    getCurrentSong() {
        if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
            return this.queue[this.currentIndex];
        }
        return null;
    }

    // Advance to next song
    async playNext() {
        const nextSong = this.getNextSong();
        if (nextSong) {
            this.currentIndex++;
            await this.playSong(nextSong);
            this.updateQueueDisplay();
            return nextSong;
        }
        return null;
    }

    // Play a specific song from queue
    async playFromQueue(itemId, switchToPlayerTab = true) {
        const index = this.queue.findIndex(item => item.id === itemId);
        if (index !== -1) {
            this.currentIndex = index;
            const song = this.queue[index];
            await this.playSong(song, switchToPlayerTab);
            this.updateQueueDisplay();
            return song;
        }
        return null;
    }

    // Move song in queue
    moveSong(itemId, newIndex) {
        const currentIndex = this.queue.findIndex(item => item.id === itemId);
        if (currentIndex === -1 || newIndex < 0 || newIndex >= this.queue.length) {
            return false;
        }

        const [item] = this.queue.splice(currentIndex, 1);
        this.queue.splice(newIndex, 0, item);
        
        // Adjust current index
        if (currentIndex === this.currentIndex) {
            this.currentIndex = newIndex;
        } else if (currentIndex < this.currentIndex && newIndex >= this.currentIndex) {
            this.currentIndex--;
        } else if (currentIndex > this.currentIndex && newIndex <= this.currentIndex) {
            this.currentIndex++;
        }
        
        this.updateQueueDisplay();
        return true;
    }

    // Play a song (delegate to main player)
    async playSong(queueItem, switchToPlayerTab = true) {
        try {
            this.isPlaying = true;
            
            if (window.kaiPlayerApp && window.kaiPlayerApp.loadKaiFileFromPath) {
                await window.kaiPlayerApp.loadKaiFileFromPath(queueItem.path);
            } else {
                await window.kaiAPI.file.loadKaiFromPath(queueItem.path);
            }
            
            // Switch to player tab only if requested
            if (switchToPlayerTab) {
                this.switchToPlayerTab();
            }
            
        } catch (error) {
            console.error('❌ Failed to play song from queue:', error);
            this.isPlaying = false;
        }
    }

    switchToPlayerTab() {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        
        document.querySelector('.tab-btn[data-tab="player"]').classList.add('active');
        document.getElementById('player-tab').classList.add('active');
    }

    // Shuffle the queue
    shuffleQueue() {
        if (this.queue.length <= 1) return;
        
        // Don't shuffle the currently playing song
        const currentSong = this.currentIndex >= 0 ? this.queue[this.currentIndex] : null;
        let songsToShuffle = [...this.queue];
        
        // If there's a current song, remove it from shuffle and add it back at the beginning
        if (currentSong) {
            songsToShuffle.splice(this.currentIndex, 1);
        }
        
        // Fisher-Yates shuffle algorithm
        for (let i = songsToShuffle.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songsToShuffle[i], songsToShuffle[j]] = [songsToShuffle[j], songsToShuffle[i]];
        }
        
        // Rebuild queue with current song first (if exists)
        if (currentSong) {
            this.queue = [currentSong, ...songsToShuffle];
            this.currentIndex = 0;
        } else {
            this.queue = songsToShuffle;
        }
        
        this.updateQueueDisplay();
    }

    // Update the queue display UI
    updateQueueDisplay() {
        const queueBody = document.getElementById('queueTableBody');
        const queueCount = document.getElementById('queueCount');
        const queueDuration = document.getElementById('queueDuration');
        
        if (!queueBody || !queueCount) return;
        
        // Update count and duration
        const stats = this.getQueueStats();
        queueCount.textContent = `${stats.count} songs`;
        if (queueDuration) {
            queueDuration.textContent = stats.totalDuration > 0 ? 
                `Total: ${this.formatDuration(stats.totalDuration)}` : '';
        }
        
        if (this.queue.length === 0) {
            queueBody.innerHTML = `
                <tr class="queue-empty-row">
                    <td colspan="5">
                        <div class="queue-empty">
                            <div class="empty-icon">🎵</div>
                            <div class="empty-message">Queue is empty</div>
                            <div class="empty-detail">Add songs from the library to build your queue</div>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Build queue rows
        const rowsHTML = this.queue.map((item, index) => {
            const isCurrentSong = index === this.currentIndex;
            const rowClass = isCurrentSong ? 'queue-row current-song' : 'queue-row';
            const statusIcon = isCurrentSong ? 'play_arrow' : (index < this.currentIndex ? 'done' : 'queue_music');
            
            return `
                <tr class="${rowClass}" data-item-id="${item.id}">
                    <td class="col-status">
                        <span class="material-icons queue-status">${statusIcon}</span>
                    </td>
                    <td class="col-position">${index + 1}</td>
                    <td class="col-title" title="${item.title}">${item.title}</td>
                    <td class="col-artist" title="${item.artist}">${item.artist}</td>
                    <td class="col-actions">
                        <div class="queue-actions">
                            <button class="action-btn play-queue-btn" data-item-id="${item.id}" title="Play Now">
                                <span class="material-icons">play_arrow</span>
                            </button>
                            <button class="action-btn move-up-btn" data-item-id="${item.id}" title="Move Up" ${index === 0 ? 'disabled' : ''}>
                                <span class="material-icons">keyboard_arrow_up</span>
                            </button>
                            <button class="action-btn move-down-btn" data-item-id="${item.id}" title="Move Down" ${index === this.queue.length - 1 ? 'disabled' : ''}>
                                <span class="material-icons">keyboard_arrow_down</span>
                            </button>
                            <button class="action-btn remove-queue-btn" data-item-id="${item.id}" title="Remove">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        queueBody.innerHTML = rowsHTML;
        
        // Attach event listeners to new buttons
        this.attachQueueActionListeners();
    }

    attachQueueActionListeners() {
        // Play from queue
        document.querySelectorAll('.play-queue-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.itemId);
                await this.playFromQueue(itemId);
            });
        });

        // Move up
        document.querySelectorAll('.move-up-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.itemId);
                const currentIndex = this.queue.findIndex(item => item.id === itemId);
                if (currentIndex > 0) {
                    this.moveSong(itemId, currentIndex - 1);
                }
            });
        });

        // Move down
        document.querySelectorAll('.move-down-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.itemId);
                const currentIndex = this.queue.findIndex(item => item.id === itemId);
                if (currentIndex < this.queue.length - 1) {
                    this.moveSong(itemId, currentIndex + 1);
                }
            });
        });

        // Remove from queue
        document.querySelectorAll('.remove-queue-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = parseInt(btn.dataset.itemId);
                this.removeSong(itemId);
            });
        });
    }

    // Get queue statistics
    getQueueStats() {
        const totalDuration = this.queue.reduce((sum, item) => sum + (item.duration || 0), 0);
        return {
            count: this.queue.length,
            totalDuration: totalDuration,
            currentIndex: this.currentIndex,
            isPlaying: this.isPlaying
        };
    }

    // Notify queue that a song started playing
    notifySongStarted(songPath) {
        // Find the song in the queue and update currentIndex
        const index = this.queue.findIndex(item => item.path === songPath);
        if (index !== -1) {
            this.currentIndex = index;
            this.isPlaying = true;
            this.updateQueueDisplay();
        } else {
            // Song not in queue, reset tracking
            this.currentIndex = -1;
            this.isPlaying = true;
            this.updateQueueDisplay();
        }
    }

    // Load next song from queue without playing
    async loadNext() {
        const nextSong = this.getNextSong();
        if (nextSong) {
            this.currentIndex++;
            await this.loadSong(nextSong);
            this.updateQueueDisplay();
            return nextSong;
        }
        return null;
    }

    // Load a song without playing it
    async loadSong(queueItem) {
        try {
            
            if (window.kaiPlayerApp && window.kaiPlayerApp.loadKaiFileFromPath) {
                await window.kaiPlayerApp.loadKaiFileFromPath(queueItem.path);
            } else {
                await window.kaiAPI.file.loadKaiFromPath(queueItem.path);
            }
            
            // Don't set isPlaying = true since we're just loading
            
        } catch (error) {
            console.error('❌ Failed to load song from queue:', error);
        }
    }

    // Handle song end (load next but don't auto-play)
    async handleSongEnded() {
        this.isPlaying = false;
        
        const nextSong = await this.loadNext();
        if (nextSong) {
        } else {
            this.updateQueueDisplay();
        }
    }

    // Format duration helper
    formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '-';
        
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('queue-tab')) {
        window.queueManager = new QueueManager();
    }
});