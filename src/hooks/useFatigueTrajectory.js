import { useRef, useState, useEffect } from 'react';

/**
 * Trajectory-based fatigue detection.
 *
 * Fatigue is a *delta*, not a snapshot. Someone whose WPM drops 25% from
 * their own session-start rate is fatigued; someone whose absolute WPM is
 * "low" but steady is just a slow typer. We accumulate a personal session
 * baseline for the first BASELINE_MS, freeze it, then score recent EMA
 * values against that baseline.
 *
 * The blink-rate anomaly is U-shaped: both too-low (microsleep / hyperfocus
 * staring) and too-high (exhaustion) are penalized, with low weighted more
 * heavily because it's the dangerous direction.
 *
 * A `durationMultiplier` ramps fatigue weight with session length — a 20%
 * WPM drop at 10 minutes is noise, at 50 minutes it's real.
 */

const BASELINE_MS = 45 * 1000;     // 45s to establish session baseline
const SAMPLE_MS   = 1000;
const EMA_ALPHA   = 0.15;          // slightly responsive so fatigue tracks changes

export function useFatigueTrajectory({ typing, attention, facialFeat }) {
  const [out, setOut] = useState({
    fatigueScore: 0,
    baselineReady: false,
    baseline: null,
    recent: null,
    deltas: {
      wpmDrop: 0,
      errorRise: 0,
      blinkAnomaly: 0,
      lidDroop: 0,
      pitchDrift: 0,
    },
    sessionMinutes: 0,
    durationMultiplier: 1,
  });

  // Latest-values ref so the interval doesn't need to re-subscribe on every prop change
  const latest = useRef({ typing, attention, facialFeat });
  latest.current = { typing, attention, facialFeat };

  const startRef = useRef(null);
  const baselineRef = useRef({ samples: [], frozen: null });
  const emaRef = useRef({
    wpm: null,
    backspaceRate: null,
    blinkRate: null,
    earMean: null,
    pitch: null,
  });

  useEffect(() => {
    startRef.current = Date.now();

    const id = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startRef.current;
      const sessionMinutes = elapsed / 60000;

      const { typing: t, attention: a, facialFeat: f } = latest.current;

      const sample = {
        wpm: t.wpm,
        backspaceRate: t.backspaceRate,
        blinkRate: a.blinkRate,
        earMean: f.earSmoothed,
        pitch: f.headPitch,
      };

      // ---- Baseline accumulation ----
      const b = baselineRef.current;
      if (!b.frozen && elapsed < BASELINE_MS) {
        b.samples.push(sample);
      } else if (!b.frozen && b.samples.length >= 15) {
        const avg = (k) => {
          const vals = b.samples.map(s => s[k]).filter(v => Number.isFinite(v));
          return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        };
        b.frozen = {
          wpm: Math.max(10, avg('wpm')),
          backspaceRate: avg('backspaceRate'),
          blinkRate: Math.max(1, avg('blinkRate')),
          earMean: Math.max(0.18, avg('earMean')),
          pitch: avg('pitch'),
        };
      }

      // ---- EMA current values ----
      for (const k of Object.keys(sample)) {
        const v = sample[k];
        if (!Number.isFinite(v)) continue;
        emaRef.current[k] = emaRef.current[k] === null
          ? v
          : emaRef.current[k] * (1 - EMA_ALPHA) + v * EMA_ALPHA;
      }
      const recent = { ...emaRef.current };

      // Starts ramping after the 1-minute mark (just past baseline freeze).
      const durationMultiplier = Math.min(1.5, Math.max(1, 1 + (sessionMinutes - 1) * 0.02));
      const baselineSecondsLeft = Math.max(0, Math.ceil((BASELINE_MS - elapsed) / 1000));

      // ---- Compute deltas and score ----
      let fatigueScore = 0;
      let deltas = { wpmDrop: 0, errorRise: 0, blinkAnomaly: 0, lidDroop: 0, pitchDrift: 0 };

      if (b.frozen) {
        const wpmDrop = Math.max(0, (b.frozen.wpm - (recent.wpm ?? b.frozen.wpm)) / b.frozen.wpm);
        const errorRise = Math.max(0,
          ((recent.backspaceRate ?? 0) - b.frozen.backspaceRate) / Math.max(0.01, b.frozen.backspaceRate)
        );

        // U-shape anomaly, weighted asymmetrically
        let blinkAnomaly = 0;
        if (Number.isFinite(recent.blinkRate)) {
          const rawDelta = Math.abs(recent.blinkRate - b.frozen.blinkRate) / b.frozen.blinkRate;
          blinkAnomaly = recent.blinkRate < b.frozen.blinkRate
            ? Math.min(1, rawDelta * 1.5)   // low blink = microsleep risk = weight up
            : Math.min(1, rawDelta);
        }

        const lidDroop = Math.max(0,
          (b.frozen.earMean - (recent.earMean ?? b.frozen.earMean)) / b.frozen.earMean
        );
        const pitchDrift = Math.max(0, (recent.pitch ?? 0) - b.frozen.pitch);

        deltas = { wpmDrop, errorRise, blinkAnomaly, lidDroop, pitchDrift };

        const raw =
          0.30 * Math.min(wpmDrop, 1) +
          0.20 * Math.min(errorRise, 1) +
          0.20 * blinkAnomaly +
          0.20 * Math.min(lidDroop, 1) +
          0.10 * Math.min(pitchDrift * 5, 1);

        fatigueScore = Math.max(0, Math.min(100, raw * durationMultiplier * 100));
      }

      setOut({
        fatigueScore,
        baselineReady: !!b.frozen,
        baseline: b.frozen,
        recent,
        deltas,
        sessionMinutes,
        baselineSecondsLeft,
        durationMultiplier,
      });
    }, SAMPLE_MS);

    return () => clearInterval(id);
  }, []);

  return out;
}
