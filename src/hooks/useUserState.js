import { useMemo, useRef, useState, useEffect } from 'react';

/**
 * Context-aware state machine.
 *
 * Interprets typing/gaze/expression signals relative to the user's current
 * activity. "Not typing" means something totally different if your eyes are
 * on the screen vs. off it. This makes the downstream focus score state-
 * aware: a thinking pause shouldn't punish you, a distracted pause should.
 *
 * Returned state is one of:
 *   ACTIVE_TYPING    keys flowing
 *   THINKING_PAUSE   no keys, eyes on screen, normal expression
 *   READING          no keys, eyes locked, abnormally slow blinks
 *   DISTRACTED       eyes off screen
 *   FATIGUED_DRIFT   eyes on screen but strain signals are elevated
 *   AWAY             face not detected, typing idle
 *   UNKNOWN          transitional / loading
 */

export const STATES = {
  ACTIVE_TYPING:  'ACTIVE_TYPING',
  THINKING_PAUSE: 'THINKING_PAUSE',
  READING:        'READING',
  DISTRACTED:     'DISTRACTED',
  FATIGUED_DRIFT: 'FATIGUED_DRIFT',
  AWAY:           'AWAY',
  UNKNOWN:        'UNKNOWN',
};

export const STATE_LABELS = {
  ACTIVE_TYPING:  'Active typing',
  THINKING_PAUSE: 'Thinking',
  READING:        'Reading',
  DISTRACTED:     'Distracted',
  FATIGUED_DRIFT: 'Fatigued',
  AWAY:           'Away',
  UNKNOWN:        'Warming up',
};

export function useUserState({ typing, attention, facialFeat }) {
  const classified = useMemo(() => {
    if (!attention.faceDetected && typing.idle) return STATES.AWAY;
    if (typing.active) return STATES.ACTIVE_TYPING;

    const gaze = attention.gazeScore;
    const strain = facialFeat.strainIndex;

    if (gaze > 0.6 && strain > 0.5) return STATES.FATIGUED_DRIFT;
    if (gaze < 0.4) return STATES.DISTRACTED;
    if (gaze > 0.6 && attention.blinkRate < 8) return STATES.READING;
    if (gaze > 0.5) return STATES.THINKING_PAUSE;

    return STATES.UNKNOWN;
  }, [
    typing.active,
    typing.idle,
    attention.faceDetected,
    attention.gazeScore,
    attention.blinkRate,
    facialFeat.strainIndex,
  ]);

  const [state, setState] = useState(STATES.UNKNOWN);
  const enteredAtRef = useRef(Date.now());
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (state !== classified) {
      enteredAtRef.current = Date.now();
      setState(classified);
    }
  }, [classified, state]);

  // Tick once per second so timeInState stays roughly fresh even if no other
  // props change (e.g. user sitting still in DISTRACTED).
  useEffect(() => {
    const id = setInterval(() => forceRender(x => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const timeInState = Date.now() - enteredAtRef.current;

  return { state, label: STATE_LABELS[state], timeInState, STATES };
}
