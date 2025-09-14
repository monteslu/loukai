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
        document.getElementById('editorSaveBtn').addEventListener('click', () => {
            this.saveChanges();
        });

        document.getElementById('exportLyricsBtn').addEventListener('click', () => {
            this.exportLyrics();
        });

        document.getElementById('resetLyrics').addEventListener('click', () => {
            this.resetToOriginal();
        });
        
        // Listen for IEM device changes
        document.getElementById('iemDeviceSelect').addEventListener('change', () => {
            this.applyAudioDeviceSelection();
        });

        // Textarea changes - now handled by LyricsEditor
        // this.textarea.addEventListener('input', () => {
        //     this.onLyricsChanged();
        // });


    }

    onSongLoaded(songData) {
        this.currentSong = songData;
        this.songDuration = songData?.metadata?.duration || 0;
        
        // Reset editor state - no changes after fresh load
        this.hasChanges = false;
        this.updateSaveButton();
        
        this.enableControls();
        
        // Load vocals.mp3 into the audio element
        const audioElement = document.getElementById('editorAudio');
        if (audioElement && songData?.audio?.sources) {
            // Find the vocals source
            const vocalsSource = songData.audio.sources.find(source => 
                source.name === 'vocals' || 
                source.filename?.includes('vocals')
            );
            
            if (vocalsSource && vocalsSource.audioData) {
                const vocalsBlob = new Blob([vocalsSource.audioData], { type: 'audio/mp3' });
                const vocalsUrl = URL.createObjectURL(vocalsBlob);
                audioElement.src = vocalsUrl;
                
                // Apply IEM device selection if available
                this.applyAudioDeviceSelection();
            } else {
            }
        }
        
        // Load lyrics directly into the line-by-line editor
        if (this.lyricsEditor && songData?.lyrics) {
            
            // Get rejections from song metadata
            const rejections = songData?.song?.lyric_update_rejections || [];
            
            this.lyricsEditor.loadLyrics(songData.lyrics, rejections);
            
            // Set up callback to update karaoke renderer when lyrics are edited
            // Only set this up once to avoid duplicate callbacks
            if (!this.callbackSetup) {
                this.lyricsEditor.onLyricsEdited((editedLyrics, editedRejections) => {
                    this.onLyricsEdited(editedLyrics, editedRejections);
                });
                this.callbackSetup = true;
            }
        }
        
    }











    updateActiveLyrics() {
        // No longer needed - original lyrics display removed
    }
    
    async applyAudioDeviceSelection() {
        const audioElement = document.getElementById('editorAudio');
        const iemSelect = document.getElementById('iemDeviceSelect');
        
        if (!audioElement || !iemSelect) return;
        
        const selectedDevice = iemSelect.options[iemSelect.selectedIndex];
        if (selectedDevice && selectedDevice.dataset.deviceId) {
            try {
                // Use setSinkId to route audio to the selected IEM device
                if (typeof audioElement.setSinkId === 'function') {
                    await audioElement.setSinkId(selectedDevice.dataset.deviceId);
                } else {
                    console.warn('setSinkId not supported in this browser');
                }
            } catch (error) {
                console.error('Failed to set audio output device:', error);
            }
        }
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
                const result = await kaiAPI.editor.saveKai(this.currentSong, this.currentSong.originalFilePath);
                
                if (result.success) {
                    this.hasChanges = false;
                    this.updateSaveButton();
                    this.showStatus('Changes saved successfully!', 'saved');
                    
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
    }

    enableControls() {
        document.getElementById('editorSaveBtn').disabled = false;
        document.getElementById('exportLyricsBtn').disabled = false;
        document.getElementById('resetLyrics').disabled = false;
        document.getElementById('addNewLine').disabled = false;
        // Enable controls - line-by-line editor is always enabled when song is loaded
    }

    onLyricsEdited(editedLyrics, editedRejections = []) {
        // Update the karaoke renderer with edited lyrics
        
        // Update the current song data with edited lyrics and rejections
        this.currentSong.lyrics = editedLyrics;
        if (!this.currentSong.song) {
            this.currentSong.song = {};
        }
        this.currentSong.song.lyric_update_rejections = editedRejections;
        
        // Find the player instance through the main app and update karaoke renderer
        if (window.appInstance && window.appInstance.player && window.appInstance.player.karaokeRenderer) {
            window.appInstance.player.karaokeRenderer.loadLyrics(editedLyrics, this.songDuration);
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
            
            // Use the new reload API to reload the song
            const result = await kaiAPI.editor.reloadKai(this.currentSong.originalFilePath);
            
            if (result.success) {
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