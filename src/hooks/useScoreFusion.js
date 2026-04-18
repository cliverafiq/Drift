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
 */

const OUT_ALPHA = 0.25;

const STATE_WEIGHTS = {
  [STATES.ACTIVE_TYPING]:  { typingSpeed: 0.25, typingConsistency: 0.25, gaze: 0.30, expression: 0.10, noise: 0.10 },
  [STATES.THINKING_PAUSE]: { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.60, expression: 0.25, noise: 0.15 },
  [STATES.READING]:        { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.55, expression: 0.30, noise: 0.15 },
  [STATES.DISTRACTED]:     { typingSpeed: 0.00, typingConsistency: 0.00, gaze: 0.70, expression: 0.15, noise: 0.15 },
  [STATES.FATIGUED_DRIFT]: { typingSpeed: 0.15, typingConsistency: 0.15, gaze: 0.20, expression: 0.40, noise: 0.10 },
  [STATES.AWAY]:           null, // hold last value
  [STATES.UNKNOWN]:        { typingSpeed: 0.20, typingConsistency: 0.20, gaze: 0.40, expression: 0.10, noise: 0.10 },
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

    const components = { typingSpeed, typingConsistency, gaze, expression, noise };

    // ── State-weighted focus ──
    const weights = STATE_WEIGHTS[userState.state] ?? STATE_WEIGHTS[STATES.UNKNOWN];

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
        weights.noise             * noise;
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
