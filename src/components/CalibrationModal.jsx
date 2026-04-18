export function CalibrationModal() {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-md">
        <h3 className="text-lg font-medium mb-2">Calibrating baseline</h3>
        <p className="text-sm text-gray-400 mb-4">
          Type naturally for 30 seconds — any text. This tunes the Focus score
          to your personal typing speed so it&apos;s not comparing you to an
          average student.
        </p>
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 animate-pulse"
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}
