import { useEffect, useRef, useState } from 'react';

const WINDOW_MS = 30000;   // rolling window for WPM, pauses, backspaces
const IDLE_MS   = 8000;    // no keystroke for 8s = idle (reading mode)
const TICK_MS   = 500;     // recompute cadence when user pauses
const PAUSE_GAP = 3000;    // >3s between keys counts as a pause

export function useTypingTelemetry() {
  const [metrics, setMetrics] = useState({
    wpm: 0,
    pauseRate: 0,
    backspaceRate: 0,
    active: false,
    idle: true,
  });

  const events = useRef([]); // { time, isBackspace }

  useEffect(() => {
    const compute = () => {
      const now = Date.now();
      // Trim to rolling window
      events.current = events.current.filter(e => now - e.time < WINDOW_MS);
      const recent = events.current;

      if (recent.length === 0) {
        setMetrics({ wpm: 0, pauseRate: 0, backspaceRate: 0, active: false, idle: true });
        return;
      }

      const lastEventAge = now - recent[recent.length - 1].time;
      const idle = lastEventAge > IDLE_MS;

      // WPM: 5 chars = 1 word, scaled to per-minute
      const minutes = WINDOW_MS / 60000;
      const wpm = Math.min(Math.round((recent.length / 5) / minutes), 140);

      // Pauses: gaps >3s between consecutive keydowns in the window
      let pauses = 0;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i].time - recent[i - 1].time > PAUSE_GAP) pauses++;
      }
      const pauseRate = recent.length > 1 ? pauses / (recent.length - 1) : 0;

      // Windowed backspace rate (not lifetime)
      const backspaces = recent.filter(e => e.isBackspace).length;
      const backspaceRate = backspaces / recent.length;

      setMetrics({
        wpm,
        pauseRate,
        backspaceRate,
        active: !idle && recent.length >= 3,
        idle,
      });
    };

    const handleKeyDown = (e) => {
      // Ignore modifier-only presses
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      events.current.push({ time: Date.now(), isBackspace: e.key === 'Backspace' });
      compute();
    };

    window.addEventListener('keydown', handleKeyDown);
    const tickId = setInterval(compute, TICK_MS);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(tickId);
    };
  }, []);

  return metrics;
}
