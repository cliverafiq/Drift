import { useRef, useEffect, useState } from 'react';
import { STATES } from './useUserState';

/**
 * State-weighted focus scoring with trajectory-based fatigue.
 *
 * Each signal is normalized to a 0..100 sub-score; the final focus value is
 * a state-dependent weighted mean of those sub-scores, minus a penalty
 * proportional to the fatigue trajectory score. The fatigue score itself is
 * passed through from useFatigueTrajectory (it's authoritative — not
 * re-derived here).
 *
 * The state-dependent weights mean signals are interpreted in context:
 *   - Active typing: typing-heavy, gaze still matters
 *   - Thinking pause: ignore typing entirely, gaze + expression dominate
 *   - Distracted: gaze is almost everything
 *   - Fatigued drift: expression and fatigue dominate, typing penalized less
 *   - Away: hold last value (avoid score collapse during bio breaks)
 *
 * Mode overlays (set via the rotary knob on the pod):
 *   - STUDY     — balanced default, used for general coding / writing work.
 *   - READING   — gaze- and expression-dominant; typing contribution zeroed
 *                 across all states (you're not supposed to be typing).
 *   - PRESENT   — mic-on-screen mode; typing zeroed, expression + noise
 *                 matter most (are you looking at your deck, is the room
 *                 loud, are you tense).
 *
 * Every row still sums to 1.0 so mode switches don't change the score's
 * overall scale.
 */

const OUT_ALPHA = 0.25;

const STUDY_WEIGHTS = {
  [STATES.ACTIVE_TYPING]:  { typingSpeed: 0.25, typingConsistency: 0.25, gaze: 0.30, expression: 0.10, noise: 0.05, light: 0.05 },
  [STATES.THINKING_PAUSE]: { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.60, expression: 0.25, noise: 0.10, light: 0.05 },
  [STATES.READING]:        { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.55, expression: 0.30, noise: 0.10, light: 0.05 },
  [STATES.DISTRACTED]:     { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.70, expression: 0.15, noise: 0.10, light: 0.05 },
  [STATES.FATIGUED_DRIFT]: { typingSpeed: 0.15, typingConsistency: 0.15, gaze: 0.20, expression: 0.40, noise: 0.05, light: 0.05 },
  [STATES.AWAY]:           null, // hold last value
  [STATES.UNKNOWN]:        { typingSpeed: 0.20, typingConsistency: 0.20, gaze: 0.40, expression: 0.10, noise: 0.05, light: 0.05 },
};

// Reading mode: typing contributions drop to 0; gaze dominates; light matters
// more (dim pages = eye strain). Freed weight goes to gaze and expression.
const READING_WEIGHTS = {
  [STATES.ACTIVE_TYPING]:  { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.55, expression: 0.25, noise: 0.10, light: 0.10 },
  [STATES.THINKING_PAUSE]: { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.60, expression: 0.20, noise: 0.10, light: 0.10 },
  [STATES.READING]:        { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.60, expression: 0.20, noise: 0.10, light: 0.10 },
  [STATES.DISTRACTED]:     { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.75, expression: 0.10, noise: 0.05, light: 0.10 },
  [STATES.FATIGUED_DRIFT]: { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.30, expression: 0.45, noise: 0.05, light: 0.20 },
  [STATES.AWAY]:           null,
  [STATES.UNKNOWN]:        { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.60, expression: 0.20, noise: 0.10, light: 0.10 },
};

// Presentation mode: typing ignored. Expression (calm vs tense) and noise
// (silent room = polished delivery) lead. Gaze still matters — you should
// be looking at the screen/audience, not the laptop.
const PRESENTATION_WEIGHTS = {
  [STATES.ACTIVE_TYPING]:  { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.35, expression: 0.40, noise: 0.20, light: 0.05 },
  [STATES.THINKING_PAUSE]: { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.35, expression: 0.40, noise: 0.20, light: 0.05 },
  [STATES.READING]:        { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.40, expression: 0.35, noise: 0.20, light: 0.05 },
  [STATES.DISTRACTED]:     { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.55, expression: 0.20, noise: 0.20, light: 0.05 },
  [STATES.FATIGUED_DRIFT]: { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.25, expression: 0.50, noise: 0.20, light: 0.05 },
  [STATES.AWAY]:           null,
  [STATES.UNKNOWN]:        { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.40, expression: 0.35, noise: 0.20, light: 0.05 },
};

