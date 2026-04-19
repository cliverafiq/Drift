import { useState, useRef, useCallback, useEffect } from 'react';

const EMA_ALPHA = 0.3;   // higher = more responsive, lower = smoother

// Order must match MODE_NAMES in firmware: STUDY -> READING -> PRESENT.
export const MODES = ['STUDY', 'READING', 'PRESENT'];
const MODE_SET = new Set(MODES);

export function useSerialPod() {
  const [podData, setPodData] = useState({
    noise: 0,
    light: 2048,
    connected: false,
    alive: false,
    supported: typeof navigator !== 'undefined' && 'serial' in navigator,
    mode: 'STUDY',         // committed mode (from MODE: lines)
    pendingMode: 'STUDY',  // previewed mode (from MODE_PREVIEW: lines)
  });

  const portRef       = useRef(null);
  const readerRef     = useRef(null);
  const writerRef     = useRef(null);
  const connectingRef = useRef(false);
  const mountedRef    = useRef(true);
  const noiseEmaRef   = useRef(0);
  const lightEmaRef   = useRef(2048);
  const lastAliveRef  = useRef(0);

  const ema = (prev, next) => prev * (1 - EMA_ALPHA) + next * EMA_ALPHA;

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    if (!('serial' in navigator)) {
      alert('WebSerial is not supported. Use Chrome or Edge.');
      return;
    }
    connectingRef.current = true;

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;

      // Writer
      const encoder = new TextEncoderStream();
      encoder.readable.pipeTo(port.writable).catch(() => {});
      writerRef.current = encoder.writable.getWriter();

      // Reader
      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      setPodData(prev => ({ ...prev, connected: true }));

      let buffer = '';
      while (mountedRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          if (line === 'READY' || line === 'PONG' || line === 'BOOT') {
            lastAliveRef.current = Date.now();
            setPodData(prev => ({ ...prev, alive: true }));
          } else if (line.startsWith('DATA:')) {
            const [n, l] = line.slice(5).split(',').map(s => parseInt(s, 10));
            if (!Number.isNaN(n) && !Number.isNaN(l)) {
              noiseEmaRef.current = ema(noiseEmaRef.current, n);
              lightEmaRef.current = ema(lightEmaRef.current, l);
              lastAliveRef.current = Date.now();
              setPodData(prev => ({
                ...prev,
                noise: Math.round(noiseEmaRef.current),
                light: Math.round(lightEmaRef.current),
                alive: true,
              }));
            }
          } else if (line.startsWith('MODE_PREVIEW:')) {
            const m = line.slice(13).trim();
            if (MODE_SET.has(m)) {
              lastAliveRef.current = Date.now();
              setPodData(prev => ({ ...prev, pendingMode: m, alive: true }));
            }
          } else if (line.startsWith('MODE:')) {
            const m = line.slice(5).trim();
            if (MODE_SET.has(m)) {
              lastAliveRef.current = Date.now();
              setPodData(prev => ({ ...prev, mode: m, pendingMode: m, alive: true }));
            }
          }
        }
      }
    } catch (err) {
      console.error('Serial error:', err);
      setPodData(prev => ({ ...prev, connected: false, alive: false }));
    } finally {
      connectingRef.current = false;
    }
  }, []);

  const sendFocusScore = useCallback(async (score) => {
    const w = writerRef.current;
    if (!w) return;
    try { await w.write(`FOCUS:${Math.round(score)}\n`); } catch (_) {}
  }, []);

  const sendBuzz = useCallback(async (ms) => {
    const w = writerRef.current;
    if (!w) return;
    const clamped = Math.max(30, Math.min(2000, Math.round(ms)));
    try { await w.write(`BUZZ:${clamped}\n`); } catch (_) {}
  }, []);

  // Manually set the mode from the UI (useful for demo fallback when the
  // encoder isn't wired, or for a "reset to STUDY" affordance). Just flips
  // local state — the pod stays on whatever its own knob says.
  const setMode = useCallback((m) => {
    if (!MODE_SET.has(m)) return;
    setPodData(prev => ({ ...prev, mode: m, pendingMode: m }));
  }, []);

  // Aliveness watchdog — if no line for 8s, mark pod not alive
  useEffect(() => {
    const id = setInterval(() => {
      const age = Date.now() - lastAliveRef.current;
      if (age > 8000) {
        setPodData(prev => (prev.alive ? { ...prev, alive: false } : prev));
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      (async () => {
        try { if (readerRef.current) await readerRef.current.cancel(); } catch (_) {}
        try { if (writerRef.current) await writerRef.current.close(); } catch (_) {}
        try { if (portRef.current)   await portRef.current.close(); } catch (_) {}
      })();
    };
  }, []);

  return { podData, connect, sendFocusScore, sendBuzz, setMode };
}
