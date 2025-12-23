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
const progPresetSelect = document.getElementById("prog-preset");
const generateBtn = document.getElementById("btn-generate");
const playBtn = document.getElementById("btn-play");
const barsSelect = document.getElementById("bars");
const contourModeSelect = document.getElementById("contour-mode");
const contourStrengthInput = document.getElementById("contour-strength");
const contourStrengthLabel = document.getElementById("contour-strength-label");
// --- Contour Strength label live update ---
if (contourStrengthInput && contourStrengthLabel) {
  const updateContourLabel = () => {
    contourStrengthLabel.textContent = contourStrengthInput.value;
  };

  updateContourLabel(); // set once on load
  contourStrengthInput.addEventListener("input", updateContourLabel);
  contourStrengthInput.addEventListener("change", updateContourLabel);
} else {
  console.warn("Contour strength elements not found:", {
    contourStrengthInput,
    contourStrengthLabel
  });
}

console.log("barsSelect exists?", !!barsSelect, "value:", barsSelect?.value);
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

// ----------------------------------------
// Chord progression helpers + presets
// ----------------------------------------

function triadDegrees(rootDeg) {
  // Build diatonic triad degrees in-scale: root, third, fifth
  return [
    rootDeg % 7,
    (rootDeg + 2) % 7,
    (rootDeg + 4) % 7
  ];
}

function getChordProgressionPreset(presetId, totalBeats) {
  const id = presetId || "jazz-turnaround";

  // Progressions as SCALE-DEGREE ROOTS
  // (0=I, 1=ii, 2=iii, 3=IV, 4=V, 5=vi, 6=vii°)
  let roots;

  switch (id) {

    // ----------------------------
    // Jazz / Functional
    // ----------------------------
    case "jazz-turnaround":
      roots = [0, 5, 1, 4]; // I–vi–ii–V
      break;

    case "ii-v-i":
      roots = [1, 4, 0, 0]; // ii–V–I–I
      break;

    case "three-step-ii-v-i":
      roots = [1, 4, 0]; // ii–V–I
      break;

    // ----------------------------
    // Pop / Familiar
    // ----------------------------
    case "pop-1":
      roots = [0, 4, 5, 3]; // I–V–vi–IV
      break;

    case "pop-2":
      roots = [5, 3, 0, 4]; // vi–IV–I–V
      break;

    case "three-step-i-iv-v":
      roots = [0, 3, 4]; // I–IV–V
      break;

    // ----------------------------
    // Neo-Soul / R&B-ish (jazzy-adjacent)
    // ----------------------------
    case "neosoul-1":
      roots = [0, 2, 3, 1]; // I–iii–IV–ii
      break;

    case "neosoul-2":
      roots = [0, 5, 3, 4]; // I–vi–IV–V
      break;

    case "neosoul-3":
      roots = [5, 1, 4, 0]; // vi–ii–V–I
      break;

    case "neosoul-4":
      roots = [3, 0, 4, 5]; // IV–I–V–vi
      break;

    case "neosoul-5":
      roots = [0, 3, 1, 4]; // I–IV–ii–V
      break;

    case "neosoul-6":
      roots = [1, 3, 0, 4]; // ii–IV–I–V
      break;

    // ----------------------------
    // Slow Jams
    // ----------------------------
    case "slowjam-1":
      roots = [0, 3, 0, 4]; // I–IV–I–V
      break;

    case "slowjam-2":
      roots = [0, 1, 3, 0]; // I–ii–IV–I
      break;

    // ----------------------------
    // Utility / Structural
    // ----------------------------
    case "four-on-one":
      roots = [0, 0, 0, 0]; // I–I–I–I
      break;

    case "circle-4ths":
      roots = [0, 3, 6, 2, 5, 1, 4, 0]; // I–IV–vii°–iii–vi–ii–V–I
      break;

    default:
      roots = [0, 5, 1, 4];
      break;
  }

  const seg = totalBeats / roots.length;

  return roots.map((r, i) => ({
    startBeat: i * seg,
    endBeat: (i + 1) * seg,
    chordDegrees: triadDegrees(r)
  }));
}
// ----------------------------------------
// Chord slicing helper (for phrase windows)
// ----------------------------------------
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
// ----------------------------------------
// Rhythm length safety clamp
// ----------------------------------------
function clampRhythmToTotal(rhythm, targetBeats = 16) {
  const out = [];
  let sum = 0;

  // Copy until we hit or exceed target
  for (let d of rhythm) {
    if (sum + d >= targetBeats) {
      out.push(targetBeats - sum);
      sum = targetBeats;
      break;
    }
    out.push(d);
    sum += d;
  }

  // Pad if we ended early
  if (sum < targetBeats) {
    out.push(targetBeats - sum);
  }

  return out;
}



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

    // ----------------------------
    // NEW: 6 varied presets
    // ----------------------------

    case "breath-cadence": {
      const out = [];
      let t = 0;
      const total = 16;

      while (t < total - 1e-9) {
        let d;
        const r = Math.random();

        if (r < 0.20) d = 1.5;
        else if (r < 0.65) d = 1.0;
        else d = 0.5;

        if (t + d > total) d = total - t;
        out.push(d);
        t += d;
      }
      return out;
    }

    case "hesitant-pulse": {
      const out = [];
      let t = 0;
      const total = 16;

      while (t < total - 1e-9) {
        let d;
        const r = Math.random();

        if (r < 0.45) d = 1.0;
        else if (r < 0.85) d = 0.5;
        else d = 2.0;

        if (t + d > total) d = total - t;
        out.push(d);
        t += d;
      }
      return out;
    }

    case "burst-drift": {
      const out = [];
      let t = 0;
      const total = 16;

      while (t < total - 1e-9) {
        const r = Math.random();

        if (r < 0.25 && t + 1 <= total + 1e-9) {
          out.push(0.25, 0.25, 0.25, 0.25);
          t += 1.0;
          continue;
        }

        let d = r < 0.70 ? 1.0 : 2.0;
        if (t + d > total) d = total - t;
        out.push(d);
        t += d;
      }
      return out;
    }

    case "motoric-8ths":
      return new Array(32).fill(0.5);

    case "call-response": {
      const out = [];
      const total = 16;
      let t = 0;

      while (t < 8 - 1e-9) {
        let d = Math.random() < 0.65 ? 0.5 : 1.0;
        if (t + d > 8) d = 8 - t;
        out.push(d);
        t += d;
      }

      while (t < total - 1e-9) {
        let d = Math.random() < 0.60 ? 1.0 : 2.0;
        if (t + d > total) d = total - t;
        out.push(d);
        t += d;
      }

      return out;
    }
    case "laidback-pocket": {
  // Neo-Soul / R&B pocket: mostly eighths + quarters, rare 16th pickup
  const out = [];
  let t = 0;
  const total = 16;

  while (t < total - 1e-9) {
    const r = Math.random();
    let d;

    if (r < 0.55) d = 0.5;       // eighth
    else if (r < 0.90) d = 1.0;  // quarter
    else d = 0.25;               // rare pickup (16th)

    if (t + d > total) d = total - t;
    out.push(d);
    t += d;
  }

  return out;
}