const WEIGHT_TABLES = {
  STUDY:   STUDY_WEIGHTS,
  READING: READING_WEIGHTS,
  PRESENT: PRESENTATION_WEIGHTS,
};

export function useScoreFusion({
  typing,
  attention,
  podData,
  calibration,
  facialFeat,
  fatigue,
  userState,
}) {
  const [out, setOut] = useState({
    focusScore: 50,
    fatigueScore: 0,
    prompt: 'Start typing to begin',
    promptType: 'good',
    state: STATES.UNKNOWN,
    components: { typingSpeed: 0, typingConsistency: 0, gaze: 0, expression: 0, noise: 0 },
  });

  const focusEma   = useRef(50);
  const fatigueEma = useRef(0);

  useEffect(() => {
    const baselineWpm = Math.max(25, calibration?.baselineWpm ?? 50);

    // ── Sub-scores, each 0..100 ──
    const typingSpeed       = Math.min(100, (typing.wpm / baselineWpm) * 100);
    const typingConsistency = Math.max(0, 100 - typing.backspaceRate * 500);

    const gaze = attention.faceDetected
      ? attention.gazeScore * 100
      : (attention.loading ? 50 : 20);

    // Expression: invert strain — less strain = higher focus component.
    // Neutral 70 until baseline is ready so we don't punish the first 30s.
    const expression = facialFeat.baselineReady
      ? (1 - facialFeat.strainIndex) * 100
      : 70;

    const noise = Math.max(0, 100 - Math.min(100, (podData.noise - 200) / 20));

    // Ambient light: ramp 0 at raw ≤200 (very dim) → 100 at raw ≥1500 (well-lit).
    // Tune the constants to your LDR wiring; high raw = bright (pulldown config).
    const light = Math.max(0, Math.min(100, ((podData.light ?? 0) - 200) / 13));

    const components = { typingSpeed, typingConsistency, gaze, expression, noise, light };

    // ── Mode-aware, state-weighted focus ──
    const modeTable = WEIGHT_TABLES[podData.mode] ?? STUDY_WEIGHTS;
    const weights   = modeTable[userState.state] ?? modeTable[STATES.UNKNOWN];

    let focusTarget;
    if (weights === null) {
      // AWAY — hold last value
      focusTarget = focusEma.current;
    } else {
      const weighted =
        weights.typingSpeed       * typingSpeed +
        weights.typingConsistency * typingConsistency +
        weights.gaze              * gaze +
        weights.expression        * expression +
        weights.noise             * noise +
        weights.light             * light;
      // Fatigue shaves up to 40 pts
      focusTarget = Math.max(0, Math.min(100, weighted - fatigue.fatigueScore * 0.4));
    }

    focusEma.current   = focusEma.current   * (1 - OUT_ALPHA) + focusTarget * OUT_ALPHA;
    fatigueEma.current = fatigueEma.current * (1 - OUT_ALPHA) + fatigue.fatigueScore * OUT_ALPHA;

    const focusScore   = Math.round(focusEma.current);
    const fatigueScore = Math.round(fatigueEma.current);

    // ── State-aware action prompt ──
    let prompt = 'Keep going';
    let promptType = 'good';

    if (userState.state === STATES.AWAY) {
      prompt = 'Come back to your desk';
      promptType = 'warn';
    } else if (userState.state === STATES.FATIGUED_DRIFT && fatigueScore > 35) {
      prompt = 'Fatigue climbing — 5-minute break';
      promptType = 'break';
    } else if (fatigueScore > 65) {
      prompt = 'High fatigue — step away briefly';
      promptType = 'break';
    } else if (userState.state === STATES.DISTRACTED) {
      prompt = 'Drifting — anchor back to your work';
      promptType = 'warn';
    } else if (userState.state === STATES.READING) {
      prompt = 'Reading mode — locked in';
      promptType = 'good';
    } else if (userState.state === STATES.THINKING_PAUSE) {
      prompt = 'Thinking — take your time';
      promptType = 'good';
    } else if (focusScore >= 75) {
      prompt = 'In the zone';
      promptType = 'good';
    } else if (focusScore < 35) {
      prompt = 'Refocus — what are you working on?';
      promptType = 'break';
    } else if (focusScore < 55) {
      prompt = 'Focus slipping';
      promptType = 'warn';
    }

    setOut({
      focusScore,
      fatigueScore,
      prompt,
      promptType,
      state: userState.state,
      components,
    });
  }, [typing, attention, podData, calibration, facialFeat, fatigue, userState]);

  return out;
}
