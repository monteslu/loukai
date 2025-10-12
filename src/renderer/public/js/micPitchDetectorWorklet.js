/**
 * Microphone Pitch Detector AudioWorklet
 * Detects fundamental frequency from microphone input
 * Sends pitch data to main thread for auto-tune and coaching display
 */

class MicPitchDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Pitch detection parameters
    this.sampleRate = 48000; // Will be updated from options
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;

    // Detection rate throttling
    this.detectionCount = 0;
    this.detectionInterval = 4; // Detect every 4 buffers (~46ms at 48kHz)

    // Last detected pitch for smoothing
    this.lastPitch = null;
    this.smoothingFactor = 0.7; // Exponential smoothing

    // Minimum signal threshold to avoid detecting noise
    this.minSignalThreshold = 0.01;

    // Handle messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'setSampleRate') {
        this.sampleRate = event.data.value;
      } else if (event.data.type === 'setDetectionInterval') {
        this.detectionInterval = event.data.value;
      }
    };
  }

  /**
   * Detect pitch using autocorrelation
   * Returns frequency in Hz or null if no pitch detected
   */
  detectPitch(buffer) {
    // Check signal strength first
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / buffer.length);

    if (rms < this.minSignalThreshold) {
      return null; // Signal too weak
    }

    // Autocorrelation-based pitch detection
    // Vocal range: ~80 Hz (E2) to ~800 Hz (G5)
    const minPeriod = Math.floor(this.sampleRate / 800); // 800 Hz max
    const maxPeriod = Math.floor(this.sampleRate / 80); // 80 Hz min

    let maxCorrelation = 0;
    let bestPeriod = 0;

    // Calculate autocorrelation for each possible period
    for (let period = minPeriod; period < maxPeriod; period++) {
      let correlation = 0;
      for (let i = 0; i < buffer.length - period; i++) {
        correlation += buffer[i] * buffer[i + period];
      }

      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestPeriod = period;
      }
    }

    // Require minimum correlation strength
    const correlationThreshold = sumSquares * 0.3;
    if (bestPeriod > 0 && maxCorrelation > correlationThreshold) {
      const frequency = this.sampleRate / bestPeriod;

      // Apply exponential smoothing
      if (this.lastPitch !== null) {
        return this.lastPitch * this.smoothingFactor + frequency * (1 - this.smoothingFactor);
      }
      return frequency;
    }

    return null;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) {
      return true;
    }

    const inputChannel = input[0];

    // Pass through audio unchanged
    if (output && output[0]) {
      output[0].set(inputChannel);
    }

    // Fill detection buffer
    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];

      if (this.bufferIndex >= this.bufferSize) {
        // Buffer full - perform detection (throttled)
        this.detectionCount++;
        if (this.detectionCount >= this.detectionInterval) {
          this.detectionCount = 0;

          const detectedPitch = this.detectPitch(this.buffer);

          // Update last pitch for smoothing
          this.lastPitch = detectedPitch;

          // Send pitch data to main thread
          this.port.postMessage({
            type: 'pitch',
            frequency: detectedPitch,
            timestamp: Date.now(),
          });
        }

        // Reset buffer
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('mic-pitch-detector', MicPitchDetectorProcessor);
