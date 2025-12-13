// app.js
// Main SPA-like controller for the Melody Engine demo

import { generateMelody } from "./melodyEngine.js";
import { initAudio, ensureRunning, now, playNoteAt } from "./audioEngine.js";

let lastGeneratedMelody = null;



// ---------- DOM refs ----------

const keySelect = document.getElementById("key-select");
const rangeMinInput = document.getElementById("range-min");
const rangeMaxInput = document.getElementById("range-max");
const rhythmPresetSelect = document.getElementById("rhythm-preset");
const generateBtn = document.getElementById("btn-generate");
const playBtn = document.getElementById("btn-play");

const pianoRollEl = document.getElementById("piano-roll");
const jsonOutputEl = document.getElementById("json-output");

const tabs = document.querySelectorAll(".tab");
const panelVisual = document.getElementById("panel-visual");
const panelJson = document.getElementById("panel-json");

// ---------- Rhythm presets ----------

function getRhythmSequence(preset) {
  switch (preset) {
    case "even":
      // 16 quarter notes (4 bars of 4/4)
      return new Array(16).fill(1);

    case "syncopated":
      return [
        0.5, 0.5, 1,
        1, 0.5, 0.5,
        0.5, 0.5, 1,
        2,
        0.5, 0.5, 1,
        1, 1, 2
      ];

case "dotted-groove":
  return [
    1, 0.75, 0.25, 1.5, 
    0.5, 0.5, 0.5, 1, 
    0.75, 0.75, 0.5, 1, 
    1, 0.5, 0.5, 2
  ];

    case "default":
    default:
      return [
        1, 0.5, 0.5, 1,
        1, 0.5, 0.5, 1,
        1, 1, 0.5, 0.5,
        2, 1, 1, 2
      ];

case "swing":
  return [
    1, 0.5, 0.5, 1, 
    1, 0.75, 0.25, 1, 
    1, 0.5, 0.5, 1, 
    1, 0.75, 0.25, 2
  ];

case "triplet-feel":
  return [
    0.33, 0.33, 0.33, 1, 
    0.5, 0.5, 1, 1, 
    0.33, 0.33, 0.33, 1, 
    1, 1, 0.5, 0.5
  ];

case "waltz":
  return [
    1, 1, 1,   // Bar 1: three quarter notes
    1, 0.5, 0.5, // Bar 2: quarter, two eighths
    1, 1, 1,   // Bar 3: three quarter notes
    0.5, 0.5, 1  // Bar 4: two eighths, quarter
  ];

  }
}

// ---------- Main generate function ----------

function regenerateMelody() {
  const keyRootMidi = parseInt(keySelect.value, 10);
  const minMidi = parseInt(rangeMinInput.value, 10);
  const maxMidi = parseInt(rangeMaxInput.value, 10);
  const rhythmPreset = rhythmPresetSelect.value;

  const rhythmSequence = getRhythmSequence(rhythmPreset);
  const totalBeats = rhythmSequence.reduce((sum, v) => sum + v, 0);

  // Simple I–ii–V–I chord pattern in scale degrees
  const chords = [
    { startBeat: 0, endBeat: totalBeats / 4, chordDegrees: [0, 2, 4] }, // I
    { startBeat: totalBeats / 4, endBeat: totalBeats / 2, chordDegrees: [1, 3, 5] }, // ii
    { startBeat: totalBeats / 2, endBeat: (3 * totalBeats) / 4, chordDegrees: [4, 6, 1] }, // V
    { startBeat: (3 * totalBeats) / 4, endBeat: totalBeats, chordDegrees: [0, 2, 4] } // I
  ];

  const config = {
    keyRootMidi,
    minMidi,
    maxMidi,
    totalBeats
  };

  const result = generateMelody(config, rhythmSequence, chords);

  // Store for playback
  lastGeneratedMelody = { ...result, totalBeats, minMidi, maxMidi };

  // Render views
  renderJson(result);
  renderPianoRoll(result, minMidi, maxMidi, totalBeats);
}

// ---------- JSON panel ----------

function renderJson(result) {
  jsonOutputEl.textContent = JSON.stringify(result, null, 2);
}

// ---------- Piano roll visualization ----------

function renderPianoRoll(result, minMidi, maxMidi, totalBeats) {
  // Clear existing
  pianoRollEl.innerHTML = "";

  const width = pianoRollEl.clientWidth || 400;
  const height = pianoRollEl.clientHeight || 260;

  const grid = document.createElement("div");
  grid.className = "piano-roll-grid";
  pianoRollEl.appendChild(grid);

  // Beat lines
  const beatCount = Math.ceil(totalBeats);
  for (let b = 0; b <= beatCount; b++) {
    const line = document.createElement("div");
    line.className = "beat-line";
    const x = (b / totalBeats) * width;
    line.style.left = x + "px";
    grid.appendChild(line);
  }

  const pitchRange = maxMidi - minMidi || 1;

  // Notes
  for (const ev of result.events) {
    const noteEl = document.createElement("div");
    noteEl.className = "piano-roll-note";

    const x = (ev.startBeat / totalBeats) * width;
    const w = (ev.duration / totalBeats) * width;

    const relPitch = (ev.midi - minMidi) / pitchRange;
    const y = height - relPitch * height - 8;
    const h = 8;

    noteEl.style.left = x + "px";
    noteEl.style.width = Math.max(w, 2) + "px";
    noteEl.style.top = y + "px";
    noteEl.style.height = h + "px";

    pianoRollEl.appendChild(noteEl);
  }

  // Y-axis labels
  const labelLow = document.createElement("div");
  labelLow.className = "piano-roll-axis-label";
  labelLow.style.bottom = "2px";
  labelLow.textContent = "MIDI " + minMidi;
  pianoRollEl.appendChild(labelLow);

  const labelHigh = document.createElement("div");
  labelHigh.className = "piano-roll-axis-label";
  labelHigh.style.top = "2px";
  labelHigh.textContent = "MIDI " + maxMidi;
  pianoRollEl.appendChild(labelHigh);
}

// ---------- Playback ----------

async function playMelody() {
  if (!lastGeneratedMelody) return;

  const { events, totalBeats } = lastGeneratedMelody;

  // Boot audio + start context
  await initAudio();
  await ensureRunning();

  const bpm = 120;
  const secondsPerBeat = 60 / bpm;

  // Small lookahead so messages arrive before playback
  const t0 = now() + 0.75;

  for (const ev of events) {
    const startTime = t0 + ev.startBeat * secondsPerBeat;
    const durationSec = ev.duration * secondsPerBeat;
    const vel01 = ev.velocity !== undefined ? ev.velocity / 127 : 0.8;

    playNoteAt({
      midi: ev.midi,
      timeSec: startTime,
      durationSec,
      velocity01: vel01
    });
  }
}




// ---------- Tab behavior ----------

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    const target = tab.dataset.tab;
    if (target === "visual") {
      panelVisual.style.display = "";
      panelJson.style.display = "none";
    } else if (target === "json") {
      panelVisual.style.display = "none";
      panelJson.style.display = "";
    }
  });
});

// ---------- Wire up UI ----------

generateBtn.addEventListener("click", regenerateMelody);
playBtn.addEventListener("click", playMelody);

// Run once on load
regenerateMelody();
