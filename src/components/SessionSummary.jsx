export function SessionSummary({ history, onRestart }) {
  if (history.length < 2) {
    return (
      <div className="text-center py-20 text-gray-500">
        Session too short to summarize — try at least 30 seconds.
        <br />
        <button
          onClick={onRestart}
          className="mt-4 px-4 py-2 bg-blue-600 rounded-lg text-white text-sm"
        >
          Start again
        </button>
      </div>
    );
  }

  const avg = (arr, key) =>
    Math.round(arr.reduce((s, h) => s + h[key], 0) / arr.length);
  const avgFocus   = avg(history, 'focus');
  const avgFatigue = avg(history, 'fatigue');

  const driftPoint = history.find(h => h.focus < 50);
  const peakFocus  = Math.max(...history.map(h => h.focus));
  const endFocus   = history[history.length - 1].focus;
  const startFocus = history[0].focus;
  const focusTrend = endFocus - startFocus;

  const insights = [];
  if (driftPoint && driftPoint !== history[0])
    insights.push(`Focus first dipped below 50% at ${driftPoint.label}`);
  if (focusTrend < -15)
    insights.push(`Focus declined ${Math.abs(focusTrend)} points across the session`);
  else if (focusTrend > 15)
    insights.push(`Focus improved ${focusTrend} points — you warmed up into the task`);
  if (avgFatigue > 60)
    insights.push('High fatigue — consider shorter blocks with breaks');
  if (peakFocus >= 80)
    insights.push(`Peak focus of ${peakFocus}% — note what you were doing then`);
  if (insights.length === 0)
    insights.push('Focus stayed stable across the session');

  const suggestion =
    avgFocus >= 70
      ? 'Strong session. You can extend blocks to 45–60 minutes.'
      : avgFocus >= 45
      ? 'Try 25-minute blocks with 5-minute breaks (Pomodoro).'
      : 'Try 15-minute blocks and remove one visible distraction.';

  const durationSec = history.length * 10;
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium mb-1">Session complete</h2>
        <p className="text-gray-500 text-sm">
          {mins}m {secs}s tracked · {history.length} snapshots
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SummaryCard
          label="Avg focus"
          value={`${avgFocus}%`}
          color={avgFocus >= 60 ? 'green' : 'red'}
        />
        <SummaryCard
          label="Avg fatigue"
          value={`${avgFatigue}%`}
          color={avgFatigue <= 40 ? 'green' : 'red'}
        />
      </div>

      <div className="bg-gray-900 rounded-xl p-5 space-y-2">
        <p className="text-sm font-medium text-gray-300">What happened</p>
        {insights.map((ins, i) => (
          <p key={i} className="text-sm text-gray-400">· {ins}</p>
        ))}
      </div>

      <div className="bg-blue-950 border border-blue-800 rounded-xl p-5">
        <p className="text-sm font-medium text-blue-300 mb-1">Suggestion</p>
        <p className="text-sm text-blue-200">{suggestion}</p>
      </div>

      <button
        onClick={onRestart}
        className="w-full py-3 bg-blue-600 rounded-xl text-sm font-medium hover:bg-blue-500"
      >
        Start new session
      </button>
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  const c = { green: 'text-green-400', red: 'text-red-400' }[color];
  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-medium ${c}`}>{value}</p>
    </div>
  );
}
