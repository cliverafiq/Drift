import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export function Dashboard({
  scores,
  typing,
  attention,
  facialFeat,
  fatigue,
  userState,
  podData,
  history,
  sessionActive,
}) {
  const { focusScore, fatigueScore, prompt, promptType } = scores;

  const promptColors = {
    good:  'text-green-400 border-green-800 bg-green-950',
    warn:  'text-yellow-400 border-yellow-800 bg-yellow-950',
    break: 'text-red-400 border-red-800 bg-red-950',
  };

  const stateStyles = {
    ACTIVE_TYPING:  'text-blue-300 bg-blue-950 border-blue-800',
    THINKING_PAUSE: 'text-purple-300 bg-purple-950 border-purple-800',
    READING:        'text-teal-300 bg-teal-950 border-teal-800',
    DISTRACTED:     'text-yellow-300 bg-yellow-950 border-yellow-800',
    FATIGUED_DRIFT: 'text-red-300 bg-red-950 border-red-800',
    AWAY:           'text-gray-400 bg-gray-900 border-gray-700',
    UNKNOWN:        'text-gray-400 bg-gray-900 border-gray-800',
  };

  const noisePct = Math.min(Math.round((podData.noise / 2048) * 100), 100);
  const lightPct = Math.min(Math.round((podData.light / 4095) * 100 * 6), 100);
  const lightHint = podData.alive
    ? (lightPct < 20 ? 'dim — eye strain risk' : 'good')
    : (podData.connected ? 'silent' : 'offline');

  const baseline = fatigue?.baseline;
  const recent = fatigue?.recent;
  const wpmDeltaPct = baseline && recent
    ? Math.round(((recent.wpm - baseline.wpm) / baseline.wpm) * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* Mode selector row (driven by the rotary knob) */}
      <ModeSelector mode={podData.mode} pendingMode={podData.pendingMode} alive={podData.alive} />

      {/* State pill row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${stateStyles[userState?.state] || stateStyles.UNKNOWN}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {userState?.label || 'Warming up'}
        </div>
        {fatigue?.baselineReady ? (
          <div className="text-[11px] text-gray-500">
            session baseline: <span className="text-gray-300">{Math.round(baseline.wpm)} wpm</span>
            {wpmDeltaPct !== null && (
              <span className={`ml-2 ${wpmDeltaPct < -10 ? 'text-red-400' : wpmDeltaPct < 0 ? 'text-yellow-400' : 'text-gray-400'}`}>
                now {Math.round(recent.wpm)} wpm ({wpmDeltaPct > 0 ? '+' : ''}{wpmDeltaPct}%)
              </span>
            )}
            <span className="ml-2">· fatigue trajectory: <span className="text-gray-300">{fatigueScore}</span></span>
          </div>
        ) : (
          <div className="text-[11px] text-gray-600">
            building session baseline · {fatigue?.baselineSecondsLeft ?? 45}s left
          </div>
        )}
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-2 gap-4">
        <ScoreCard label="Focus"   value={focusScore}   color="blue" />
        <ScoreCard label="Fatigue" value={fatigueScore} color="orange" invert />
      </div>

      {/* Action prompt */}
      <div className={`border rounded-xl px-5 py-4 text-sm font-medium ${promptColors[promptType]}`}>
        {sessionActive ? prompt : 'Press "Start session" to begin tracking'}
      </div>

      {/* Signal breakdown */}
      <div className="grid grid-cols-4 gap-3">
        <SignalPill
          label="Typing WPM"
          value={typing.wpm}
          unit="wpm"
          max={80}
          hint={typing.idle ? 'reading mode' : (typing.active ? 'active' : 'warming up')}
        />
        <SignalPill
          label="Gaze"
          value={Math.round(attention.gazeScore * 100)}
          unit="%"
          max={100}
          hint={attention.faceDetected ? 'on screen' : 'no face'}
        />
        <SignalPill
          label="Room noise"
          value={noisePct}
          unit="%"
          max={100}
          invert
          hint={podData.alive ? 'live' : (podData.connected ? 'silent' : 'offline')}
        />
        <SignalPill
          label="Room light"
          value={lightPct}
          unit="%"
          max={100}
          badBelow={20}
          hint={lightHint}
        />
      </div>

      {/* Strain signals (facial trajectory) */}
      {facialFeat?.baselineReady && (
        <div className="grid grid-cols-4 gap-3">
          <StrainBar label="Brow furrow"  value={facialFeat.browFurrow} />
          <StrainBar label="Lid droop"    value={facialFeat.lidDroop} />
          <StrainBar label="Head drop"    value={Math.min(1, facialFeat.headPitch * 5)} />
          <StrainBar label="Mouth / yawn" value={Math.min(1, facialFeat.mouthOpen * 10)} />
        </div>
      )}

      {/* Timeline */}
      {history.length > 1 && (
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="text-sm text-gray-400 mb-4">Session timeline</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: 8,
                }}
                labelStyle={{ color: '#9ca3af' }}
              />
              <Line
                type="monotone"
                dataKey="focus"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Focus"
              />
              <Line
                type="monotone"
                dataKey="fatigue"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                name="Fatigue"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Debug strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
        <span className={attention.faceDetected ? 'text-green-600' : 'text-gray-700'}>
          ● {attention.faceDetected
              ? 'face detected'
              : (attention.loading ? 'loading mediapipe' : 'no face')}
        </span>
        <span>·</span>
        <span>blink {attention.blinkRate}/min</span>
        <span>·</span>
        <span>backspace {Math.round(typing.backspaceRate * 100)}%</span>
        <span>·</span>
        <span>pause rate {Math.round(typing.pauseRate * 100)}%</span>
      </div>
    </div>
  );
}

