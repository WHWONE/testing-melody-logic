// melodyEngine.js
// Unified Melody 1 engine - plain JS, UI-agnostic

///////////////////////
// Utility helpers
///////////////////////

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function weightedChoice(items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    // fallback: pick first
    return items[0];
  }
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

///////////////////////
// Scale / pitch helpers
///////////////////////

// Simple major scale for now. You can expand to modes later.
const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11];

function buildScalePitches(rootMidi, octaves = 3) {
  const pitches = [];
  const startOctave = Math.floor(rootMidi / 12) - 1;
  for (let o = 0; o < octaves; o++) {
    const base = (startOctave + o) * 12;
    for (let i = 0; i < MAJOR_SCALE_STEPS.length; i++) {
      pitches.push(base + MAJOR_SCALE_STEPS[i]);
    }
  }
  return pitches.sort((a, b) => a - b);
}

// Return nearest scale degree index (0..6) for a given pitch within the scale
function nearestScaleDegree(pitch, scalePitches) {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < scalePitches.length; i++) {
    const d = Math.abs(scalePitches[i] - pitch);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return bestIndex % MAJOR_SCALE_STEPS.length;
}

// Return pitch for given scale degree index (0..6) in a given register range
function choosePitchForDegree(
  scaleDegree,
  scalePitches,
  minMidi,
  maxMidi,
  targetRegisterMidi
) {
  const candidates = [];
  for (let i = 0; i < scalePitches.length; i++) {
    if (i % MAJOR_SCALE_STEPS.length === scaleDegree) {
      const p = scalePitches[i];
      if (p >= minMidi && p <= maxMidi) {
        candidates.push(p);
      }
    }
  }
  if (candidates.length === 0) {
    // fallback: just clamp root into range
    return clamp(scalePitches[0], minMidi, maxMidi);
  }
  // pick candidate closest to targetRegisterMidi
  let best = candidates[0];
  let bestDist = Math.abs(best - targetRegisterMidi);
  for (const p of candidates) {
    const d = Math.abs(p - targetRegisterMidi);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

///////////////////////
// Phrase module
///////////////////////

// For now, assume totalBeats is 16 (4 bars of 4/4). This can be generalized.
function buildPhrasePlan(totalBeats, config) {
  const phrases = [];
  const phraseCount = 4;
  const phraseLength = totalBeats / phraseCount;

  const roles = ["statement", "answer", "development", "cadence"];
  const shapes = ["arch", "arch", "rising", "falling"];

  for (let i = 0; i < phraseCount; i++) {
    const startBeat = i * phraseLength;
    const endBeat = startBeat + phraseLength;
    const isLast = i === phraseCount - 1;

    phrases.push({
      id: "P" + (i + 1),
      startBeat,
      endBeat,
      role: roles[i],
      shape: shapes[i],
      targetScaleDegree: isLast ? 0 : 0, // tonic for now
      targetStrength: isLast ? "strong" : "open",
      minRegister: config.minMidi,
      maxRegister: config.maxMidi,
      hasUniquePeak: !isLast,
      targetPeakBeat: !isLast ? startBeat + phraseLength * 0.6 : null
    });
  }

  return phrases;
}

function findPhraseAtBeat(phrases, beat) {
  return (
    phrases.find((p) => beat >= p.startBeat && beat < p.endBeat) ||
    phrases[phrases.length - 1]
  );
}

///////////////////////
// Motif module
///////////////////////

// Simple: make 1–2 motifs in scale steps & relative rhythm.
function buildMotifs(config) {
  const motifs = [];

  motifs.push({
    id: "M_A",
    role: "primary",
    lengthBeats: 2,
    notes: [
      { offsetBeats: 0.0, durationBeats: 0.5, intervalFromStart: 0 },
      { offsetBeats: 0.5, durationBeats: 0.5, intervalFromStart: +1 },
      { offsetBeats: 1.0, durationBeats: 1.0, intervalFromStart: -1 }
    ]
  });

  motifs.push({
    id: "M_B",
    role: "secondary",
    lengthBeats: 2,
    notes: [
      { offsetBeats: 0.0, durationBeats: 0.5, intervalFromStart: 0 },
      { offsetBeats: 0.5, durationBeats: 0.5, intervalFromStart: +2 },
      { offsetBeats: 1.0, durationBeats: 0.5, intervalFromStart: -1 },
      { offsetBeats: 1.5, durationBeats: 0.5, intervalFromStart: 0 }
    ]
  });

  return motifs;
}

function buildMotifPlan(phrases, motifs) {
  // Very simple: P1 uses M_A, P2 uses transposed M_A, P3 uses M_B, P4 uses stretched M_A
  return [
    {
      phraseId: "P1",
      motifId: "M_A",
      transform: { transposeSteps: 0, rhythmStretch: 1.0 }
    },
    {
      phraseId: "P2",
      motifId: "M_A",
      transform: { transposeSteps: 2, rhythmStretch: 1.0 }
    },
    {
      phraseId: "P3",
      motifId: "M_B",
      transform: { transposeSteps: 4, rhythmStretch: 1.0 }
    },
    {
      phraseId: "P4",
      motifId: "M_A",
      transform: { transposeSteps: 0, rhythmStretch: 2.0 }
    }
  ];
}

function findActiveMotifNoteAtBeat(phrase, motifs, motifPlan, beatWithinPhrase) {
  const assignment = motifPlan.find((mp) => mp.phraseId === phrase.id);
  if (!assignment) return null;
  const motif = motifs.find((m) => m.id === assignment.motifId);
  if (!motif) return null;

  const stretch = assignment.transform.rhythmStretch || 1.0;

  for (const n of motif.notes) {
    const start = n.offsetBeats * stretch;
    const end = start + n.durationBeats * stretch;
    if (beatWithinPhrase >= start && beatWithinPhrase < end) {
      return {
        motifNote: n,
        transform: assignment.transform
      };
    }
  }
  return null;
}

///////////////////////
// Harmony module (simple)
///////////////////////

// chords: [{ startBeat, endBeat, chordDegrees: [0,2,4,...] }]
// chordDegrees are scale-degree indices (0..6) representing chord tones.
function findChordAtBeat(chords, beat) {
  return (
    chords.find((c) => beat >= c.startBeat && beat < c.endBeat) ||
    chords[chords.length - 1]
  );
}

///////////////////////
// Note selection / scoring
///////////////////////

function scoreCandidatePitch({
  candidateMidi,
  candidateDegree,
  lastMidi,
  lastDegree,
  phrase,
  motifContext,
  chord,
  beat,
  duration,
  config
}) {
  let score = 1.0;

  // 1) Step vs leap preference
  if (lastMidi !== null) {
    const interval = Math.abs(candidateMidi - lastMidi);
    if (interval === 0) score *= 0.6; // avoid too many repeats
    else if (interval <= 2) score *= 1.3; // small step
    else if (interval <= 5) score *= 1.1; // small leap
    else if (interval <= 12) score *= 0.7; // big leap
    else score *= 0.4; // huge leap
  }

  // 2) Leap resolution: if last move was big, favor opposite step
  if (config.memory.lastIntervalSemitones !== null && lastMidi !== null) {
    const lastInt = config.memory.lastIntervalSemitones;
    const bigLeap = Math.abs(lastInt) >= 7;
    const thisInt = candidateMidi - lastMidi;
    if (bigLeap) {
      if (Math.sign(thisInt) === Math.sign(lastInt)) {
        score *= 0.5;
      } else if (Math.abs(thisInt) <= 2) {
        score *= 1.4;
      }
    }
  }

  // 3) Harmony awareness: chord tones vs tensions
  if (chord) {
    const isChordTone = chord.chordDegrees.includes(candidateDegree);
    const isStrongBeat = Math.abs(beat - Math.round(beat)) < 0.001;
    if (isChordTone && isStrongBeat) {
      score *= 1.5;
    } else if (isChordTone) {
      score *= 1.2;
    } else if (!isChordTone && isStrongBeat) {
      score *= 0.7;
    }
  }

  // 4) Phrase targeting near phrase end
  const phraseProgress =
    (beat - phrase.startBeat) / (phrase.endBeat - phrase.startBeat);
  if (phraseProgress > 0.7) {
    if (candidateDegree === phrase.targetScaleDegree) {
      score *= 1.5;
    }
  }

  // 5) Motif adherence
  if (motifContext && config.memory.phraseStartMidi !== null) {
    const rootMidi = config.memory.phraseStartMidi;
    const expected =
      rootMidi + motifContext.motifNote.intervalFromStart * 2; // rough step -> 2 semitones
    const dist = Math.abs(candidateMidi - expected);
    if (dist < 3) score *= 1.4;
    else if (dist < 6) score *= 1.1;
    else score *= 0.8;
  }

  // 6) Register / tessitura
  const midRegister = (phrase.minRegister + phrase.maxRegister) / 2;
  const distFromMid = Math.abs(candidateMidi - midRegister);
  if (distFromMid > 12) score *= 0.6;

  // 7) Long notes: prefer chord tones more strongly
  if (duration >= 1.0 && chord) {
    const isChordTone = chord.chordDegrees.includes(candidateDegree);
    if (isChordTone) score *= 1.3;
    else score *= 0.8;
  }

  return score;
}

///////////////////////
// Main engine
///////////////////////

// ---------------------
// Silence / rests model
// ---------------------

function getSilencePlanForPhraseRole(role) {
  // "A vs B" feel: statement = A (more continuous), answer = B (more breathing)
  // development/cadence are treated as slightly more spacious.
  switch (role) {
    case "statement":
      return {
        budgetMax: 1,
        pPhraseEndRest: 0.12,
        pCadenceAnticipation: 0.18,
        pOrnamentBreath: 0.35
      };
    case "answer":
      return {
        budgetMax: 2,
        pPhraseEndRest: 0.22,
        pCadenceAnticipation: 0.28,
        pOrnamentBreath: 0.45
      };
    case "development":
      return {
        budgetMax: 2,
        pPhraseEndRest: 0.18,
        pCadenceAnticipation: 0.22,
        pOrnamentBreath: 0.40
      };
    case "cadence":
      return {
        budgetMax: 2,
        pPhraseEndRest: 0.28,
        pCadenceAnticipation: 0.35,
        pOrnamentBreath: 0.45
      };
    default:
      return {
        budgetMax: 1,
        pPhraseEndRest: 0.15,
        pCadenceAnticipation: 0.20,
        pOrnamentBreath: 0.35
      };
  }
}

function beatIsStrong(beat) {
  return Math.abs(beat - Math.round(beat)) < 0.001;
}


export function generateMelody(config, rhythmSequence, chords) {
  const totalBeats = config.totalBeats || 16;

  // Scale setup
  const scalePitches = buildScalePitches(config.keyRootMidi, 5);

  // Phrase & motif setup
const phrases = buildPhrasePlan(totalBeats, config);

const motifs = buildMotifs(config);
const motifPlan = buildMotifPlan(phrases, motifs);

const events = [];
let currentBeat = 0;

// Tiny hook: allow seeding phrase 2 from phrase 1 ending state
const initial = config.initialState || null;

let lastMidi = initial?.lastMidi ?? null;
let lastDegree = initial?.lastDegree ?? null;

// memory object to track across notes
config.memory = {
  lastIntervalSemitones: null,
  phraseStartMidi: null,
  ...(initial?.memory || {})
};



  // Track phrase-level "silence budget" so we don't overdo rests.
const silenceStateByPhrase = new Map();
function getPhraseSilenceState(p) {
  if (!silenceStateByPhrase.has(p.id)) {
    const plan = getSilencePlanForPhraseRole(p.role);
    silenceStateByPhrase.set(p.id, {
      budgetUsed: 0,
      budgetMax: plan.budgetMax,
      plan
    });
  }
  return silenceStateByPhrase.get(p.id);
}


  for (let i = 0; i < rhythmSequence.length; i++) {
    const duration = rhythmSequence[i];
    const phrase = findPhraseAtBeat(phrases, currentBeat);
    const beatWithinPhrase = currentBeat - phrase.startBeat;
    const phraseLen = phrase.endBeat - phrase.startBeat;
const phraseProgress = phraseLen > 0 ? beatWithinPhrase / phraseLen : 0;
const beatsRemainingInPhrase = Math.max(0, phrase.endBeat - currentBeat);

const silenceState = getPhraseSilenceState(phrase);
const silencePlan = silenceState.plan;
const budgetLeft = silenceState.budgetUsed < silenceState.budgetMax;


    // find chord at this moment
    const chord = findChordAtBeat(chords, currentBeat);
    // -----------------------------
// MUSICAL RESTS (hierarchical)
// 1) Phrase-end rest (occasional)
// 2) Anticipatory silence before cadence moments (handled after pitch selection)
// 3) Breath after ornament (handled later as tail-rest inside the slot)
// -----------------------------

// Phrase-end rest: only consider if we're at/near the end of the phrase and have budget.
const isPhraseEndingSlot = beatsRemainingInPhrase <= duration + 0.0001;
if (budgetLeft && isPhraseEndingSlot) {
  if (Math.random() < silencePlan.pPhraseEndRest) {
    // Rest for the whole slot.
    silenceState.budgetUsed += 1;
    currentBeat += duration;
    continue;
  }
}

        // ----- NEW: optional rests -----
    // Demo rule: small chance of a rest, but avoid resting on strong beats too often.
    //const isStrongBeat = Math.abs(currentBeat - Math.round(currentBeat)) < 0.001;

    // Tune these two numbers:
    //const restChance = isStrongBeat ? 0.10 : 0.18; // fewer rests on strong beats
    //const allowRest = duration >= 0.5;            // avoid absurdly tiny rests

    //if (allowRest && Math.random() < restChance) {
      // Rest: don't add any events, just advance time.
     //currentBeat += duration;
      //continue;
    //}
    // --- Silence controls (defined once per slot) ---
    let preRestBeats = 0;   // anticipatory silence BEFORE the note inside this slot
    let tailRestBeats = 0;  // tiny breath AFTER ornamentation inside this slot


    // motif context
    const motifContext = findActiveMotifNoteAtBeat(
      phrase,
      motifs,
      motifPlan,
      beatWithinPhrase
    );

    // Determine candidate scale degrees 0..6
    const candidateDegrees = [0, 1, 2, 3, 4, 5, 6];

    // Choose target register midpoint for this note
    const phraseMid = (phrase.minRegister + phrase.maxRegister) / 2;

    const candidates = [];

    for (const deg of candidateDegrees) {
      const midi = choosePitchForDegree(
        deg,
        scalePitches,
        phrase.minRegister,
        phrase.maxRegister,
        phraseMid
      );

      const score = scoreCandidatePitch({
        candidateMidi: midi,
        candidateDegree: deg,
        lastMidi,
        lastDegree,
        phrase,
        motifContext,
        chord,
        beat: currentBeat,
        duration,
        config
      });

      candidates.push({
        midi,
        degree: deg,
        score
      });
    }

    const chosen = weightedChoice(candidates, (c) => c.score) || candidates[0];
    // -----------------------------
// Anticipatory silence before cadences
// (tiny rest *inside* this slot, before the note group)
// -----------------------------

const canPreRest = budgetLeft && duration >= 0.5;
const nearingPhraseEnd = phraseProgress > 0.70;
const cadenceTarget = chosen.degree === phrase.targetScaleDegree;

if (canPreRest && nearingPhraseEnd && cadenceTarget) {
  if (Math.random() < silencePlan.pCadenceAnticipation) {
    preRestBeats = Math.min(0.125, duration * 0.25); // up to an 1/8 note
    silenceState.budgetUsed += 1;
  }
}

    

    // Update memory
    if (phrase && config.memory.phraseStartMidi === null) {
      config.memory.phraseStartMidi = chosen.midi;
    }
    if (lastMidi !== null) {
      config.memory.lastIntervalSemitones = chosen.midi - lastMidi;
    }

    // ----- NEW: velocity variation -----
const strongBeatForVel = beatIsStrong(currentBeat);
let velocity = strongBeatForVel ? 115 : 85;


const phraseProgressVel =
  (currentBeat - phrase.startBeat) / (phrase.endBeat - phrase.startBeat);
if (phraseProgressVel > 0.7) {
  // get a bit louder near the end of the phrase
  velocity += 10;
    }

    velocity = Math.max(40, Math.min(127, Math.round(velocity)));

    // ----- NEW: optional grace note -----
    const canGrace = duration >= 0.5; // don't try on tiny notes
    const addGrace = canGrace && Math.random() < 0.45; // 15% chance
    // NEW: slot timing controls for musical breathing
    // (for now, keep these at 0; later they come from phrase logic)

    const slotStartBeat = currentBeat + preRestBeats;
    const playableDuration = Math.max(0.05, duration - preRestBeats);


    if (addGrace) {
      const graceDuration = Math.min(0.25, playableDuration / 3);

      // Leave a tiny gap after ornamentation by shortening the main note
      let effectiveTail = tailRestBeats;
      let mainDuration = playableDuration - graceDuration - effectiveTail;

      if (mainDuration < 0.05) {
        effectiveTail = 0;
        mainDuration = playableDuration - graceDuration;
      }

      const graceMidi = chosen.midi - 1; // half-step below
      const graceVelocity = Math.max(40, Math.min(127, velocity - 15));

      // quick pickup note
      events.push({
        startBeat: slotStartBeat,
        duration: graceDuration,
        midi: graceMidi,
        velocity: graceVelocity
      });

      // main note slightly later
      events.push({
        startBeat: slotStartBeat + graceDuration,
        duration: mainDuration,
        midi: chosen.midi,
        velocity
      });
    } else {
      // normal single note
      let effectiveTail = tailRestBeats;
      let noteDur = playableDuration - effectiveTail;

      if (noteDur < 0.05) {
        effectiveTail = 0;
        noteDur = playableDuration;
      }

      events.push({
        startBeat: slotStartBeat,
        duration: noteDur,
        midi: chosen.midi,
        velocity
      });
    }



    lastMidi = chosen.midi;
    lastDegree = chosen.degree;
    currentBeat += duration;

  }

  return {
    events,
    phrases,
    motifs,
    motifPlan,

    // Tiny hook: expose final melodic state for continuation
    endingState: {
      lastMidi,
      lastDegree,
      memory: { ...config.memory }
    }
  };
}
