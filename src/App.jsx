import { useRef, useState, useEffect } from 'react';
import { useTypingTelemetry }   from './hooks/useTypingTelemetry';
import { useWebcamAttention }   from './hooks/useWebcamAttention';
import { useFacialFeatures }    from './hooks/useFacialFeatures';
import { useFatigueTrajectory } from './hooks/useFatigueTrajectory';
import { useUserState }         from './hooks/useUserState';
import { useSerialPod }         from './hooks/useSerialPod';
import { useScoreFusion }       from './hooks/useScoreFusion';
import { useCalibration }       from './hooks/useCalibration';
import { useFallbackPod }       from './hooks/useFallbackPod';
import { Dashboard }            from './components/Dashboard';
import { SessionSummary }       from './components/SessionSummary';
import { CalibrationModal }     from './components/CalibrationModal';

export default function App() {
  const videoRef = useRef(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [history, setHistory] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [fallback, setFallback] = useState(false);
  const startTimeRef = useRef(null);

  const typing      = useTypingTelemetry();
  const attention   = useWebcamAttention(videoRef);
  const facialFeat  = useFacialFeatures(attention.landmarks);
  const fatigue     = useFatigueTrajectory({ typing, attention, facialFeat });
  const userState   = useUserState({ typing, attention, facialFeat });
  const { podData: realPod, connect, sendFocusScore, sendBuzz } = useSerialPod();
  const fakePod     = useFallbackPod(fallback);
  const pod         = fallback ? fakePod : realPod;

  const { calibration, calibrating, startCalibration } = useCalibration();
  const scores = useScoreFusion({
    typing,
    attention,
    podData: pod,
    calibration,
    facialFeat,
    fatigue,
    userState,
  });

  // Latest-values ref so the snapshot interval doesn't need to depend on `scores`
  const latest = useRef({ scores, fallback });
  useEffect(() => { latest.current = { scores, fallback }; }, [scores, fallback]);

  // --- Audible nudges ---
  // Behavior: on entering DISTRACTED or FATIGUED_DRIFT, fire a first beep,
  // then keep pulsing a short blip until the user returns to a focused state.
  // Low-focus dips get a single one-shot nudge (no nagging) so we don't
  // over-alert when numbers are noisy.
  const buzzRef = useRef({
    prevFocus: null,
    lowSince:  null,
  });

  // Nag loop while in a "bad" state: beeps until the state flips back.
  useEffect(() => {
    if (!sessionActive || !pod.connected || !pod.alive) return;

    const isDistracted = userState.state === 'DISTRACTED';
    const isFatigued   = userState.state === 'FATIGUED_DRIFT';
    if (!isDistracted && !isFatigued) return;

    // 1) First beep — fires immediately on entry.
    const firstMs = isFatigued ? 200 : 120;
    sendBuzz(firstMs);

    // 2) Rapid nag pulses until state changes. Fatigued is more urgent.
    const pulseMs    = isFatigued ? 80  : 60;
    const intervalMs = isFatigued ? 500 : 700;

    const id = setInterval(() => {
      sendBuzz(pulseMs);
    }, intervalMs);

    return () => clearInterval(id);
  }, [userState.state, sessionActive, pod.connected, pod.alive, sendBuzz]);

  // One-shot low-focus dip: cross from >=50 down below 40 and stay low ~10s.
  useEffect(() => {
    if (!sessionActive || !pod.connected || !pod.alive) return;

    const now = Date.now();
    const b   = buzzRef.current;
    const f   = scores.focusScore;

    if (typeof f !== 'number') return;

    if (f < 40) {
      if (b.lowSince === null && (b.prevFocus == null || b.prevFocus >= 50)) {
        b.lowSince = now;
      }
      if (b.lowSince !== null && now - b.lowSince >= 10_000) {
        sendBuzz(150);
        b.lowSince = null; // only fire once per dip
      }
    } else if (f >= 50) {
      b.lowSince = null; // recovered
    }
    b.prevFocus = f;
  }, [scores.focusScore, sessionActive, pod.connected, pod.alive, sendBuzz]);

  // Snapshot every 10s during a session
  useEffect(() => {
    if (!sessionActive) return;
    const id = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.round((now - startTimeRef.current) / 1000);
      const { scores: s } = latest.current;
      setHistory(prev => [...prev, {
        t: elapsed,
        label: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`,
        focus: s.focusScore,
        fatigue: s.fatigueScore,
      }]);
      sendFocusScore(s.focusScore);
    }, 10000);
    return () => clearInterval(id);
  }, [sessionActive, sendFocusScore]);

  const start = () => {
    startTimeRef.current = Date.now();
    setHistory([]);
    setShowSummary(false);
    setSessionActive(true);
  };
  const end = () => {
    setSessionActive(false);
    setShowSummary(true);
  };

  return (
    <div className="min-h-screen p-6">
      {/* Video stays in the DOM but off-screen so MediaPipe can read it */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="fixed -left-[9999px] w-[640px] h-[480px]"
      />

      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Drift</h1>
            <p className="text-gray-500 text-sm">
              cognitive focus tracker
              {calibration && (
                <span className="ml-2 text-gray-600">
                  · baseline {calibration.baselineWpm} wpm
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {!calibration && !sessionActive && (
              <button
                onClick={() => startCalibration(typing)}
                className="px-3 py-2 text-xs border border-gray-700 rounded-lg hover:bg-gray-800"
              >
                Calibrate (30s)
              </button>
            )}

            {pod.connected ? (
              <span className={`text-sm ${pod.alive ? 'text-green-400' : 'text-yellow-400'}`}>
                ● Pod {pod.alive ? 'live' : 'silent'}
              </span>
            ) : pod.supported ? (
              <button
                onClick={connect}
                className="px-4 py-2 text-sm border border-gray-700 rounded-lg hover:bg-gray-800"
              >
                Connect pod
              </button>
            ) : (
              <span className="text-yellow-500 text-xs">Use Chrome for pod</span>
            )}

            <button
              onClick={() => setFallback(v => !v)}
              className={`px-2 py-1 text-[10px] rounded border ${
                fallback
                  ? 'border-red-700 text-red-400'
                  : 'border-gray-800 text-gray-600'
              }`}
              title="Demo-only fallback if real pod fails"
            >
              {fallback ? 'FALLBACK ON' : 'fallback'}
            </button>

            {!sessionActive ? (
              <button
                onClick={start}
                className="px-4 py-2 text-sm bg-blue-600 rounded-lg hover:bg-blue-500"
              >
                Start session
              </button>
            ) : (
              <button
                onClick={end}
                className="px-4 py-2 text-sm bg-red-600 rounded-lg hover:bg-red-500"
              >
                End session
              </button>
            )}
          </div>
        </div>

        {showSummary ? (
          <SessionSummary history={history} onRestart={start} />
        ) : (
          <Dashboard
            scores={scores}
            typing={typing}
            attention={attention}
            facialFeat={facialFeat}
            fatigue={fatigue}
            userState={userState}
            podData={pod}
            history={history}
            sessionActive={sessionActive}
          />
        )}

        {calibrating && <CalibrationModal />}
      </div>
    </div>
  );
}