case "offbeat-warmth": {
  // Slightly syncopated warmth: dotted-eighth pops in for groove flavor
  const out = [];
  let t = 0;
  const total = 16;

  while (t < total - 1e-9) {
    let d;
    const r = Math.random();

    if (r < 0.45) d = 0.5;        // eighth
    else if (r < 0.75) d = 1.0;   // quarter
    else d = 0.75;                // dotted-eighth feel

    if (t + d > total) d = total - t;
    out.push(d);
    t += d;
  }

  return out;
}

case "slow-bounce": {
  // Head-nod bounce: space without silence (holds instead of gaps)
  const out = [];
  let t = 0;
  const total = 16;

  while (t < total - 1e-9) {
    const r = Math.random();
    let d;

    if (r < 0.40) d = 1.0;       // quarter
    else if (r < 0.75) d = 0.5;  // eighth
    else d = 1.5;                // dotted-quarter hold

    if (t + d > total) d = total - t;
    out.push(d);
    t += d;
  }

  return out;
}

case "neo-shuffle-soft": {
  // Not full swing—just a relaxed long-short shuffle flavor
  const out = [];
  let t = 0;
  const total = 16;

  while (t < total - 1e-9) {
    const r = Math.random();

    // 40% of beats: long-short (0.75 + 0.25), otherwise straight (0.5 + 0.5)
    if (r < 0.40 && t + 1 <= total + 1e-9) {
      out.push(0.75, 0.25);
      t += 1.0;
    } else {
      out.push(0.5, 0.5);
      t += 1.0;
    }
  }

  return out;
}

    case "triplet-waves": {
      const out = [];
      let t = 0;
      const total = 16;
      const third = 1 / 3;

      while (t < total - 1e-9) {
        const r = Math.random();

        if (r < 0.40 && t + 1 <= total + 1e-9) {
          out.push(third, third, third);
          t += 1.0;
        } else if (r < 0.70) {
          out.push(1.0);
          t += 1.0;
        } else {
          out.push(0.5, 0.5);
          t += 1.0;
        }
      }

      const sum = out.reduce((a, b) => a + b, 0);
      if (sum > total + 1e-6) out[out.length - 1] -= (sum - total);

      return out;
    }

    case "waltz":
      return [
        1, 1, 1,
        1, 0.5, 0.5,
        1, 1, 1,
        0.5, 0.5, 1
      ];

    case "default":
    default:
      return [
        1, 0.5, 0.5, 1,
        1, 0.5, 0.5, 1,
        1, 1, 0.5, 0.5,
        2, 1, 1, 2
      ];
  }
}

