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

  const baseline = fatigue?.baseline;
  const recent = fatigue?.recent;
  const wpmDeltaPct = baseline && recent
    ? Math.round(((recent.wpm - baseline.wpm) / baseline.wpm) * 100)
    : null;

  return (
    <div className="space-y-6">
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
            building session baseline · {Math.max(0, Math.ceil(5 - (fatigue?.sessionMinutes ?? 0)))}m left
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
      <div className="grid grid-cols-3 gap-3">
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

function SignalPill({ label, value, unit, max, invert, hint }) {
  const pct = Math.min((value / max) * 100, 100);
  const isBad = invert ? pct > 60 : pct < 40;
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
