import { useState, useEffect, useCallback } from 'react';

const KEY = 'drift.calibration';

export function useCalibration() {
  const [cal, setCal] = useState(null);
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setCal(JSON.parse(saved));
    } catch (_) {}
  }, []);

  const startCalibration = useCallback((typingHook) => {
    setCalibrating(true);
    const samples = [];
    const id = setInterval(() => samples.push(typingHook.wpm), 1000);

    setTimeout(() => {
      clearInterval(id);
      const nonZero = samples.filter(s => s > 5);
      const baseline = nonZero.length
        ? Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length)
        : 40;
      const c = {
        baselineWpm: Math.max(25, Math.min(baseline, 90)),
        ts: Date.now(),
      };
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (_) {}
      setCal(c);
      setCalibrating(false);
    }, 30000);
  }, []);

  const reset = useCallback(() => {
    try { localStorage.removeItem(KEY); } catch (_) {}
    setCal(null);
  }, []);

  return { calibration: cal, calibrating, startCalibration, reset };
}
