// audioEngine.js
// Loads your WAV samples, boots the AudioWorklet sampler, and exposes playNoteAt()

let audioCtx = null;
let workletNode = null;

// Base sample map for your 24 files (C3=48 ... B4=71)
const BASE_SAMPLES = [
  { midi: 48, name: "C3" },
  { midi: 49, name: "Db3" },
  { midi: 50, name: "D3" },
  { midi: 51, name: "Eb3" },
  { midi: 52, name: "E3" },
  { midi: 53, name: "F3" },
  { midi: 54, name: "Gb3" },
  { midi: 55, name: "G3" },
  { midi: 56, name: "Ab3" },
  { midi: 57, name: "A3" },
  { midi: 58, name: "Bb3" },
  { midi: 59, name: "B3" },
  { midi: 60, name: "C4" },
  { midi: 61, name: "Db4" },
  { midi: 62, name: "D4" },
  { midi: 63, name: "Eb4" },
  { midi: 64, name: "E4" },
  { midi: 65, name: "F4" },
  { midi: 66, name: "Gb4" },
  { midi: 67, name: "G4" },
  { midi: 68, name: "Ab4" },
  { midi: 69, name: "A4" },
  { midi: 70, name: "Bb4" },
  { midi: 71, name: "B4" }
];

function nearestBaseSample(targetMidi) {
  let best = BASE_SAMPLES[0];
  let bestDist = Math.abs(targetMidi - best.midi);
  for (const s of BASE_SAMPLES) {
    const d = Math.abs(targetMidi - s.midi);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

async function fetchArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.arrayBuffer();
}

export async function initAudio() {
  if (audioCtx && workletNode) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.audioWorklet.addModule("./samplerWorklet.js");

  workletNode = new AudioWorkletNode(audioCtx, "worklet-sampler", {
    numberOfOutputs: 1,
    outputChannelCount: [2]
  });

  workletNode.connect(audioCtx.destination);

  // Load and decode samples on the main thread, then send PCM to the worklet.
  const basePath = "./samples/piano_mf/";

  for (const s of BASE_SAMPLES) {
    const url = `${basePath}${s.name}.wav`;
    const ab = await fetchArrayBuffer(url);
    const audioBuf = await audioCtx.decodeAudioData(ab);

    // Ensure 2 channels (duplicate mono to stereo if needed)
    const ch0 = audioBuf.getChannelData(0);
    const ch1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : ch0;

    // Copy into transferable buffers so postMessage is efficient
    const left = new Float32Array(ch0.length);
    left.set(ch0);
    const right = new Float32Array(ch1.length);
    right.set(ch1);

    workletNode.port.postMessage(
      {
        type: "loadSample",
        baseMidi: s.midi,
        left,
        right,
        sampleRate: audioBuf.sampleRate
      },
      [left.buffer, right.buffer]
    );
  }

  // Optional: tell worklet we’re ready
  workletNode.port.postMessage({ type: "ready" });
}

export function now() {
  return audioCtx ? audioCtx.currentTime : 0;
}

export async function ensureRunning() {
  if (!audioCtx) await initAudio();
  if (audioCtx.state !== "running") await audioCtx.resume();
}

export function playNoteAt({ midi, timeSec, durationSec, velocity01 }) {
  if (!workletNode || !audioCtx) return;

  const base = nearestBaseSample(midi);
  const semitones = midi - base.midi;
  const rate = Math.pow(2, semitones / 12);

  workletNode.port.postMessage({
    type: "noteOn",
    midi,
    baseMidi: base.midi,
    rate,
    t: timeSec,
    dur: durationSec,
    vel: Math.max(0, Math.min(1, velocity01 ?? 0.8))
  });
}
