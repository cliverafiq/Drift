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

  const noisePct = Math.min(Math.round((podData.noise / 2048) * 100), 100);

  return (
    <div className="space-y-6">
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
