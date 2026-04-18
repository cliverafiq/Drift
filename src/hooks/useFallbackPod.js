import { useState, useEffect } from 'react';

/**
 * Demo-only fallback: if the real ESP32 won't connect, this simulates a
 * realistic noise/light stream so the dashboard keeps working. The physical
 * pod should still sit on the table as a prop — be honest with judges if
 * you have to enable this.
 */
export function useFallbackPod(enabled) {
  const [data, setData] = useState({
    noise: 300,
    light: 2200,
    connected: true,
    alive: true,
    supported: true,
  });

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const t = Date.now() / 8000;
      const noise = Math.round(250 + Math.sin(t) * 120 + Math.random() * 80);
      const light = Math.round(2200 + Math.sin(t / 3) * 300);
      setData({ noise, light, connected: true, alive: true, supported: true });
    }, 2000);
    return () => clearInterval(id);
  }, [enabled]);

  return data;
}
