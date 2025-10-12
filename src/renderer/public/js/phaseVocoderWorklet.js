/**
 * Phase Vocoder Audio Worklet Processor
 *
 * High-quality pitch shifting with formant preservation for vocal auto-tune.
 * Uses FFT-based spectral processing for natural-sounding pitch correction.
 *
 * Algorithm:
 * 1. FFT - Convert time-domain audio to frequency spectrum
 * 2. Phase unwrapping - Track phase evolution across frames
 * 3. Pitch shift - Resample spectrum to new pitch
 * 4. Formant preservation - Maintain vocal tract characteristics
 * 5. IFFT - Convert back to time domain
 * 6. Overlap-add - Reconstruct continuous audio
 */

class PhaseVocoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Configuration
    this.fftSize = 2048; // Balance between quality and latency
    this.hopSize = 512; // 75% overlap (fftSize / 4)
    this.sampleRate = 48000; // Will be updated from messages

    // Pitch shift parameter (in semitones)
    this.pitchShift = 0;

    // Buffers
    this.inputBuffer = new Float32Array(this.fftSize);
    this.outputBuffer = new Float32Array(this.fftSize);
    this.inputBufferIndex = 0;
    this.outputBufferIndex = 0;

    // FFT buffers (real and imaginary components)
    this.fftReal = new Float32Array(this.fftSize);
    this.fftImag = new Float32Array(this.fftSize);

    // Phase tracking for synthesis
    this.lastPhase = new Float32Array(this.fftSize / 2 + 1);
    this.sumPhase = new Float32Array(this.fftSize / 2 + 1);

    // Analysis phase tracking
    this.analysisLastPhase = new Float32Array(this.fftSize / 2 + 1);

    // Hann window (smooth spectral transitions)
    this.window = new Float32Array(this.fftSize);
    this.generateHannWindow();

    // Overlap-add synthesis
    this.overlapBuffer = new Float32Array(this.fftSize);

    // Formant preservation envelope
    this.spectralEnvelope = new Float32Array(this.fftSize / 2 + 1);

    // Listen for parameter updates
    this.port.onmessage = (event) => {
      if (event.data.type === 'setSampleRate') {
        this.sampleRate = event.data.value;
      }
    };
  }

  /**
   * Generate Hann window for smooth spectral analysis
   */
  generateHannWindow() {
    for (let i = 0; i < this.fftSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.fftSize - 1)));
    }
  }

  /**
   * Simple FFT implementation (Cooley-Tukey radix-2)
   * In production, you might use a faster library, but this works for our purposes
   */
  fft(real, imag) {
    const n = real.length;

    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
      let k = n / 2;
      while (k <= j) {
        j -= k;
        k /= 2;
      }
      j += k;
    }

    // Cooley-Tukey FFT
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const tableStep = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + halfSize; j++, k += tableStep) {
          const angle = (-2 * Math.PI * k) / n;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);

          const evenReal = real[j];
          const evenImag = imag[j];
          const oddReal = real[j + halfSize];
          const oddImag = imag[j + halfSize];

          const tpReal = oddReal * cos - oddImag * sin;
          const tpImag = oddReal * sin + oddImag * cos;

          real[j] = evenReal + tpReal;
          imag[j] = evenImag + tpImag;
          real[j + halfSize] = evenReal - tpReal;
          imag[j + halfSize] = evenImag - tpImag;
        }
      }
    }
  }

  /**
   * Inverse FFT
   */
  ifft(real, imag) {
    // Conjugate
    for (let i = 0; i < imag.length; i++) {
      imag[i] = -imag[i];
    }

    // Forward FFT
    this.fft(real, imag);

    // Conjugate and scale
    const n = real.length;
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] = -imag[i] / n;
    }
  }

  /**
   * Extract spectral envelope for formant preservation
   * Uses cepstral analysis to separate formants from harmonics
   */
  extractSpectralEnvelope(magnitude) {
    const numBins = magnitude.length;

    // Simplified formant extraction using smoothing
    // For each bin, average with nearby bins (smooths out harmonics, preserves formants)
    const smoothingWindow = 8; // Bins to average

    for (let i = 0; i < numBins; i++) {
      let sum = 0;
      let count = 0;

      const start = Math.max(0, i - smoothingWindow);
      const end = Math.min(numBins - 1, i + smoothingWindow);

      for (let j = start; j <= end; j++) {
        sum += magnitude[j];
        count++;
      }

      this.spectralEnvelope[i] = sum / count;
    }
  }

  /**
   * Process one frame with phase vocoder
   */
  processFrame() {
    const numBins = this.fftSize / 2 + 1;

    // Apply window to input
    for (let i = 0; i < this.fftSize; i++) {
      this.fftReal[i] = this.inputBuffer[i] * this.window[i];
      this.fftImag[i] = 0;
    }

    // Forward FFT
    this.fft(this.fftReal, this.fftImag);

    // Extract magnitude and phase
    const magnitude = new Float32Array(numBins);
    const phase = new Float32Array(numBins);

    for (let i = 0; i < numBins; i++) {
      magnitude[i] = Math.sqrt(
        this.fftReal[i] * this.fftReal[i] + this.fftImag[i] * this.fftImag[i]
      );
      phase[i] = Math.atan2(this.fftImag[i], this.fftReal[i]);
    }

    // Extract formant envelope (vocal tract characteristics)
    this.extractSpectralEnvelope(magnitude);

    // Calculate pitch shift ratio
    const shiftRatio = Math.pow(2, this.pitchShift / 12);

    // Prepare synthesis buffers
    const synthMagnitude = new Float32Array(numBins);
    const synthPhase = new Float32Array(numBins);

    // Pitch shift with formant preservation
    for (let i = 0; i < numBins; i++) {
      // Source bin for pitch shifting (resample spectrum)
      const sourceBin = i / shiftRatio;
      const sourceBinInt = Math.floor(sourceBin);
      const sourceBinFrac = sourceBin - sourceBinInt;

      if (sourceBinInt < numBins - 1) {
        // Interpolate magnitude from source spectrum
        const mag =
          magnitude[sourceBinInt] * (1 - sourceBinFrac) +
          magnitude[sourceBinInt + 1] * sourceBinFrac;

        // Get formant envelope at OUTPUT bin (preserves formants)
        const formant = this.spectralEnvelope[i];
        const sourceFormant =
          sourceBinInt < numBins - 1
            ? this.spectralEnvelope[sourceBinInt] * (1 - sourceBinFrac) +
              this.spectralEnvelope[sourceBinInt + 1] * sourceBinFrac
            : this.spectralEnvelope[sourceBinInt];

        // Apply formant preservation: adjust magnitude to maintain formant shape
        synthMagnitude[i] = sourceFormant > 0 ? mag * (formant / sourceFormant) : mag;

        // Phase unwrapping and synthesis
        const deltaPhase = phase[sourceBinInt] - this.analysisLastPhase[sourceBinInt];
        this.analysisLastPhase[sourceBinInt] = phase[sourceBinInt];

        // Expected phase advance
        const binFreq = (sourceBinInt * this.sampleRate) / this.fftSize;
        const expectedPhaseAdvance = (2 * Math.PI * this.hopSize * binFreq) / this.sampleRate;

        // Phase deviation (instantaneous frequency)
        let phaseDeviation = deltaPhase - expectedPhaseAdvance;

        // Wrap to [-π, π]
        while (phaseDeviation > Math.PI) phaseDeviation -= 2 * Math.PI;
        while (phaseDeviation < -Math.PI) phaseDeviation += 2 * Math.PI;

        // True frequency
        const trueFreq =
          binFreq + (phaseDeviation * this.sampleRate) / (2 * Math.PI * this.hopSize);

        // Synthesis phase accumulation
        this.sumPhase[i] += (2 * Math.PI * this.hopSize * trueFreq * shiftRatio) / this.sampleRate;
        synthPhase[i] = this.sumPhase[i];
      } else {
        synthMagnitude[i] = 0;
        synthPhase[i] = 0;
      }
    }

    // Convert back to complex form
    for (let i = 0; i < numBins; i++) {
      this.fftReal[i] = synthMagnitude[i] * Math.cos(synthPhase[i]);
      this.fftImag[i] = synthMagnitude[i] * Math.sin(synthPhase[i]);
    }

    // Mirror for inverse FFT (real signal symmetry)
    for (let i = numBins; i < this.fftSize; i++) {
      this.fftReal[i] = this.fftReal[this.fftSize - i];
      this.fftImag[i] = -this.fftImag[this.fftSize - i];
    }

    // Inverse FFT
    this.ifft(this.fftReal, this.fftImag);

    // Apply window and overlap-add
    for (let i = 0; i < this.fftSize; i++) {
      this.overlapBuffer[i] += this.fftReal[i] * this.window[i];
    }
  }

  /**
   * AudioWorklet process callback
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];

    // Get pitch shift parameter
    if (parameters.pitchSemitones && parameters.pitchSemitones.length > 0) {
      this.pitchShift = parameters.pitchSemitones[0];
    }

    // Process each sample
    for (let i = 0; i < inputChannel.length; i++) {
      // Add input to buffer
      this.inputBuffer[this.inputBufferIndex++] = inputChannel[i];

      // When buffer is full, process frame
      if (this.inputBufferIndex >= this.fftSize) {
        this.processFrame();

        // Shift input buffer by hop size
        for (let j = 0; j < this.fftSize - this.hopSize; j++) {
          this.inputBuffer[j] = this.inputBuffer[j + this.hopSize];
        }
        this.inputBufferIndex = this.fftSize - this.hopSize;
      }

      // Output from overlap buffer
      outputChannel[i] = this.overlapBuffer[0];

      // Shift overlap buffer
      for (let j = 0; j < this.fftSize - 1; j++) {
        this.overlapBuffer[j] = this.overlapBuffer[j + 1];
      }
      this.overlapBuffer[this.fftSize - 1] = 0;
    }

    return true;
  }

  /**
   * Register processor parameters
   */
  static get parameterDescriptors() {
    return [
      {
        name: 'pitchSemitones',
        defaultValue: 0,
        minValue: -24,
        maxValue: 24,
        automationRate: 'k-rate',
      },
    ];
  }
}

registerProcessor('phase-vocoder-processor', PhaseVocoderProcessor);
