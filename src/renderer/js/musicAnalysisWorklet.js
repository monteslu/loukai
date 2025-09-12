// AudioWorklet processor for real-time music analysis
class MusicAnalysisProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Analysis parameters
        this.fftSize = 512;
        this.bufferSize = this.fftSize * 2; // Need double for FFT
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        
        // Analysis results
        this.analysisFrameCount = 0;
        this.analysisRate = 4; // Send analysis every 4 frames (~15Hz at 60fps)
        
        // Pre-allocate arrays for efficiency
        this.frequencyData = new Float32Array(this.fftSize / 2);
        this.tempBuffer = new Float32Array(this.fftSize);
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (!input || !input[0]) {
            return true;
        }
        
        const inputChannel = input[0];
        
        // Fill circular buffer
        for (let i = 0; i < inputChannel.length; i++) {
            this.buffer[this.bufferIndex] = inputChannel[i];
            this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;
        }
        
        // Perform analysis at reduced rate to avoid overwhelming main thread
        this.analysisFrameCount++;
        if (this.analysisFrameCount >= this.analysisRate) {
            this.analysisFrameCount = 0;
            this.performAnalysis();
        }
        
        return true;
    }
    
    performAnalysis() {
        // Copy buffer data in correct order for FFT
        const startIndex = this.bufferIndex;
        for (let i = 0; i < this.fftSize; i++) {
            const bufferIdx = (startIndex + i) % this.bufferSize;
            this.tempBuffer[i] = this.buffer[bufferIdx];
        }
        
        // Apply window function (Hann window)
        for (let i = 0; i < this.fftSize; i++) {
            const windowValue = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this.fftSize - 1)));
            this.tempBuffer[i] *= windowValue;
        }
        
        // Perform FFT (simplified real-to-complex)
        this.simpleFFT(this.tempBuffer, this.frequencyData);
        
        // Analyze frequency bands
        const analysis = this.analyzeFrequencyBands(this.frequencyData);
        
        // Send results to main thread
        this.port.postMessage({
            type: 'analysis',
            data: analysis
        });
    }
    
    // Simplified FFT implementation for AudioWorklet
    simpleFFT(timeData, freqData) {
        const N = timeData.length;
        const halfN = N / 2;
        
        // Convert to magnitude spectrum (simplified)
        for (let i = 0; i < halfN; i++) {
            let real = 0;
            let imag = 0;
            
            for (let j = 0; j < N; j++) {
                const angle = -2 * Math.PI * i * j / N;
                real += timeData[j] * Math.cos(angle);
                imag += timeData[j] * Math.sin(angle);
            }
            
            // Magnitude
            freqData[i] = Math.sqrt(real * real + imag * imag) / N;
        }
    }
    
    analyzeFrequencyBands(frequencyData) {
        const binCount = frequencyData.length;
        const bassEnd = Math.floor(binCount * 0.1);    // 0-10% (bass)
        const midEnd = Math.floor(binCount * 0.4);     // 10-40% (mids)
        // 40-100% is treble
        
        let bassSum = 0, midSum = 0, trebleSum = 0, totalEnergy = 0;
        let weightedSum = 0; // for spectral centroid
        
        for (let i = 0; i < binCount; i++) {
            const value = frequencyData[i];
            totalEnergy += value;
            weightedSum += value * i;
            
            if (i < bassEnd) {
                bassSum += value;
            } else if (i < midEnd) {
                midSum += value;
            } else {
                trebleSum += value;
            }
        }
        
        // Calculate averages and normalize
        const bassAvg = bassEnd > 0 ? bassSum / bassEnd : 0;
        const midAvg = (midEnd - bassEnd) > 0 ? midSum / (midEnd - bassEnd) : 0;
        const trebleAvg = (binCount - midEnd) > 0 ? trebleSum / (binCount - midEnd) : 0;
        const energyAvg = binCount > 0 ? totalEnergy / binCount : 0;
        
        // Calculate spectral centroid (normalized)
        const centroid = totalEnergy > 0 ? (weightedSum / totalEnergy) / binCount : 0;
        
        // Apply smoothing and scaling for visual effects
        return {
            energy: Math.min(energyAvg * 50, 1.0),      // Scale and clamp
            bass: Math.min(bassAvg * 100, 1.0),
            mid: Math.min(midAvg * 80, 1.0),
            treble: Math.min(trebleAvg * 60, 1.0),
            centroid: centroid
        };
    }
}

registerProcessor('music-analysis-processor', MusicAnalysisProcessor);