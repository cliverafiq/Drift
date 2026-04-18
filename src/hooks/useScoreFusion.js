import { useRef, useEffect, useState } from 'react';

const OUT_ALPHA = 0.25; // smoothing on output scores

export function useScoreFusion(typing, attention, podData, calibration) {
  const [out, setOut] = useState({
    focusScore: 50,
    fatigueScore: 20,
    prompt: 'Start typing to begin',
    promptType: 'good',
    raw: { gaze: 0, typingSpeed: 0, typingConsistency: 0, noisePenalty: 1 },
  });

  const focusEma   = useRef(50);
  const fatigueEma = useRef(20);

  useEffect(() => {
    const baselineWpm = Math.max(25, calibration?.baselineWpm ?? 50);

    // ── INPUT NORMALIZATION ──────────────────────────────
    const typingSpeed       = Math.min(typing.wpm / baselineWpm, 1);
    const typingConsistency = Math.max(0, 1 - typing.pauseRate * 3);
    const noisePenalty      = Math.max(0, 1 - (podData.noise / 2048) * 0.7);

    // Gaze handling
    let gaze;
    if (attention.faceDetected) {
      gaze = attention.gazeScore;
    } else if (attention.loading) {
      gaze = 0.5; // neutral while MediaPipe warms up
    } else {
      gaze = 0.2; // no face = away from desk
    }

    // ── FOCUS SCORE ──────────────────────────────────────
    let focusRaw;
    if (typing.idle) {
      focusRaw =
        gaze         * 0.75 +
        noisePenalty * 0.25;
    } else {
      focusRaw =
        typingSpeed       * 0.25 +
        typingConsistency * 0.25 +
        gaze              * 0.40 +
        noisePenalty      * 0.10;
    }
    const focusTarget = Math.max(0, Math.min(100, focusRaw * 100));

    // ── FATIGUE SCORE ────────────────────────────────────
    const blinkFatigue = Math.min(Math.max(0, (attention.blinkRate - 12) / 20), 1);
    const errorFatigue = Math.min(typing.backspaceRate * 3, 1);
    const speedDrop    = typing.active ? Math.max(0, 1 - typingSpeed) * 0.5 : 0;

    const fatigueRaw =
      blinkFatigue * 0.50 +
      errorFatigue * 0.30 +
      speedDrop    * 0.20;
    const fatigueTarget = Math.max(0, Math.min(100, fatigueRaw * 100));

    // Smooth outputs
    focusEma.current   = focusEma.current   * (1 - OUT_ALPHA) + focusTarget   * OUT_ALPHA;
    fatigueEma.current = fatigueEma.current * (1 - OUT_ALPHA) + fatigueTarget * OUT_ALPHA;

    const focusScore   = Math.round(focusEma.current);
    const fatigueScore = Math.round(fatigueEma.current);

    // Action prompt
    let prompt = 'Keep going';
    let promptType = 'good';
    if (!attention.faceDetected && !attention.loading) {
      prompt = 'Come back to your desk';
      promptType = 'warn';
    } else if (fatigueScore > 65) {
      prompt = 'Take a 5-minute break';
      promptType = 'break';
    } else if (focusScore < 35) {
      prompt = 'Refocus — close the distracting tab';
      promptType = 'break';
    } else if (focusScore < 55) {
      prompt = 'Drifting — anchor back to your task';
      promptType = 'warn';
    } else if (focusScore >= 75) {
      prompt = 'In the zone';
      promptType = 'good';
    }

    setOut({
      focusScore,
      fatigueScore,
      prompt,
      promptType,
      raw: { gaze, typingSpeed, typingConsistency, noisePenalty },
    });
  }, [typing, attention, podData, calibration]);

  return out;
}
