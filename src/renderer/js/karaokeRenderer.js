
class KaraokeRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        console.log('KaraokeRenderer canvas:', this.canvas);
        
        if (!this.canvas) {
            console.error('Karaoke canvas not found:', canvasId);
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        this.lyrics = null;
        this.songDuration = 0;
        this.currentTime = 0;
        this.animationFrame = null;
        this.isPlaying = false;
        
        // Animation tracking for backup singers
        this.backupAnimations = new Map(); // lineIndex -> { alpha, fadeDirection, lastStateChange }
        
        // Karaoke visual settings scaled for 1080p
        this.settings = {
            fontSize: 80, // Scaled up for 1080p (was 40 for ~800px)
            fontFamily: 'Arial, sans-serif',
            lineHeight: 140, // Increased spacing between lines
            textColor: '#ffffff',
            activeColor: '#00BFFF', // Light blue for active lines (easier to read)
            upcomingColor: '#888888', // Gray for upcoming lines
            backupColor: '#DAA520', // Golden color for backup singer lines
            backupActiveColor: '#FFD700', // Brighter gold when active
            backgroundColor: '#1a1a1a',
            shadowColor: '#000000',
            linesVisible: 1, // Show only current line
            maxWidth: 0.9, // 90% of canvas width for text
            progressBarHeight: 30, // Taller progress bar
            progressBarColor: '#007acc',
            progressBarBg: '#333333',
            progressBarMargin: 100, // More space between progress bar and lyrics
            
            // Backup singer animation settings
            backupFadeDuration: 0.8, // seconds to fade in/out
            backupMaxAlpha: 0.7, // maximum opacity for backup singers (translucent)
            backupMinAlpha: 0.0, // minimum opacity (fully transparent)
            backupAnimationEasing: 'ease-out' // animation curve
        };
        
        this.setupCanvas();
        this.setupResponsiveCanvas();
        this.startAnimation();
        
        console.log('KaraokeRenderer fully initialized');
    }
    
    setupCanvas() {
        // Canvas size is ALWAYS 1920x1080 (1080p)
        // CSS controls how it stretches to fit the container
        this.canvas.width = 1920;
        this.canvas.height = 1080;
        
        console.log('Canvas setup - fixed size: 1920x1080, CSS will handle stretching');
        
        // Set default font
        this.ctx.font = `${this.settings.fontSize}px ${this.settings.fontFamily}`;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
    }
    
    setupResponsiveCanvas() {
        // Function to maintain 16:9 aspect ratio (1920:1080) while scaling to fit container
        const resizeCanvas = () => {
            const container = this.canvas.parentElement;
            if (!container) return;
            
            const containerRect = container.getBoundingClientRect();
            const containerWidth = containerRect.width;
            const containerHeight = containerRect.height;
            
            // 16:9 aspect ratio (1920/1080 = 1.7777...)
            const aspectRatio = 16 / 9;
            
            let displayWidth, displayHeight;
            
            // Calculate size that fits container while maintaining aspect ratio
            if (containerWidth / containerHeight > aspectRatio) {
                // Container is wider than 16:9, fit by height
                displayHeight = containerHeight;
                displayWidth = displayHeight * aspectRatio;
            } else {
                // Container is taller than 16:9, fit by width
                displayWidth = containerWidth;
                displayHeight = displayWidth / aspectRatio;
            }
            
            // Set CSS size to maintain proportions
            this.canvas.style.width = displayWidth + 'px';
            this.canvas.style.height = displayHeight + 'px';
            
            console.log('Canvas resized:', displayWidth + 'x' + displayHeight, 'container:', containerWidth + 'x' + containerHeight);
        };
        
        // Initial resize
        resizeCanvas();
        
        // Resize on window resize
        window.addEventListener('resize', resizeCanvas);
        
        // Store reference to remove listener on destroy
        this.resizeHandler = resizeCanvas;
    }
    
    loadLyrics(lyricsData, songDuration = 0) {
        // Store original lyrics data for outro detection
        this.originalLyricsData = lyricsData || [];
        // Store filtered lyrics for display
        this.lyrics = this.parseLyricsData(lyricsData);
        this.songDuration = songDuration;
    }
    
    parseLyricsData(data) {
        if (!data || !Array.isArray(data)) return [];
        
        // Filter out disabled lines for playback (backup lines are still included)
        const enabledData = data.filter(line => line.disabled !== true);
        
        return enabledData.map((line, index) => {
            if (typeof line === 'object' && line !== null) {
                const words = this.parseWordsFromLine(line);
                const text = line.text || line.lyrics || line.content || line.lyric || '';
                return {
                    id: index,
                    startTime: line.start || line.time || line.start_time || index * 3,
                    endTime: line.end || line.end_time || (line.start || line.time || index * 3) + 3,
                    text: text,
                    words: words,
                    isBackup: line.backup === true
                };
            } else {
                // Simple string - create word timing estimates
                const text = line || '';
                const words = this.estimateWordTiming(text, index * 3);
                return {
                    id: index,
                    startTime: index * 3,
                    endTime: index * 3 + 3,
                    text: text,
                    words: words,
                    isBackup: false
                };
            }
        }).filter(line => line.text.trim().length > 0);
    }
    
    parseWordsFromLine(line) {
        // If the line has word-level timing data, use it
        if (line.words && Array.isArray(line.words)) {
            return line.words.map(word => ({
                text: word.t || word.text || '',
                startTime: word.s || word.start || word.startTime || 0,
                endTime: word.e || word.end || word.endTime || 0
            }));
        }
        
        // Otherwise estimate word timing
        const text = line.text || line.lyrics || line.content || line.lyric || '';
        const startTime = line.start || line.time || line.start_time || 0;
        const endTime = line.end || line.end_time || (startTime + 3);
        const duration = endTime - startTime;
        
        return this.estimateWordTiming(text, startTime, duration);
    }
    
    estimateWordTiming(text, startTime, duration = 3) {
        const words = text.split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) return [];
        
        const wordDuration = duration / words.length;
        
        return words.map((word, index) => ({
            text: word,
            startTime: startTime + (index * wordDuration),
            endTime: startTime + ((index + 1) * wordDuration)
        }));
    }
    
    setCurrentTime(time) {
        this.currentTime = time;
    }
    
    setPlaying(playing) {
        this.isPlaying = playing;
    }
    
    startAnimation() {
        const animate = () => {
            this.draw();
            this.animationFrame = requestAnimationFrame(animate);
        };
        animate();
    }
    
    draw() {
        const width = this.canvas.width; // Always 1920
        const height = this.canvas.height; // Always 1080
        
        // Clear canvas
        this.ctx.fillStyle = this.settings.backgroundColor;
        this.ctx.fillRect(0, 0, width, height);
        
        if (!this.lyrics || this.lyrics.length === 0) {
            this.drawNoLyrics(width, height);
            return;
        }
        
        // Check for instrumental intro first
        if (this.isInInstrumentalIntro()) {
            this.drawInstrumentalIntro(width, height);
            return;
        }
        
        // Check for instrumental outro (just show clean ending, no progress bar)
        if (this.isInInstrumentalOutro()) {
            this.drawInstrumentalOutro(width, height);
            return;
        }
        
        // Find current line
        const currentLineIndex = this.findCurrentLine();
        
        if (currentLineIndex >= 0 && currentLineIndex < this.lyrics.length) {
            // Check if we're in an instrumental gap first
            const isInInstrumentalGap = this.isInInstrumentalGap(currentLineIndex);
            
            if (isInInstrumentalGap) {
                // During instrumental sections, only show the progress bar and upcoming lyrics
                this.drawInstrumentalProgressBar(currentLineIndex, width, height);
            } else {
                // Normal lyric display - show all active lines (main + backup)
                this.drawActiveLines(width, height);
            }
        } else {
            // No current main line found - check if we should show progress bar during backup-only periods
            this.drawBackupOnlyProgressBar(width, height);
        }
    }
    
    drawNoLyrics(width, height) {
        // Fill with bright background to make it visible
        this.ctx.fillStyle = '#FF0000';
        this.ctx.fillRect(0, 0, width, height);
        
        // Add debug info
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = `48px ${this.settings.fontFamily}`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`KARAOKE CANVAS VISIBLE`, width / 2, height / 2 - 50);
        this.ctx.fillText(`Size: ${width} x ${height}`, width / 2, height / 2);
        this.ctx.fillText(`Canvas Ready!`, width / 2, height / 2 + 50);
    }
    
    findCurrentLine() {
        // Find current main singer line (exclude backup singers for progress tracking)
        return this.findCurrentMainLine();
    }

    findCurrentMainLine() {
        if (!this.lyrics) return -1;
        
        for (let i = 0; i < this.lyrics.length; i++) {
            const line = this.lyrics[i];
            // Only consider main singer lines for progress tracking
            if (!line.isBackup && this.currentTime >= line.startTime && this.currentTime <= line.endTime) {
                return i;
            }
        }
        
        // Find the closest upcoming main singer line
        for (let i = 0; i < this.lyrics.length; i++) {
            if (!this.lyrics[i].isBackup && this.currentTime < this.lyrics[i].startTime) {
                // Find the previous main singer line (not backup)
                for (let j = i - 1; j >= 0; j--) {
                    if (!this.lyrics[j].isBackup) {
                        return j;
                    }
                }
                // No previous main singer line found, return -1 to trigger progress bar
                return -1;
            }
        }
        
        // Find the last main singer line
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            if (!this.lyrics[i].isBackup) {
                return i;
            }
        }
        
        return -1;
    }
    
    drawCurrentLyricLine(currentLineIndex, canvasWidth, canvasHeight) {
        if (currentLineIndex < 0 || currentLineIndex >= this.lyrics.length) return;
        
        const line = this.lyrics[currentLineIndex];
        
        // Set up font
        this.ctx.font = `${this.settings.fontSize}px ${this.settings.fontFamily}`;
        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = this.settings.activeColor; // Light blue for current line
        
        // Get text from line (KAI format may have different text fields)
        let text = '';
        if (line.text) {
            text = line.text;
        } else if (line.words && line.words.length > 0) {
            // If we have words array, join them
            text = line.words.map(w => w.text || w.word || w).join(' ');
        }
        
        if (text && text.trim() !== '') {
            // Handle long text with proper wrapping
            const maxWidth = canvasWidth * 0.9;
            const words = text.split(' ');
            const lines = [];
            let currentLine = '';
            
            for (const word of words) {
                const testLine = currentLine ? currentLine + ' ' + word : word;
                const testWidth = this.ctx.measureText(testLine).width;
                
                if (testWidth <= maxWidth) {
                    currentLine = testLine;
                } else {
                    if (currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                    } else {
                        // Single word is too long, just add it anyway
                        lines.push(word);
                    }
                }
            }
            
            if (currentLine) {
                lines.push(currentLine);
            }
            
            // Draw each line centered vertically
            const lineSpacing = this.settings.lineHeight * 0.9;
            const totalHeight = lines.length * lineSpacing;
            let currentY = (canvasHeight / 2) - (totalHeight / 2) + lineSpacing;
            
            lines.forEach(line => {
                this.drawTextWithShadow(line, canvasWidth / 2, currentY);
                currentY += lineSpacing;
            });
        }
    }
    
    drawActiveLines(canvasWidth, canvasHeight) {
        if (!this.lyrics) return;
        
        // Update backup singer animations first
        this.updateBackupAnimations();
        
        // Find all active lines at current time (both main and backup singers)
        const activeLines = [];
        const now = this.currentTime;
        
        for (let i = 0; i < this.lyrics.length; i++) {
            const line = this.lyrics[i];
            if (!line.isDisabled && now >= line.startTime && now <= line.endTime) {
                activeLines.push({ ...line, index: i });
            }
        }
        
        if (activeLines.length === 0) return;
        
        // Separate main and backup singers
        const mainLines = activeLines.filter(line => !line.isBackup);
        const backupLines = activeLines.filter(line => line.isBackup);
        
        // Calculate vertical positioning - stack multiple lines if needed
        const totalLines = mainLines.length + backupLines.length;
        const lineSpacing = this.settings.lineHeight * 1.2;
        const totalHeight = totalLines * lineSpacing;
        let currentY = (canvasHeight / 2) - (totalHeight / 2) + lineSpacing;
        
        // Draw main singer lines first (more prominent position)
        mainLines.forEach(line => {
            this.drawSingleLine(line, canvasWidth, currentY, false); // false = main singer
            currentY += lineSpacing;
        });
        
        // Draw backup singer lines below main singers with animation
        backupLines.forEach(line => {
            const animation = this.backupAnimations.get(line.index);
            const alpha = animation ? animation.alpha : this.settings.backupMaxAlpha;
            this.drawSingleLine(line, canvasWidth, currentY, true, alpha); // true = backup singer
            currentY += lineSpacing;
        });
    }
    
    drawSingleLine(line, canvasWidth, yPosition, isBackup, alpha = 1.0) {
        // Set up font
        this.ctx.font = `${this.settings.fontSize}px ${this.settings.fontFamily}`;
        this.ctx.textAlign = 'center';
        
        // Save context for alpha manipulation
        this.ctx.save();
        
        // Apply alpha for backup singers
        if (isBackup) {
            this.ctx.globalAlpha = alpha;
        }
        
        // Choose colors based on singer type
        this.ctx.fillStyle = isBackup ? this.settings.backupActiveColor : this.settings.activeColor;
        
        // Get text from line
        let text = '';
        if (line.text) {
            text = line.text;
        } else if (line.words && line.words.length > 0) {
            text = line.words.map(w => w.text || w.word || w).join(' ');
        }
        
        if (text && text.trim() !== '') {
            // Handle long text with proper wrapping
            const maxWidth = canvasWidth * 0.9;
            const words = text.split(' ');
            const lines = [];
            let currentLine = '';
            
            for (const word of words) {
                const testLine = currentLine ? currentLine + ' ' + word : word;
                const testWidth = this.ctx.measureText(testLine).width;
                
                if (testWidth <= maxWidth) {
                    currentLine = testLine;
                } else {
                    if (currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                    } else {
                        lines.push(word);
                    }
                }
            }
            
            if (currentLine) {
                lines.push(currentLine);
            }
            
            // Draw each wrapped line
            lines.forEach((textLine, index) => {
                const adjustedY = yPosition + (index * this.settings.lineHeight * 0.8);
                
                // Add visual indicator for backup singers (prefix)
                if (isBackup) {
                    const prefixedText = `♪ ${textLine}`;
                    this.drawTextWithShadow(prefixedText, canvasWidth / 2, adjustedY);
                } else {
                    this.drawTextWithShadow(textLine, canvasWidth / 2, adjustedY);
                }
            });
        }
        
        // Restore context (removes alpha changes)
        this.ctx.restore();
    }
    
    updateBackupAnimations() {
        if (!this.lyrics) return;
        
        const now = this.currentTime;
        const frameDelta = 16; // Assuming 60fps (16ms per frame)
        
        for (let i = 0; i < this.lyrics.length; i++) {
            const line = this.lyrics[i];
            
            // Skip non-backup or disabled lines
            if (!line.isBackup || line.isDisabled) {
                this.backupAnimations.delete(i);
                continue;
            }
            
            const isActive = now >= line.startTime && now <= line.endTime;
            const animation = this.backupAnimations.get(i) || {
                alpha: this.settings.backupMinAlpha,
                fadeDirection: 0, // 0 = stable, 1 = fading in, -1 = fading out
                lastStateChange: now
            };
            
            // Determine if we need to change fade direction
            let targetAlpha = isActive ? this.settings.backupMaxAlpha : this.settings.backupMinAlpha;
            let newFadeDirection = 0;
            
            if (isActive && animation.alpha < this.settings.backupMaxAlpha) {
                newFadeDirection = 1; // Fade in
            } else if (!isActive && animation.alpha > this.settings.backupMinAlpha) {
                newFadeDirection = -1; // Fade out
            }
            
            // Update fade direction if it changed
            if (newFadeDirection !== animation.fadeDirection) {
                animation.fadeDirection = newFadeDirection;
                animation.lastStateChange = now;
            }
            
            // Calculate alpha based on fade direction
            if (animation.fadeDirection !== 0) {
                const elapsed = now - animation.lastStateChange;
                const progress = Math.min(elapsed / this.settings.backupFadeDuration, 1.0);
                
                // Apply easing (simple ease-out)
                const easedProgress = 1 - Math.pow(1 - progress, 3);
                
                if (animation.fadeDirection === 1) {
                    // Fading in
                    animation.alpha = this.settings.backupMinAlpha + 
                        (this.settings.backupMaxAlpha - this.settings.backupMinAlpha) * easedProgress;
                } else {
                    // Fading out
                    animation.alpha = this.settings.backupMaxAlpha - 
                        (this.settings.backupMaxAlpha - this.settings.backupMinAlpha) * easedProgress;
                }
                
                // Stop fading when complete
                if (progress >= 1.0) {
                    animation.fadeDirection = 0;
                    animation.alpha = targetAlpha;
                }
            }
            
            // Store the updated animation
            this.backupAnimations.set(i, animation);
        }
        
        // Clean up animations for lines that no longer exist
        for (const [lineIndex] of this.backupAnimations) {
            if (lineIndex >= this.lyrics.length) {
                this.backupAnimations.delete(lineIndex);
            }
        }
    }
    
    wrapWordsToLines(words, maxWidth) {
        const lines = [];
        let currentLine = [];
        let currentWidth = 0;
        
        words.forEach((word, index) => {
            const wordWidth = this.ctx.measureText(word.text).width;
            const spaceWidth = index > 0 ? this.settings.wordSpacing : 0;
            const totalWidth = currentWidth + spaceWidth + wordWidth;
            
            if (totalWidth <= maxWidth || currentLine.length === 0) {
                // Add word to current line
                currentLine.push(word);
                currentWidth = totalWidth;
            } else {
                // Start new line
                if (currentLine.length > 0) {
                    lines.push(currentLine);
                }
                currentLine = [word];
                currentWidth = wordWidth;
            }
        });
        
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }
        
        return lines;
    }
    
    drawWordLine(words, centerX, y, maxWidth, isCurrentLine) {
        // Calculate total width of this line
        const totalWidth = words.reduce((width, word, index) => {
            const wordWidth = this.ctx.measureText(word.text).width;
            const spacing = index < words.length - 1 ? this.settings.wordSpacing : 0;
            return width + wordWidth + spacing;
        }, 0);
        
        // Start position for centering
        let x = centerX - (totalWidth / 2);
        
        words.forEach((word, index) => {
            const isActiveWord = isCurrentLine && 
                                this.currentTime >= word.startTime && 
                                this.currentTime <= word.endTime;
            
            // Set color
            this.ctx.fillStyle = isActiveWord ? this.settings.activeColor : 
                               isCurrentLine ? '#CCCCCC' : this.settings.textColor;
            
            // Draw word
            this.ctx.textAlign = 'left';
            this.drawTextWithShadow(word.text, x, y);
            
            // Draw bouncing ball for active word
            if (isActiveWord && isCurrentLine) {
                this.drawBouncingBall(x, word, y);
            }
            
            // Move to next word position
            const wordWidth = this.ctx.measureText(word.text).width;
            x += wordWidth + this.settings.wordSpacing;
        });
    }
    
    isInInstrumentalIntro() {
        if (!this.lyrics || this.lyrics.length === 0) return false;
        
        const now = this.currentTime;
        const firstLine = this.lyrics[0];
        
        if (!firstLine) return false;
        
        // Check if we're before the first lyrics and the gap is > 5 seconds
        const introLength = firstLine.startTime;
        return introLength > 5 && now < firstLine.startTime;
    }
    
    isInInstrumentalOutro() {
        if (!this.originalLyricsData || this.originalLyricsData.length === 0 || !this.songDuration) return false;
        
        const now = this.currentTime;
        // Find the actual last line from original data, regardless of disabled status
        const lastOriginalLine = this.originalLyricsData[this.originalLyricsData.length - 1];
        
        if (!lastOriginalLine) return false;
        
        // Parse the last line timing using same logic as parseLyricsData
        const lastLineEndTime = lastOriginalLine.end || lastOriginalLine.end_time || 
            (lastOriginalLine.start || lastOriginalLine.time || lastOriginalLine.start_time || 0) + 3;
        
        // Check if we're after the last lyrics and there's no progress bar shown
        const outroLength = this.songDuration - lastLineEndTime;
        return now > lastLineEndTime && outroLength > 0;
    }

    isInInstrumentalGap(currentLineIndex) {
        if (!this.lyrics || currentLineIndex < 0) return false;
        
        const now = this.currentTime;
        const currentLine = this.lyrics[currentLineIndex];
        const nextLine = this.lyrics[currentLineIndex + 1];
        
        if (!currentLine || !nextLine) return false;
        
        const currentLineEnd = currentLine.endTime;
        const nextLineStart = nextLine.startTime;
        const gapDuration = nextLineStart - currentLineEnd;
        
        // Only consider it an instrumental gap if it's longer than 5 seconds
        if (gapDuration <= 5) return false;
        
        // Check if we're currently in the gap
        return now >= currentLineEnd && now <= nextLineStart;
    }
    
    drawInstrumentalProgressBar(currentLineIndex, canvasWidth, canvasHeight) {
        if (!this.lyrics || currentLineIndex < 0) return;
        
        const now = this.currentTime;
        const currentLine = this.lyrics[currentLineIndex];
        
        // Find the next main singer line (skip backup singers and disabled lines)
        let nextMainLine = null;
        let nextMainLineIndex = -1;
        for (let i = currentLineIndex + 1; i < this.lyrics.length; i++) {
            if (!this.lyrics[i].isBackup && !this.lyrics[i].isDisabled) {
                nextMainLine = this.lyrics[i];
                nextMainLineIndex = i;
                break;
            }
        }
        
        if (!currentLine || !nextMainLine) return;
        
        // Check if we're in an instrumental section (between current line end and next main line start)
        const currentLineEnd = currentLine.endTime;
        const nextLineStart = nextMainLine.startTime;
        const gapDuration = nextLineStart - currentLineEnd;
        
        // Only show progress bar for instrumental gaps longer than 5 seconds
        if (gapDuration <= 5) return;
        
        // Are we currently in the instrumental gap?
        if (now >= currentLineEnd && now <= nextLineStart) {
            // We're in the instrumental section - show progress bar and upcoming lyrics
            const gapProgress = (now - currentLineEnd) / gapDuration;
            const timeRemaining = nextLineStart - now;
            
            // Draw progress bar at top
            const barWidth = canvasWidth * 0.8;
            const barHeight = this.settings.progressBarHeight;
            const barX = (canvasWidth - barWidth) / 2;
            const barY = 80;
            
            // Background
            this.ctx.fillStyle = this.settings.progressBarBg;
            this.ctx.fillRect(barX, barY, barWidth, barHeight);
            
            // Progress fill (shows how much of instrumental is complete)
            this.ctx.fillStyle = this.settings.progressBarColor;
            this.ctx.fillRect(barX, barY, barWidth * gapProgress, barHeight);
            
            // Draw upcoming lyrics preview below progress bar with proper spacing
            this.drawUpcomingLyricsPreview(nextMainLine, canvasWidth, canvasHeight, gapProgress, barY + this.settings.progressBarMargin);
        }
    }
    
    drawInstrumentalIntro(canvasWidth, canvasHeight) {
        if (!this.lyrics || this.lyrics.length === 0) return;
        
        const now = this.currentTime;
        const firstLine = this.lyrics[0];
        
        if (!firstLine) return;
        
        const introDuration = firstLine.startTime;
        const introProgress = now / introDuration;
        
        // Draw progress bar at top
        const barWidth = canvasWidth * 0.8;
        const barHeight = this.settings.progressBarHeight;
        const barX = (canvasWidth - barWidth) / 2;
        const barY = 80;
        
        // Background
        this.ctx.fillStyle = this.settings.progressBarBg;
        this.ctx.fillRect(barX, barY, barWidth, barHeight);
        
        // Progress fill
        this.ctx.fillStyle = this.settings.progressBarColor;
        this.ctx.fillRect(barX, barY, barWidth * introProgress, barHeight);
        
        // Draw upcoming first lyrics with proper spacing
        this.drawUpcomingLyricsPreview(firstLine, canvasWidth, canvasHeight, introProgress, barY + this.settings.progressBarMargin);
    }
    
    drawInstrumentalOutro(canvasWidth, canvasHeight) {
        // For outro, just show a simple message that the song is ending
        // No progress bar since user requested no progress bar at the end
        this.ctx.fillStyle = this.settings.textColor;
        this.ctx.font = `${this.settings.fontSize}px ${this.settings.fontFamily}`;
        this.ctx.textAlign = 'center';
        
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        
        this.drawTextWithShadow('♫ Instrumental Outro ♫', centerX, centerY);
    }
    
    drawBackupOnlyProgressBar(canvasWidth, canvasHeight) {
        if (!this.lyrics) return;
        
        const now = this.currentTime;
        
        // Find the next main singer line
        let nextMainLine = null;
        for (let i = 0; i < this.lyrics.length; i++) {
            if (!this.lyrics[i].isBackup && !this.lyrics[i].isDisabled && now < this.lyrics[i].startTime) {
                nextMainLine = this.lyrics[i];
                break;
            }
        }
        
        if (!nextMainLine) return;
        
        // Find when the backup-only period started (either song start or end of last main line)
        let gapStart = 0;
        for (let i = this.lyrics.length - 1; i >= 0; i--) {
            if (!this.lyrics[i].isBackup && !this.lyrics[i].isDisabled && this.lyrics[i].endTime <= now) {
                gapStart = this.lyrics[i].endTime;
                break;
            }
        }
        
        const gapDuration = nextMainLine.startTime - gapStart;
        
        // Only show progress bar for gaps longer than 5 seconds
        if (gapDuration <= 5) return;
        
        // Calculate progress
        const gapProgress = (now - gapStart) / gapDuration;
        
        // Draw progress bar at top
        const barWidth = canvasWidth * 0.8;
        const barHeight = this.settings.progressBarHeight;
        const barX = (canvasWidth - barWidth) / 2;
        const barY = 80;
        
        // Background
        this.ctx.fillStyle = this.settings.progressBarBg;
        this.ctx.fillRect(barX, barY, barWidth, barHeight);
        
        // Progress fill
        this.ctx.fillStyle = this.settings.progressBarColor;
        this.ctx.fillRect(barX, barY, barWidth * gapProgress, barHeight);
        
        // Draw upcoming main lyrics preview
        this.drawUpcomingLyricsPreview(nextMainLine, canvasWidth, canvasHeight, gapProgress, barY + this.settings.progressBarMargin);
        
        // Still render any active backup singers below the progress bar
        this.drawActiveLines(canvasWidth, canvasHeight);
    }
    
    drawUpcomingLyricsPreview(nextLine, canvasWidth, canvasHeight, progress, startY) {
        if (!nextLine) return;
        
        // Get text from line (handle different KAI formats)
        let text = '';
        if (nextLine.text) {
            text = nextLine.text;
        } else if (nextLine.words && nextLine.words.length > 0) {
            text = nextLine.words.map(w => w.text || w.word || w).join(' ');
        }
        
        if (!text || text.trim() === '') return;
        
        // Set font for upcoming lyrics (smaller than current line)
        this.ctx.font = `${Math.floor(this.settings.fontSize * 0.7)}px ${this.settings.fontFamily}`;
        this.ctx.textAlign = 'center';
        
        // Determine color based on readiness
        const isReady = progress >= 1.0;
        this.ctx.fillStyle = isReady ? this.settings.activeColor : this.settings.upcomingColor;
        
        // Handle long text with proper wrapping
        const maxWidth = canvasWidth * 0.9;
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            const testWidth = this.ctx.measureText(testLine).width;
            
            if (testWidth <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    // Single word is too long, just add it anyway
                    lines.push(word);
                }
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        // Draw each line
        const lineSpacing = Math.floor(this.settings.fontSize * 0.6);
        const totalHeight = lines.length * lineSpacing;
        let currentY = startY - (totalHeight / 2) + lineSpacing;
        
        lines.forEach(line => {
            this.drawTextWithShadow(line, canvasWidth / 2, currentY);
            currentY += lineSpacing;
        });
    }
    
    wrapWordsToLinesPreview(words, maxWidth) {
        const lines = [];
        let currentLine = [];
        let currentWidth = 0;
        
        words.forEach((word, index) => {
            const wordWidth = this.ctx.measureText(word).width;
            const spaceWidth = index > 0 ? this.settings.wordSpacing : 0;
            const totalWidth = currentWidth + spaceWidth + wordWidth;
            
            if (totalWidth <= maxWidth || currentLine.length === 0) {
                currentLine.push(word);
                currentWidth = totalWidth;
            } else {
                if (currentLine.length > 0) {
                    lines.push(currentLine);
                }
                currentLine = [word];
                currentWidth = wordWidth;
            }
        });
        
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }
        
        return lines;
    }
    
    drawWordLinePreview(words, centerX, y, maxWidth, textColor, isReady) {
        // Calculate total width of this line
        const totalWidth = words.reduce((width, word, index) => {
            const wordWidth = this.ctx.measureText(word).width;
            const spacing = index < words.length - 1 ? this.settings.wordSpacing : 0;
            return width + wordWidth + spacing;
        }, 0);
        
        // Start position for centering
        let x = centerX - (totalWidth / 2);
        
        words.forEach((word, index) => {
            this.ctx.fillStyle = textColor;
            this.ctx.textAlign = 'left';
            
            // Add subtle glow effect when ready
            if (isReady) {
                this.ctx.save();
                this.ctx.shadowColor = this.settings.activeColor;
                this.ctx.shadowBlur = 4;
                this.ctx.fillText(word, x, y);
                this.ctx.restore();
            } else {
                this.ctx.fillText(word, x, y);
            }
            
            // Move to next word position
            const wordWidth = this.ctx.measureText(word).width;
            x += wordWidth + this.settings.wordSpacing;
        });
    }
    
    drawTextWithShadow(text, x, y) {
        // Draw shadow
        this.ctx.save();
        this.ctx.fillStyle = this.settings.shadowColor;
        this.ctx.fillText(text, x + 2, y + 2);
        this.ctx.restore();
        
        // Draw main text
        this.ctx.fillText(text, x, y);
    }
    
    drawBouncingBall(x, word, lineY) {
        // Calculate ball position based on progress through word
        const progress = (this.currentTime - word.startTime) / (word.endTime - word.startTime);
        const wordWidth = this.ctx.measureText(word.text).width;
        
        const ballX = x + (progress * wordWidth);
        const ballY = lineY - 30 + Math.sin(progress * Math.PI * 4) * 5; // Bouncing effect
        
        // Draw ball
        this.ctx.save();
        this.ctx.fillStyle = this.settings.ballColor;
        this.ctx.beginPath();
        this.ctx.arc(ballX, ballY, this.settings.ballSize, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
    }
    
    destroy() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        
        // Clean up resize listener
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
    }
}