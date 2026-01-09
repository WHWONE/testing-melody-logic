// app.js - Piano keyboard based on WHITE keys with black overlays

import { generateMelody } from "./melodyEngine.js";
import { initAudio, ensureRunning, now, playNoteAt } from "./audioEngine.js";

let lastGeneratedMelody = null;

const keySelect = document.getElementById("key-select");
const rangeMinInput = document.getElementById("range-min");
const rangeMaxInput = document.getElementById("range-max");
const rhythmPresetSelect = document.getElementById("rhythm-preset");
const progPresetSelect = document.getElementById("prog-preset");
const generateBtn = document.getElementById("btn-generate");
const playBtn = document.getElementById("btn-play");
const barsSelect = document.getElementById("bars");
const contourModeSelect = document.getElementById("contour-mode");
const contourStrengthInput = document.getElementById("contour-strength");
const contourStrengthLabel = document.getElementById("contour-strength-label");

if (contourStrengthInput && contourStrengthLabel) {
  const updateContourLabel = () => {
    contourStrengthLabel.textContent = contourStrengthInput.value;
  };
  updateContourLabel();
  contourStrengthInput.addEventListener("input", updateContourLabel);
  contourStrengthInput.addEventListener("change", updateContourLabel);
}

const pianoRollEl = document.getElementById("piano-roll");
const jsonOutputEl = document.getElementById("json-output");
const tabs = document.querySelectorAll(".tab");
const panelVisual = document.getElementById("panel-visual");
const panelJson = document.getElementById("panel-json");
const tempoInput = document.getElementById("tempo");
const tempoLabel = document.getElementById("tempo-label");

if (tempoInput && tempoLabel) {
  tempoLabel.textContent = tempoInput.value;
  tempoInput.addEventListener("input", () => {
    tempoLabel.textContent = tempoInput.value;
  });
}

function triadDegrees(rootDeg) {
  return [rootDeg % 7, (rootDeg + 2) % 7, (rootDeg + 4) % 7];
}

function getChordProgressionPreset(presetId, totalBeats) {
  const id = presetId || "jazz-turnaround";
  let roots;
  switch (id) {
    case "jazz-turnaround": roots = [0, 5, 1, 4]; break;
    case "ii-v-i": roots = [1, 4, 0, 0]; break;
    case "three-step-ii-v-i": roots = [1, 4, 0]; break;
    case "pop-1": roots = [0, 4, 5, 3]; break;
    case "pop-2": roots = [5, 3, 0, 4]; break;
    case "three-step-i-iv-v": roots = [0, 3, 4]; break;
    case "neosoul-1": roots = [0, 2, 3, 1]; break;
    case "neosoul-2": roots = [0, 5, 3, 4]; break;
    case "neosoul-3": roots = [5, 1, 4, 0]; break;
    case "neosoul-4": roots = [3, 0, 4, 5]; break;
    case "neosoul-5": roots = [0, 3, 1, 4]; break;
    case "neosoul-6": roots = [1, 3, 0, 4]; break;
    case "slowjam-1": roots = [0, 3, 0, 4]; break;
    case "slowjam-2": roots = [0, 1, 3, 0]; break;
    case "four-on-one": roots = [0, 0, 0, 0]; break;
    case "circle-4ths": roots = [0, 3, 6, 2, 5, 1, 4, 0]; break;
    default: roots = [0, 5, 1, 4]; break;
  }
  const seg = totalBeats / roots.length;
  return roots.map((r, i) => ({
    startBeat: i * seg,
    endBeat: (i + 1) * seg,
    chordDegrees: triadDegrees(r)
  }));
}

function sliceChordsForWindow(chords, startBeat, endBeat) {
  const out = [];
  for (const c of chords) {
    const s = Math.max(c.startBeat, startBeat);
    const e = Math.min(c.endBeat, endBeat);
    if (e > s) {
      out.push({
        startBeat: s - startBeat,
        endBeat: e - startBeat,
        chordDegrees: c.chordDegrees
      });
    }
  }
  return out;
}

