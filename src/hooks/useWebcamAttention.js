import { useEffect, useRef, useState, useCallback } from 'react';

// Load an external script exactly once, returning a Promise that resolves on load.
const scriptCache = new Map();
function loadScript(src) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  scriptCache.set(src, p);
  return p;
}

// Eye Aspect Ratio (distance-independent). Uses FaceMesh left-eye landmarks:
//   horizontal: 33 (outer)  — 133 (inner)
//   vertical 1: 159 (upper) — 145 (lower)
//   vertical 2: 158 (upper) — 153 (lower)
function eyeAspectRatio(lm) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const v1 = dist(lm[159], lm[145]);
  const v2 = dist(lm[158], lm[153]);
  const h  = dist(lm[33],  lm[133]);
  if (h === 0) return 0.3;
  return (v1 + v2) / (2 * h);
}

const EAR_CLOSED = 0.19;   // below this = eye closed
const EAR_OPEN   = 0.24;   // above this = eye open (hysteresis)

export function useWebcamAttention(videoRef) {
  const [attention, setAttention] = useState({
    gazeScore: 0,
    blinkRate: 15,
    faceDetected: false,
    loading: true,
    error: null,
  });

  const blinkTimes  = useRef([]);
  const eyeState    = useRef('open');
  const lastBlinkTs = useRef(0);
  const faceMeshRef = useRef(null);
  const rafIdRef    = useRef(null);
  const streamRef   = useRef(null);
  const mountedRef  = useRef(true);

  const start = useCallback(async () => {
    mountedRef.current = true;
    try {
      // 1. Grab camera first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // 2. Load MediaPipe sequentially (prevents race condition)
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js');
      if (!mountedRef.current) return;

      const faceMesh = new window.FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      faceMeshRef.current = faceMesh;

      faceMesh.onResults((results) => {
        if (!mountedRef.current) return;
        const now = Date.now();

        const faces = results.multiFaceLandmarks;
        if (!faces || faces.length === 0) {
          setAttention(prev => ({
            ...prev,
            gazeScore: 0,
            faceDetected: false,
            loading: false,
          }));
          return;
        }

        const lm = faces[0];

        // Gaze from head yaw: nose tip offset vs midpoint of ears
        const nose     = lm[1];
        const leftEar  = lm[234];
        const rightEar = lm[454];
        const earMid   = (leftEar.x + rightEar.x) / 2;
        const yaw      = Math.abs(nose.x - earMid);
        const gazeScore = Math.max(0, Math.min(1, 1 - yaw * 8));

        // Blink via EAR with hysteresis
        const ear = eyeAspectRatio(lm);
        if (eyeState.current === 'open' && ear < EAR_CLOSED) {
          eyeState.current = 'closed';
        } else if (eyeState.current === 'closed' && ear > EAR_OPEN) {
          eyeState.current = 'open';
          if (now - lastBlinkTs.current > 200) {
            blinkTimes.current.push(now);
            lastBlinkTs.current = now;
          }
        }
        blinkTimes.current = blinkTimes.current.filter(t => now - t < 60000);

        setAttention({
          gazeScore,
          blinkRate: blinkTimes.current.length,
          faceDetected: true,
          loading: false,
          error: null,
        });
      });

      // 3. Our own RAF-driven processing loop
      const tick = async () => {
        if (!mountedRef.current) return;
        if (videoRef.current && videoRef.current.readyState >= 2) {
          try { await faceMesh.send({ image: videoRef.current }); } catch (_) { /* per-frame errors ignored */ }
        }
        rafIdRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.error('Webcam error:', err);
      if (mountedRef.current) {
        setAttention(prev => ({ ...prev, loading: false, error: err.message }));
      }
    }
  }, [videoRef]);

  useEffect(() => {
    start();
    return () => {
      mountedRef.current = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (faceMeshRef.current) { try { faceMeshRef.current.close(); } catch (_) {} }
    };
  }, [start]);

  return attention;
}
