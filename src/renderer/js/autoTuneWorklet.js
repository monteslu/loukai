class AutoTuneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Auto-tune parameters
    this.enabled = false;
    this.strength = 0.5; // 0-1 range
    this.speed = 0.05; // How quickly to correct pitch
    this.targetPitch = null;
    this.currentKey = 'C';

    // Pitch detection
    this.sampleRate = 44100;
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;

    // Musical notes in Hz (A4 = 440Hz)
    this.noteFrequencies = {
      C: [65.41, 130.81, 261.63, 523.25, 1046.5],
      'C#': [69.3, 138.59, 277.18, 554.37, 1108.73],
      D: [73.42, 146.83, 293.66, 587.33, 1174.66],
      'D#': [77.78, 155.56, 311.13, 622.25, 1244.51],
      E: [82.41, 164.81, 329.63, 659.25, 1318.51],
      F: [87.31, 174.61, 349.23, 698.46, 1396.91],
      'F#': [92.5, 185.0, 369.99, 739.99, 1479.98],
      G: [98.0, 196.0, 392.0, 783.99, 1567.98],
      'G#': [103.83, 207.65, 415.3, 830.61, 1661.22],
      A: [110.0, 220.0, 440.0, 880.0, 1760.0],
      'A#': [116.54, 233.08, 466.16, 932.33, 1864.66],
      B: [123.47, 246.94, 493.88, 987.77, 1975.53],
    };

    // Scales for key detection
    this.scales = {
      C: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
      G: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
      D: ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
      A: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
      E: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
      B: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
      F: ['F', 'G', 'A', 'A#', 'C', 'D', 'E'],
      'A#': ['A#', 'C', 'D', 'D#', 'F', 'G', 'A'],
      'D#': ['D#', 'F', 'G', 'G#', 'A#', 'C', 'D'],
      'G#': ['G#', 'A#', 'C', 'C#', 'D#', 'F', 'G'],
      'C#': ['C#', 'D#', 'F', 'F#', 'G#', 'A#', 'B'],
      'F#': ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'F'],
    };

    // Phase vocoder for pitch shifting
    this.fftSize = 2048;
    this.hopSize = this.fftSize / 4;
    this.analysisWindow = this.createWindow(this.fftSize);
    this.synthesisWindow = this.createWindow(this.fftSize);

    // Overlap-add buffers
    this.inputBuffer = new Float32Array(this.fftSize);
    this.outputBuffer = new Float32Array(this.fftSize);
    this.overlapBuffer = new Float32Array(this.fftSize);

    // Debug logging
    this.frameCount = 0;
    this.lastLogTime = 0;

    // Handle parameter changes from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'setEnabled') {
        this.enabled = event.data.value;
      } else if (event.data.type === 'setStrength') {
        this.strength = event.data.value / 100; // Convert from 0-100 to 0-1
      } else if (event.data.type === 'setSpeed') {
        this.speed = event.data.value / 100; // Convert from 1-100 to 0.01-1
      } else if (event.data.type === 'setKey') {
        this.currentKey = event.data.value;
      }
    };
  }

  createWindow(size) {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      // Hann window
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }

  detectPitch(buffer) {
    // Simple autocorrelation-based pitch detection
    const minPeriod = Math.floor(this.sampleRate / 800); // 800 Hz max
    const maxPeriod = Math.floor(this.sampleRate / 80); // 80 Hz min

    let maxCorrelation = 0;
    let bestPeriod = 0;

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

    if (bestPeriod > 0 && maxCorrelation > 0.01) {
      return this.sampleRate / bestPeriod;
    }

    return null;
  }

  findNearestNote(frequency) {
    if (!frequency) return null;

    const scaleNotes = this.scales[this.currentKey] || this.scales['C'];
    let minDiff = Infinity;
    let nearestNote = null;
    let nearestFreq = null;

    for (const note of scaleNotes) {
      const frequencies = this.noteFrequencies[note];
      for (const freq of frequencies) {
        const diff = Math.abs(frequency - freq);
        if (diff < minDiff) {
          minDiff = diff;
          nearestNote = note;
          nearestFreq = freq;
        }
      }
    }

    return { note: nearestNote, frequency: nearestFreq };
  }

  processWithRobotEffect(inputSample) {
    // Create a robotic auto-tune effect using wave shaping
    // This is more audible than true pitch shifting but gives the characteristic sound

    // Hard clip the signal for a more digital sound
    let processed = Math.max(-1, Math.min(1, inputSample * 2));

    // Add harmonic distortion for the "robotic" quality
    processed = Math.sin(processed * Math.PI);

    // Quantize to create stepped pitch effect
    const steps = 16; // Number of quantization levels
    processed = Math.round(processed * steps) / steps;

    // Mix with original based on strength
    return inputSample * (1 - this.strength) + processed * this.strength;
  }

  process(inputs, outputs, _parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];

    if (!this.enabled) {
      // Pass through unprocessed
      outputChannel.set(inputChannel);
      return true;
    }

    // Fill detection buffer
    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];

      if (this.bufferIndex >= this.bufferSize) {
        // Detect pitch
        const detectedPitch = this.detectPitch(this.buffer);

        if (detectedPitch) {
          const nearest = this.findNearestNote(detectedPitch);
          if (nearest) {
            // Calculate pitch shift factor
            const shiftFactor = nearest.frequency / detectedPitch;

            // Log pitch detection every second
            this.frameCount++;
            const now = Date.now();
            if (now - this.lastLogTime > 1000) {
              this.lastLogTime = now;
            }

            // Smooth the pitch correction based on speed parameter
            if (this.targetPitch) {
              this.targetPitch = this.targetPitch * (1 - this.speed) + shiftFactor * this.speed;
            } else {
              this.targetPitch = shiftFactor;
            }
          }
        }

        // Reset buffer
        this.bufferIndex = 0;
        this.buffer.fill(0);
      }
    }

    // Apply auto-tune effect
    // For now, use the robotic effect which is more immediately audible
    for (let i = 0; i < outputChannel.length; i++) {
      outputChannel[i] = this.processWithRobotEffect(inputChannel[i]);
    }

    // Log that we're processing
    if (this.frameCount % 1000 === 0) {
      // Debug logging disabled for performance
    }

    return true;
  }
}

registerProcessor('auto-tune-processor', AutoTuneProcessor);