function clampRhythmToTotal(rhythm, targetBeats = 16) {
  const out = [];
  let sum = 0;
  for (let d of rhythm) {
    if (sum + d >= targetBeats) {
      out.push(targetBeats - sum);
      sum = targetBeats;
      break;
    }
    out.push(d);
    sum += d;
  }
  if (sum < targetBeats) out.push(targetBeats - sum);
  return out;
}

function getRhythmSequence(preset) {
  switch (preset) {
    case "even": return new Array(16).fill(1);
    case "syncopated": return [0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 0.5, 1, 2, 0.5, 0.5, 1, 1, 1, 2];
    case "dotted-groove": return [1, 0.75, 0.25, 1.5, 0.5, 0.5, 0.5, 1, 0.75, 0.75, 0.5, 1, 1, 0.5, 0.5, 2];
    case "swing": return [1, 0.5, 0.5, 1, 1, 0.75, 0.25, 1, 1, 0.5, 0.5, 1, 1, 0.75, 0.25, 2];
    case "triplet-feel": return [0.33, 0.33, 0.33, 1, 0.5, 0.5, 1, 1, 0.33, 0.33, 0.33, 1, 1, 1, 0.5, 0.5];
    case "waltz": return [1, 1, 1, 1, 0.5, 0.5, 1, 1, 1, 0.5, 0.5, 1];
    default: return [1, 0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 1, 0.5, 0.5, 2, 1, 1, 2];
  }
}

function buildRhythmToTarget(rhythmPreset, targetBeats) {
  const out = [];
  let sum = 0;
  while (sum < targetBeats - 1e-9) {
    const chunk = getRhythmSequence(rhythmPreset);
    for (const d of chunk) {
      out.push(d);
      sum += d;
      if (sum >= targetBeats - 1e-9) break;
    }
  }
  return clampRhythmToTotal(out, targetBeats);
}

function regenerateMelody() {
  const keyRootMidi = parseInt(keySelect.value, 10);
  const minMidi = parseInt(rangeMinInput.value, 10);
  const maxMidi = parseInt(rangeMaxInput.value, 10);
  const rhythmPreset = rhythmPresetSelect.value;
  const bars = barsSelect ? parseInt(barsSelect.value, 10) : 4;
  const targetBeats = bars * 4;
  
  let rhythmSequence = buildRhythmToTarget(rhythmPreset, targetBeats);
  const totalBeats = rhythmSequence.reduce((sum, v) => sum + v, 0);
  const selectedProg = progPresetSelect ? progPresetSelect.value : "jazz-turnaround";
  const chords = getChordProgressionPreset(selectedProg, totalBeats);

  const config = {
    keyRootMidi,
    minMidi,
    maxMidi,
    totalBeats,
    contourMode: contourModeSelect ? contourModeSelect.value : "none",
    contourStrength: contourStrengthInput ? parseFloat(contourStrengthInput.value) : 0.0
  };

  let result;
  if (totalBeats > 16.0001) {
    const splitBeat = 16;
    const rhythmA = [];
    const rhythmB = [];
    let acc = 0;
    for (const d of rhythmSequence) {
      if (acc < splitBeat - 1e-9) {
        if (acc + d <= splitBeat + 1e-9) {
          rhythmA.push(d);
        } else {
          const aPart = splitBeat - acc;
          const bPart = d - aPart;
          if (aPart > 1e-9) rhythmA.push(aPart);
          if (bPart > 1e-9) rhythmB.push(bPart);
        }
      } else {
        rhythmB.push(d);
      }
      acc += d;
    }
    const chordsA = sliceChordsForWindow(chords, 0, splitBeat);
    const chordsB = sliceChordsForWindow(chords, splitBeat, totalBeats);
    const configA = { ...config, totalBeats: splitBeat };
    const resA = generateMelody(configA, rhythmA, chordsA);
    const configB = { ...config, totalBeats: totalBeats - splitBeat, initialState: resA.endingState };
    const resB = generateMelody(configB, rhythmB, chordsB);
    const shiftedBEvents = resB.events.map((ev) => ({ ...ev, startBeat: ev.startBeat + splitBeat }));
    result = { events: [...resA.events, ...shiftedBEvents] };
  } else {
    result = generateMelody(config, rhythmSequence, chords);
  }

  lastGeneratedMelody = { ...result, totalBeats, minMidi, maxMidi };
  renderJson(result);
  renderPianoRoll(result, minMidi, maxMidi, totalBeats);
}

