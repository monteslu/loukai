class LyricsEditor {
    constructor() {
        this.lyricsData = [];
        this.originalLyrics = null;
        this.editedCallback = null;
        
        this.lyricsLinesContainer = document.getElementById('lyricsLines');
        this.addNewLineBtn = document.getElementById('addNewLine');
        this.resetLyricsBtn = document.getElementById('resetLyrics');
        
        this.init();
    }
    
    init() {
        this.addNewLineBtn.addEventListener('click', () => this.addNewLine());
        this.resetLyricsBtn.addEventListener('click', () => this.resetToOriginal());
    }
    
    loadLyrics(lyrics) {
        console.log('LyricsEditor.loadLyrics called with:', lyrics);
        this.originalLyrics = JSON.parse(JSON.stringify(lyrics));
        this.lyricsData = JSON.parse(JSON.stringify(lyrics));
        console.log('LyricsEditor data loaded, rendering editor...');
        this.renderEditor();
    }
    
    renderEditor() {
        if (!this.lyricsData || this.lyricsData.length === 0) {
            this.lyricsLinesContainer.innerHTML = '<div class="no-lyrics-message">Load a KAI file to edit lyrics</div>';
            return;
        }
        
        this.lyricsLinesContainer.innerHTML = '';
        
        this.lyricsData.forEach((line, index) => {
            const lineElement = this.createLineEditor(line, index);
            this.lyricsLinesContainer.appendChild(lineElement);
        });
    }
    
    createLineEditor(line, index) {
        const container = document.createElement('div');
        container.dataset.index = index;
        
        // Parse timing - handle both formats
        let startTime = 0;
        let endTime = 0;
        let text = '';
        let disabled = false;
        let backup = false;
        
        console.log('Processing line:', index, line);
        
        if (typeof line === 'object' && line !== null) {
            // Handle different timing field names - prioritize KAI format (start/end)
            startTime = line.start || line.time || line.start_time || 0;
            endTime = line.end || line.end_time || (startTime + 3);
            text = line.text || line.lyrics || line.content || line.lyric || '';
            disabled = line.disabled === true;
            backup = line.backup === true;
            console.log('Line timing:', { startTime, endTime, text, disabled, backup });
        } else {
            text = line || '';
            startTime = index * 3;
            endTime = startTime + 3;
            console.log('Simple line:', { startTime, endTime, text, disabled });
        }
        
        // Update container class now that disabled and backup are set
        container.className = `lyric-line-editor ${disabled ? 'disabled' : ''} ${backup ? 'backup' : ''}`;
        
        container.innerHTML = `
            <span class="line-number">${index + 1}</span>
            <div class="time-inputs">
                <input type="number" class="time-input start-time" value="${startTime.toFixed(1)}" step="0.1" min="0">
                <span class="time-separator">—</span>
                <input type="number" class="time-input end-time" value="${endTime.toFixed(1)}" step="0.1" min="0">
            </div>
            <input type="text" class="text-input" value="${text}" placeholder="Enter lyrics...">
            <div class="line-controls">
                <label class="checkbox-label">
                    <input type="checkbox" class="backup-checkbox" ${backup ? 'checked' : ''}>
                    <span class="checkbox-custom"></span>
                    Backup
                </label>
            </div>
            <div class="line-actions">
                <button class="btn-icon toggle-btn ${!disabled ? 'toggle-enabled' : 'toggle-disabled'}" 
                        title="${!disabled ? 'Disable line' : 'Enable line'}">
                    ${!disabled ? '👁' : '🚫'}
                </button>
                <button class="btn-icon delete-btn" title="Delete line">🗑</button>
                <button class="btn-icon add-after-btn" title="Add line after">➕</button>
            </div>
        `;
        
        this.setupLineEventListeners(container, index);
        
        return container;
    }
    
    setupLineEventListeners(container, index) {
        const startTimeInput = container.querySelector('.start-time');
        const endTimeInput = container.querySelector('.end-time');
        const textInput = container.querySelector('.text-input');
        const backupCheckbox = container.querySelector('.backup-checkbox');
        const toggleBtn = container.querySelector('.toggle-btn');
        const deleteBtn = container.querySelector('.delete-btn');
        const addAfterBtn = container.querySelector('.add-after-btn');
        
        // Time inputs
        startTimeInput.addEventListener('change', (e) => {
            const value = parseFloat(e.target.value) || 0;
            this.updateLineData(index, 'start', value);
        });
        
        endTimeInput.addEventListener('change', (e) => {
            const value = parseFloat(e.target.value) || 0;
            this.updateLineData(index, 'end', value);
        });
        
        // Text input
        textInput.addEventListener('input', (e) => {
            this.updateLineData(index, 'text', e.target.value);
        });
        
        // Backup checkbox
        backupCheckbox.addEventListener('change', (e) => {
            const isBackup = e.target.checked;
            this.updateLineData(index, 'backup', isBackup);
            
            container.classList.toggle('backup', isBackup);
        });
        
        // Toggle enable/disable
        toggleBtn.addEventListener('click', () => {
            const currentDisabled = this.lyricsData[index].disabled === true;
            const newDisabled = !currentDisabled;
            
            this.updateLineData(index, 'disabled', newDisabled);
            
            container.classList.toggle('disabled', newDisabled);
            toggleBtn.classList.toggle('toggle-enabled', !newDisabled);
            toggleBtn.classList.toggle('toggle-disabled', newDisabled);
            toggleBtn.textContent = !newDisabled ? '👁' : '🚫';
            toggleBtn.title = !newDisabled ? 'Disable line' : 'Enable line';
        });
        
        // Delete line
        deleteBtn.addEventListener('click', () => {
            if (confirm('Delete this lyric line?')) {
                this.deleteLine(index);
            }
        });
        
        // Add line after
        addAfterBtn.addEventListener('click', () => {
            this.addLineAfter(index);
        });
    }
    
    updateLineData(index, property, value) {
        if (this.lyricsData[index]) {
            if (typeof this.lyricsData[index] === 'string') {
                this.lyricsData[index] = { text: this.lyricsData[index], start: index * 3, end: (index * 3) + 3 };
            }
            this.lyricsData[index][property] = value;
            this.notifyChange();
        }
    }
    
    deleteLine(index) {
        this.lyricsData.splice(index, 1);
        this.renderEditor();
        this.notifyChange();
    }
    
    addLineAfter(index) {
        const currentLine = this.lyricsData[index];
        const nextLine = this.lyricsData[index + 1];
        
        let startTime = 0;
        let endTime = 3;
        
        if (typeof currentLine === 'object' && currentLine !== null) {
            const currentEndTime = currentLine.end || currentLine.end_time || (currentLine.start || currentLine.time || 0) + 3;
            const nextStartTime = nextLine ? (nextLine.start || nextLine.time || nextLine.start_time || currentEndTime + 3) : currentEndTime + 3;
            
            startTime = currentEndTime;
            endTime = nextStartTime;
        }
        
        const newLine = {
            start: startTime,
            end: endTime,
            text: ''
            // No disabled or backup properties - defaults to enabled lead singer
        };
        
        this.lyricsData.splice(index + 1, 0, newLine);
        this.renderEditor();
        this.notifyChange();
    }
    
    addNewLine() {
        const lastLine = this.lyricsData[this.lyricsData.length - 1];
        let startTime = this.lyricsData.length * 3;
        
        if (typeof lastLine === 'object' && lastLine !== null) {
            startTime = (lastLine.end || lastLine.end_time || (lastLine.start || lastLine.time || 0) + 3) || startTime;
        }
        
        const newLine = {
            start: startTime,
            end: startTime + 3,
            text: ''
            // No disabled or backup properties - defaults to enabled lead singer
        };
        
        this.lyricsData.push(newLine);
        this.renderEditor();
        this.notifyChange();
        
        // Focus on the new line's text input
        setTimeout(() => {
            const newLineElement = this.lyricsLinesContainer.lastElementChild;
            const textInput = newLineElement.querySelector('.text-input');
            if (textInput) textInput.focus();
        }, 100);
    }
    
    resetToOriginal() {
        if (confirm('Reset all changes and restore original lyrics?')) {
            this.lyricsData = JSON.parse(JSON.stringify(this.originalLyrics));
            this.renderEditor();
            this.notifyChange();
        }
    }
    
    getEditedLyrics() {
        return this.lyricsData.map(line => {
            // Return all lines (including disabled ones)
            // Only the delete button actually removes lines from this.lyricsData
            const cleanLine = { ...line };
            
            // Only include disabled property if it's true
            if (line.disabled !== true) {
                delete cleanLine.disabled;
            }
            
            // Only include backup property if it's true
            if (line.backup !== true) {
                delete cleanLine.backup;
            }
            
            return cleanLine;
        });
    }
    
    onLyricsEdited(callback) {
        this.editedCallback = callback;
    }
    
    notifyChange() {
        if (this.editedCallback) {
            this.editedCallback(this.getEditedLyrics());
        }
    }
    
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00.0';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const tenths = Math.floor((seconds % 1) * 10);
        return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
    }
    
    parseTime(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length !== 2) return 0;
        
        const minutes = parseInt(parts[0]) || 0;
        const secondsParts = parts[1].split('.');
        const seconds = parseInt(secondsParts[0]) || 0;
        const tenths = parseInt(secondsParts[1]) || 0;
        
        return minutes * 60 + seconds + tenths / 10;
    }
}