function buildRhythmToTarget(rhythmPreset, targetBeats) {
  const out = [];
  let sum = 0;

  while (sum < targetBeats - 1e-9) {
    const chunk = getRhythmSequence(rhythmPreset); // re-call gives variation on random presets
    for (const d of chunk) {
      out.push(d);
      sum += d;
      if (sum >= targetBeats - 1e-9) break;
    }
  }

  // Trim final overhang cleanly to exactly targetBeats
  return clampRhythmToTotal(out, targetBeats);
}

// ---------- Main generate function ----------

function regenerateMelody() {
  const keyRootMidi = parseInt(keySelect.value, 10);
  const minMidi = parseInt(rangeMinInput.value, 10);
  const maxMidi = parseInt(rangeMaxInput.value, 10);
  const rhythmPreset = rhythmPresetSelect.value;

  const bars = barsSelect ? parseInt(barsSelect.value, 10) : 4;
  const targetBeats = bars * 4;

  let rhythmSequence = buildRhythmToTarget(rhythmPreset, targetBeats);

  const totalBeats = rhythmSequence.reduce((sum, v) => sum + v, 0);
    console.log("LAST RHYTHM VALUES:", rhythmSequence.slice(-8));

  console.log("Rhythm total beats:", rhythmSequence.reduce((a,b)=>a+b,0));

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


    // If we're longer than 4 bars (16 beats), generate in two connected halves
  let result;

  if (totalBeats > 16.0001) {
    const splitBeat = 16;

    // Split rhythm into A (0..16) and B (16..end)
    const rhythmA = [];
    const rhythmB = [];
    let acc = 0;

    for (const d of rhythmSequence) {
      if (acc < splitBeat - 1e-9) {
        if (acc + d <= splitBeat + 1e-9) {
          rhythmA.push(d);
        } else {
          // split one duration across the boundary
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

    // Slice chords into the same windows (and shift each window to 0-based beats)
    const chordsA = sliceChordsForWindow(chords, 0, splitBeat);
    const chordsB = sliceChordsForWindow(chords, splitBeat, totalBeats);

    // Generate phrase A
    const configA = { ...config, totalBeats: splitBeat };
    const resA = generateMelody(configA, rhythmA, chordsA);

    // Generate phrase B with a tiny hook: seed from phrase A ending state
    const configB = {
      ...config,
      totalBeats: totalBeats - splitBeat,
      initialState: resA.endingState
    };
    const resB = generateMelody(configB, rhythmB, chordsB);

    // Shift phrase B events forward by 16 beats so they land in bars 5–8
    const shiftedBEvents = resB.events.map((ev) => ({
      ...ev,
      startBeat: ev.startBeat + splitBeat
    }));

    result = {
      events: [...resA.events, ...shiftedBEvents]
    };
  } else {
    // Normal 4-bar generation
    result = generateMelody(config, rhythmSequence, chords);
  }


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

  const viewportWidth = pianoRollEl.clientWidth || 400;
  const height = pianoRollEl.clientHeight || 260;
  const keyboardWidth = 72;
  const beatsPerBar = 4;
  const totalNotes = maxMidi - minMidi + 1;
  const noteHeight = height / Math.max(totalNotes, 1);
  const timelineViewportWidth = Math.max(viewportWidth - keyboardWidth, 120);

  // Simple hook to support zoom/scroll in the future without changing callers
  const zoom = parseFloat(pianoRollEl.dataset.zoom || "1");
  const timelineWidth = timelineViewportWidth * Math.max(zoom, 1);
  const beatToX = (beat) => (beat / totalBeats) * timelineWidth;

  // Keyboard column (visual only)
  const keyboard = document.createElement("div");
  keyboard.className = "piano-roll-keyboard";
  keyboard.style.height = `${height}px`;
  pianoRollEl.appendChild(keyboard);

  const isBlackKey = (midi) => {
    const pc = midi % 12;
    return [1, 3, 6, 8, 10].includes(pc);
  };

  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const key = document.createElement("div");
    const black = isBlackKey(midi);
    key.className = `piano-roll-key ${black ? "black" : "white"}`;

    const index = midi - minMidi;
    const top = height - (index + 1) * noteHeight;
    key.style.top = `${top}px`;
    key.style.height = `${noteHeight}px`;

    keyboard.appendChild(key);
  }

  // Timeline wrapper
  const timelineWrapper = document.createElement("div");
  timelineWrapper.className = "piano-roll-timeline";
  pianoRollEl.appendChild(timelineWrapper);

  const rollContent = document.createElement("div");
  rollContent.className = "piano-roll-content";
  rollContent.style.width = `${beatToX(totalBeats)}px`;
  rollContent.style.height = `${height}px`;
  timelineWrapper.appendChild(rollContent);

  const grid = document.createElement("div");
  grid.className = "piano-roll-grid";
  rollContent.appendChild(grid);

  const measureLayer = document.createElement("div");
  measureLayer.className = "piano-roll-measure-layer";
  rollContent.appendChild(measureLayer);
  const beatCount = Math.ceil(totalBeats);
  const measureCount = Math.ceil(totalBeats / beatsPerBar);

  // Beat lines + measure lines (4/4 for now)
  for (let b = 0; b <= beatCount; b++) {
    const line = document.createElement("div");

    // Every beat gets a thin line; every bar gets a thicker line
    line.className = (b % beatsPerBar === 0) ? "beat-line measure-line" : "beat-line";

    line.style.left = beatToX(b) + "px";
    grid.appendChild(line);
  }

  // Measure markers
  for (let m = 0; m < measureCount; m++) {
    const marker = document.createElement("div");
    marker.className = "measure-marker";

    const startBeat = m * beatsPerBar;
    const endBeat = Math.min((m + 1) * beatsPerBar, totalBeats);
    const left = beatToX(startBeat);
    const width = Math.max(beatToX(endBeat) - left, 0);

    marker.style.left = left + "px";
    marker.style.width = width + "px";

    const label = document.createElement("span");
    label.className = "measure-label";
    label.textContent = `Bar ${m + 1}`;
    marker.appendChild(label);

    measureLayer.appendChild(marker);
  }

  const midiToTop = (midi) => {
    const index = midi - minMidi;
    return height - (index + 1) * noteHeight;
  };

  // Notes
  for (const ev of result.events) {
    const noteEl = document.createElement("div");
    noteEl.className = "piano-roll-note";

    const x = beatToX(ev.startBeat);
    const w = beatToX(ev.startBeat + ev.duration) - x;

    const y = midiToTop(ev.midi);
    const h = Math.max(noteHeight - 2, 4);

    noteEl.style.left = x + "px";
    noteEl.style.width = Math.max(w, 2) + "px";
    noteEl.style.top = y + "px";
    noteEl.style.height = h + "px";

    rollContent.appendChild(noteEl);
  }

  // Y-axis labels (fixed to the viewport)
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

// ---------- Playback ----------

async function playMelody() {
  if (!lastGeneratedMelody) return;

  const { events, totalBeats } = lastGeneratedMelody;

  // Boot audio + start context
  await initAudio();
  await ensureRunning();

  const bpm = tempoInput ? parseFloat(tempoInput.value) : 120;
  const secondsPerBeat = 60 / bpm;

  // Small lookahead so messages arrive before playback
  const t0 = now() + 0.75;

  let count = 0;

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

    count++;

    // Yield every 50 notes so postMessage delivery stays timely
    if (count % 25 === 0) {
      await new Promise(requestAnimationFrame);
    }
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