function renderJson(result) {
  jsonOutputEl.textContent = JSON.stringify(result, null, 2);
}

// ========== PIANO ROLL: WHITE KEY ROWS + BLACK KEY OVERLAYS ==========
function renderPianoRoll(result, minMidi, maxMidi, totalBeats) {
  pianoRollEl.innerHTML = "";

  const height = pianoRollEl.clientHeight || 260;
  const keyboardWidth = 72;
  
  const keyboard = document.createElement("div");
  keyboard.className = "piano-roll-keyboard";
  keyboard.style.height = `${height}px`;
  pianoRollEl.appendChild(keyboard);

  // Helper: check if MIDI note is black key
  const isBlackKey = (midi) => [1, 3, 6, 8, 10].includes(midi % 12);

  // Build list of WHITE keys only
  const whiteKeys = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (!isBlackKey(midi)) {
      whiteKeys.push(midi);
    }
  }

  const numWhiteKeys = whiteKeys.length;
  const whiteKeyHeight = height / numWhiteKeys;

  // Map: MIDI -> white key index (for positioning)
  const whiteKeyMap = {};
  whiteKeys.forEach((midi, idx) => {
    whiteKeyMap[midi] = idx;
  });

  // STEP 1: Render white key rows
  whiteKeys.forEach((midi, idx) => {
    const key = document.createElement("div");
    key.className = "piano-key white";
    const bottom = idx * whiteKeyHeight;
    key.style.bottom = `${bottom}px`;
    key.style.height = `${whiteKeyHeight}px`;
    keyboard.appendChild(key);
  });

  // STEP 2: Render black keys as overlays BETWEEN adjacent white keys
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (isBlackKey(midi)) {
      // Find adjacent white keys
      let below = midi - 1;
      let above = midi + 1;
      
      // Walk to nearest white keys
      while (below >= minMidi && isBlackKey(below)) below--;
      while (above <= maxMidi && isBlackKey(above)) above++;
      
      // If both adjacent white keys exist in range
      if (below >= minMidi && above <= maxMidi && 
          whiteKeyMap[below] !== undefined && 
          whiteKeyMap[above] !== undefined) {
        
        const belowIdx = whiteKeyMap[below];
        const aboveIdx = whiteKeyMap[above];
        
        const key = document.createElement("div");
        key.className = "piano-key black";
        
        // Position between the two white keys
        const bottomPos = belowIdx * whiteKeyHeight;
        const topPos = (aboveIdx + 1) * whiteKeyHeight;
        const blackHeight = topPos - bottomPos;
        
        key.style.bottom = `${bottomPos}px`;
        key.style.height = `${blackHeight}px`;
        
        keyboard.appendChild(key);
      }
    }
  }

  // Timeline
  const viewportWidth = pianoRollEl.clientWidth || 400;
  const timelineViewportWidth = Math.max(viewportWidth - keyboardWidth, 120);
  const zoom = parseFloat(pianoRollEl.dataset.zoom || "1");
  const timelineWidth = timelineViewportWidth * Math.max(zoom, 1);
  const beatToX = (beat) => (beat / totalBeats) * timelineWidth;

  const timelineWrapper = document.createElement("div");
  timelineWrapper.className = "piano-roll-timeline";
  pianoRollEl.appendChild(timelineWrapper);

  const rollContent = document.createElement("div");
  rollContent.className = "piano-roll-content";
  rollContent.style.width = `${beatToX(totalBeats)}px`;
  rollContent.style.height = `${height}px`;
  timelineWrapper.appendChild(rollContent);

  // Grid
  const grid = document.createElement("div");
  grid.className = "piano-roll-grid";
  rollContent.appendChild(grid);

  const beatCount = Math.ceil(totalBeats);
  for (let b = 0; b <= beatCount; b++) {
    const line = document.createElement("div");
    line.className = (b % 4 === 0) ? "beat-line measure-line" : "beat-line";
    line.style.left = beatToX(b) + "px";
    grid.appendChild(line);
  }

  // Measure labels
  const measureLayer = document.createElement("div");
  measureLayer.className = "piano-roll-measure-layer";
  rollContent.appendChild(measureLayer);

  const measureCount = Math.ceil(totalBeats / 4);
  for (let m = 0; m < measureCount; m++) {
    const marker = document.createElement("div");
    marker.className = "measure-marker";
    const startBeat = m * 4;
    const endBeat = Math.min((m + 1) * 4, totalBeats);
    marker.style.left = beatToX(startBeat) + "px";
    marker.style.width = Math.max(beatToX(endBeat) - beatToX(startBeat), 0) + "px";
    
    const label = document.createElement("span");
    label.className = "measure-label";
    label.textContent = `Bar ${m + 1}`;
    marker.appendChild(label);
    measureLayer.appendChild(marker);
  }

  // Helper: MIDI to Y position (based on white key rows)
  const midiToBottom = (midi) => {
    if (isBlackKey(midi)) {
      // Black key: position between adjacent white keys
      let below = midi - 1;
      let above = midi + 1;
      while (below >= minMidi && isBlackKey(below)) below--;
      while (above <= maxMidi && isBlackKey(above)) above--;
      
      if (whiteKeyMap[below] !== undefined && whiteKeyMap[above] !== undefined) {
        const belowBottom = whiteKeyMap[below] * whiteKeyHeight;
        const aboveBottom = whiteKeyMap[above] * whiteKeyHeight;
        return (belowBottom + aboveBottom) / 2;
      }
    }
    
    // White key: use its row position
    if (whiteKeyMap[midi] !== undefined) {
      return whiteKeyMap[midi] * whiteKeyHeight + whiteKeyHeight / 2;
    }
    
    return 0;
  };

  // Render notes
  for (const ev of result.events) {
    const noteEl = document.createElement("div");
    noteEl.className = "piano-roll-note";
    
    const x = beatToX(ev.startBeat);
    const w = beatToX(ev.startBeat + ev.duration) - x;
    const bottom = midiToBottom(ev.midi);
    const h = whiteKeyHeight * 0.7;
    
    noteEl.style.left = x + "px";
    noteEl.style.width = Math.max(w, 2) + "px";
    noteEl.style.bottom = (bottom - h / 2) + "px";
    noteEl.style.height = h + "px";
    
    rollContent.appendChild(noteEl);
  }

  // Y-axis labels
  const labelLow = document.createElement("div");
  labelLow.className = "piano-roll-axis-label";
  labelLow.style.bottom = "2px";
  labelLow.textContent = "MIDI " + minMidi;
  labelLow.style.left = keyboardWidth + 8 + "px";
  pianoRollEl.appendChild(labelLow);

  const labelHigh = document.createElement("div");
  labelHigh.className = "piano-roll-axis-label";
  labelHigh.style.top = "2px";
  labelHigh.textContent = "MIDI " + maxMidi;
  labelHigh.style.left = keyboardWidth + 8 + "px";
  pianoRollEl.appendChild(labelHigh);
}

async function playMelody() {
  if (!lastGeneratedMelody) return;
  const { events } = lastGeneratedMelody;
  await initAudio();
  await ensureRunning();
  const bpm = tempoInput ? parseFloat(tempoInput.value) : 120;
  const secondsPerBeat = 60 / bpm;
  const t0 = now() + 0.75;
  let count = 0;
  for (const ev of events) {
    const startTime = t0 + ev.startBeat * secondsPerBeat;
    const durationSec = ev.duration * secondsPerBeat;
    const vel01 = ev.velocity !== undefined ? ev.velocity / 127 : 0.8;
    playNoteAt({ midi: ev.midi, timeSec: startTime, durationSec, velocity01: vel01 });
    count++;
    if (count % 25 === 0) await new Promise(requestAnimationFrame);
  }
}

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

generateBtn.addEventListener("click", regenerateMelody);
playBtn.addEventListener("click", playMelody);
regenerateMelody();