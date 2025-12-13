// samplerWorklet.js
// Minimal polyphonic sampler with linear interpolation + simple ADSR.

class WorkletSampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Map(); // baseMidi -> {left, right, sr}
    this.voices = []; // active voices
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(msg) {
    if (msg.type === "loadSample") {
      this.samples.set(msg.baseMidi, {
        left: msg.left,
        right: msg.right,
        sr: msg.sampleRate
      });
    } else if (msg.type === "noteOn") {
      const s = this.samples.get(msg.baseMidi);
      if (!s) return;

// Desired start time (may already be in the past)
const desiredStart = Math.floor((msg.t || currentTime) * sampleRate);

// Safety margin so late messages still play audibly
const safetyFrames = Math.floor(0.01 * sampleRate); // 10 ms

// Clamp start so it is never in the past
const startFrame = Math.max(desiredStart, currentFrame + safetyFrames);

// Duration in frames
const durFrames = Math.max(1, Math.floor((msg.dur || 0.25) * sampleRate));

// Minimum “hold” so ornaments don’t vanish (try 70–90ms)
const minHoldFrames = Math.floor(0.08 * sampleRate); // 80 ms
const heldDurFrames = Math.max(durFrames, minHoldFrames);


      // Handle sample-rate mismatch: playback needs factor (sampleSR / contextSR)
      const srFactor = s.sr / sampleRate;

      this.voices.push({
        baseMidi: msg.baseMidi,
        left: s.left,
        right: s.right,
        pos: 0, // in sample frames (float)
        rate: (msg.rate || 1) * srFactor,
        startFrame,
        stopFrame: startFrame + heldDurFrames,
        vel: msg.vel ?? 0.8,
        // Simple ADSR (seconds)
        a: 0.004,
        d: 0.10,
        s: 0.85,
        r: 0.35,
        released: false,
        env: 0
      });

      // Basic voice limit (prevents runaway polyphony)
      const MAX_VOICES = 48;
      if (this.voices.length > MAX_VOICES) {
        this.voices.splice(0, this.voices.length - MAX_VOICES);
      }
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];

    // Clear output
    for (let i = 0; i < L.length; i++) {
      L[i] = 0;
      R[i] = 0;
    }

    const blockStart = currentFrame;
    const blockEnd = currentFrame + L.length;
    const sr = sampleRate;

    // Render voices
    for (let v = this.voices.length - 1; v >= 0; v--) {
      const voice = this.voices[v];

      // Skip if voice starts after this block
      if (voice.startFrame >= blockEnd) continue;

      const left = voice.left;
      const right = voice.right;

      // Determine render start/end within this block
      const startI = Math.max(0, voice.startFrame - blockStart);
      const endI = Math.min(L.length, voice.stopFrame - blockStart + Math.floor(voice.r * sr));

      for (let i = startI; i < endI; i++) {
        const frame = blockStart + i;

        // Start envelope once we reach startFrame
        if (frame < voice.startFrame) continue;

        // Release when we pass stopFrame
        if (!voice.released && frame >= voice.stopFrame) {
          voice.released = true;
        }

        // Envelope
        const tFromStart = (frame - voice.startFrame) / sr;

        if (!voice.released) {
          // Attack/decay/sustain
          if (tFromStart < voice.a) {
            voice.env = tFromStart / voice.a;
          } else if (tFromStart < voice.a + voice.d) {
            const td = (tFromStart - voice.a) / voice.d;
            voice.env = 1 + (voice.s - 1) * td;
          } else {
            voice.env = voice.s;
          }
        } else {
          // Release
          voice.env -= 1 / (voice.r * sr);
          if (voice.env <= 0) {
            voice.env = 0;
            break;
          }
        }

        // Sample playback with linear interpolation
        const p = voice.pos;
        const idx = p | 0;
        const frac = p - idx;

        if (idx + 1 >= left.length) {
          // end of sample data
          voice.env = 0;
          break;
        }

        const l0 = left[idx];
        const l1 = left[idx + 1];
        const r0 = right[idx];
        const r1 = right[idx + 1];

        const sampleL = l0 + (l1 - l0) * frac;
        const sampleR = r0 + (r1 - r0) * frac;

        const amp = voice.vel * voice.env;

        L[i] += sampleL * amp;
        R[i] += sampleR * amp;

        voice.pos += voice.rate;
      }

      // Remove voice if envelope ended
      if (voice.env <= 0) {
        this.voices.splice(v, 1);
      }
    }

    return true;
  }
}

registerProcessor("worklet-sampler", WorkletSampler);