function ScoreCard({ label, value, color, invert }) {
  const palette = {
    blue:   { bar: 'bg-blue-500',   text: 'text-blue-400'   },
    orange: { bar: 'bg-orange-500', text: 'text-orange-400' },
  }[color];
  const barWidth = invert ? (100 - value) : value;

  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-4xl font-medium ${palette.text}`}>
        {value}
        <span className="text-xl">%</span>
      </p>
      <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${palette.bar}`}
          style={{ width: `${Math.max(0, Math.min(100, barWidth))}%` }}
        />
      </div>
    </div>
  );
}

function StrainBar({ label, value }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const barColor = pct > 60 ? 'bg-red-500' : pct > 30 ? 'bg-yellow-500' : 'bg-gray-600';
  return (
    <div className="bg-gray-900 rounded-lg p-3">
      <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-base text-gray-200 font-medium">{pct}</span>
        <span className="text-[10px] text-gray-500">/100</span>
      </div>
      <div className="mt-1.5 h-1 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SignalPill({ label, value, unit, max, invert, hint, badBelow = 40, badAbove = 60 }) {
  const pct = Math.min((value / max) * 100, 100);
  const isBad = invert ? pct > badAbove : pct < badBelow;
  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-medium ${isBad ? 'text-red-400' : 'text-gray-200'}`}>
        {value}
        <span className="text-xs text-gray-500 ml-0.5">{unit}</span>
      </p>
      {hint && <p className="text-[10px] text-gray-600 mt-0.5">{hint}</p>}
    </div>
  );
}

// Drives off podData.mode (committed) and podData.pendingMode (knob-preview).
// The committed mode glows; if the user is mid-scroll (pending != committed)
// the pending mode shows a faint outline + "click knob to confirm" hint.
function ModeSelector({ mode = 'STUDY', pendingMode = 'STUDY', alive }) {
  const MODES = [
    { key: 'STUDY',   label: 'Study',        hint: 'balanced · typing + gaze + focus signals' },
    { key: 'READING', label: 'Reading',      hint: 'gaze + expression dominant · typing off' },
    { key: 'PRESENT', label: 'Presentation', hint: 'no typing · calm + quiet + eye contact' },
  ];
  const previewing = pendingMode !== mode;

  return (
    <div className="bg-gray-900 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Pod mode · rotary knob</p>
        {!alive && <p className="text-[10px] text-gray-600">pod offline — last known</p>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {MODES.map(m => {
          const isCommitted = m.key === mode;
          const isPending   = previewing && m.key === pendingMode;
          const cls = isCommitted
            ? 'border-blue-500 bg-blue-950 text-blue-200'
            : isPending
              ? 'border-dashed border-blue-700 bg-gray-900 text-blue-300'
              : 'border-gray-800 bg-gray-900 text-gray-500';
          return (
            <div key={m.key} className={`border rounded-lg px-3 py-2 ${cls}`}>
              <p className="text-sm font-medium tracking-wide">{m.label}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{m.hint}</p>
              {isPending && (
                <p className="text-[10px] text-blue-400 mt-1">click knob to confirm</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
