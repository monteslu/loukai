class LyricsEditorController {
    constructor() {
        this.currentPosition = 0;
        this.songDuration = 0;
        this.isPlaying = false;
        this.hasChanges = false;
        this.currentSong = null;
        this.callbackSetup = false;
        
        
        this.timeDisplay = document.getElementById('editorTime');
        
        // Initialize the new line-by-line lyrics editor
        this.lyricsEditor = new LyricsEditor();
        
        this.updateTimer = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
    }


    setupEventListeners() {
        // Editor controls
        document.getElementById('editorPlayBtn').addEventListener('click', () => {
            this.togglePlayback();
        });

        document.getElementById('editorSaveBtn').addEventListener('click', () => {
            this.saveChanges();
        });

        document.getElementById('exportLyricsBtn').addEventListener('click', () => {
            this.exportLyrics();
        });

        document.getElementById('resetLyricsBtn').addEventListener('click', () => {
            this.resetToOriginal();
        });

        // Textarea changes - now handled by LyricsEditor
        // this.textarea.addEventListener('input', () => {
        //     this.onLyricsChanged();
        // });


    }

    onSongLoaded(songData) {
        console.log('Editor onSongLoaded called with:', songData);
        console.log('Song metadata structure:', songData?.song);
        console.log('Looking for rejections at:', songData?.song?.lyric_update_rejections);
        this.currentSong = songData;
        this.songDuration = songData?.metadata?.duration || 0;
        
        // Reset editor state - no changes after fresh load
        this.hasChanges = false;
        this.updateSaveButton();
        
        this.enableControls();
        
        // Load lyrics directly into the line-by-line editor
        if (this.lyricsEditor && songData?.lyrics) {
            console.log('Loading lyrics into editor:', songData.lyrics.length, 'lines', songData.lyrics);
            
            // Get rejections from song metadata
            const rejections = songData?.song?.lyric_update_rejections || [];
            console.log('Found lyric rejections:', rejections.length, rejections);
            
            this.lyricsEditor.loadLyrics(songData.lyrics, rejections);
            
            // Set up callback to update karaoke renderer when lyrics are edited
            // Only set this up once to avoid duplicate callbacks
            if (!this.callbackSetup) {
                this.lyricsEditor.onLyricsEdited((editedLyrics, editedRejections) => {
                    this.onLyricsEdited(editedLyrics, editedRejections);
                });
                this.callbackSetup = true;
            }
        } else {
            console.log('Editor or lyrics missing:', {
                hasEditor: !!this.lyricsEditor,
                hasLyrics: !!songData?.lyrics,
                lyricsType: typeof songData?.lyrics,
                lyricsValue: songData?.lyrics
            });
        }
        
        console.log('Lyrics editor loaded song:', songData.metadata.title);
    }









    togglePlayback() {
        if (!this.currentSong) return;
        
        this.isPlaying = !this.isPlaying;
        const btn = document.getElementById('editorPlayBtn');
        
        if (this.isPlaying) {
            btn.innerHTML = '<span>⏸ Pause</span>';
            this.startPlayback();
        } else {
            btn.innerHTML = '<span>▶ Play</span>';
            this.stopPlayback();
        }
    }

    startPlayback() {
        this.updateTimer = setInterval(() => {
            this.currentPosition += 0.1;
            
            if (this.currentPosition > this.songDuration) {
                this.currentPosition = this.songDuration;
                this.stopPlayback();
            }
            
            this.timeDisplay.textContent = this.formatTime(this.currentPosition);
            this.updateActiveLyrics();
        }, 100);
    }

    stopPlayback() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
        
        this.isPlaying = false;
        document.getElementById('editorPlayBtn').innerHTML = '<span>▶ Play</span>';
    }


    updateActiveLyrics() {
        // No longer needed - original lyrics display removed
    }




    onLyricsChanged() {
        // This is now handled by the LyricsEditor onLyricsEdited callback
        // The hasChanges flag is set in onLyricsEdited method
        this.updateSaveButton();
    }

    updateSaveButton() {
        const saveBtn = document.getElementById('editorSaveBtn');
        if (this.hasChanges) {
            saveBtn.textContent = '💾 Save Changes*';
            saveBtn.style.background = '#007acc';
        } else {
            saveBtn.textContent = '💾 Save Changes';
            saveBtn.style.background = '#3a3a3a';
        }
    }

    async saveChanges() {
        if (!this.hasChanges || !this.currentSong) return;
        
        try {
            // Get edited lyrics from the LyricsEditor
            const editedLyricsData = this.lyricsEditor ? this.lyricsEditor.getEditedLyrics() : [];
            
            // Update current song data
            this.currentSong.lyrics = editedLyricsData;
            
            // Save to file using the kaiAPI
            if (this.currentSong.originalFilePath) {
                console.log('Saving changes to KAI file:', this.currentSong.originalFilePath);
                const result = await kaiAPI.editor.saveKai(this.currentSong, this.currentSong.originalFilePath);
                
                if (result.success) {
                    this.hasChanges = false;
                    this.updateSaveButton();
                    this.showStatus('Changes saved successfully!', 'saved');
                    console.log('Lyrics changes saved to file');
                    
                    // Reload the song after successful save to refresh all components
                    this.reloadSong();
                } else {
                    this.showStatus('Failed to save changes', 'error');
                    console.error('Failed to save KAI file');
                }
            } else {
                this.showStatus('No file path available for saving', 'error');
                console.error('No original file path available for saving');
            }
        } catch (error) {
            this.showStatus('Error saving changes', 'error');
            console.error('Error saving changes:', error);
        }
    }

    exportLyrics() {
        if (!this.lyricsEditor) return;
        
        // Get the edited lyrics and convert to text format
        const editedLyricsData = this.lyricsEditor.getEditedLyrics();
        const lyricsText = editedLyricsData.map(line => line.text || '').join('\n');
        
        const blob = new Blob([lyricsText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentSong?.metadata.title || 'lyrics'}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        
        this.showStatus('Lyrics exported successfully!', 'saved');
    }

    resetToOriginal() {
        if (!this.currentSong?.lyrics) return;
        
        // Reset the LyricsEditor to original from currentSong
        if (this.lyricsEditor && this.currentSong.lyrics) {
            this.lyricsEditor.loadLyrics(this.currentSong.lyrics);
        }
        this.hasChanges = false;
        this.updateSaveButton();
        
        this.showStatus('Reset to original lyrics', 'saved');
    }

    showStatus(message, type = '') {
        // Could show in a status area if we add one
        console.log(`Editor status: ${message}`);
    }

    enableControls() {
        document.getElementById('editorPlayBtn').disabled = false;
        document.getElementById('editorSaveBtn').disabled = false;
        document.getElementById('exportLyricsBtn').disabled = false;
        document.getElementById('resetLyricsBtn').disabled = false;
        // Enable controls - line-by-line editor is always enabled when song is loaded
    }

    onLyricsEdited(editedLyrics, editedRejections = []) {
        // Update the karaoke renderer with edited lyrics
        console.log('Lyrics edited:', editedLyrics, 'rejections:', editedRejections);
        
        // Update the current song data with edited lyrics and rejections
        this.currentSong.lyrics = editedLyrics;
        if (!this.currentSong.song) {
            this.currentSong.song = {};
        }
        this.currentSong.song.lyric_update_rejections = editedRejections;
        
        // Find the player instance through the main app and update karaoke renderer
        if (window.appInstance && window.appInstance.player && window.appInstance.player.karaokeRenderer) {
            window.appInstance.player.karaokeRenderer.loadLyrics(editedLyrics, this.songDuration);
            console.log('Updated karaoke renderer with edited lyrics');
        }
        
        this.hasChanges = true;
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    async reloadSong() {
        if (!this.currentSong?.originalFilePath) {
            console.error('No original file path available for reload');
            return;
        }
        
        try {
            console.log('Reloading song from file:', this.currentSong.originalFilePath);
            
            // Use the new reload API to reload the song
            const result = await kaiAPI.editor.reloadKai(this.currentSong.originalFilePath);
            
            if (result.success) {
                console.log('Song reloaded successfully after save');
                // Note: The actual data refresh happens automatically via the song:data event
                // which calls onSongLoaded and resets the editor state
                this.showStatus('Saved and reloaded successfully!', 'saved');
            } else {
                console.error('Failed to reload song:', result.error);
                this.showStatus('Saved but failed to reload', 'warning');
            }
        } catch (error) {
            console.error('Error reloading song after save:', error);
            this.showStatus('Saved but failed to reload', 'warning');
        }
    }

    destroy() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
    }
}