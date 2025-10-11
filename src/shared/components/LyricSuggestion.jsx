/**
 * LyricSuggestion - AI missing line suggestion display component
 *
 * Features:
 * - Shows suggested missing line with timing
 * - Displays confidence, reason, pitch activity
 * - Add as New Line, Copy, Delete actions
 */

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function LyricSuggestion({ suggestion, suggestionIndex, onAccept, onDelete }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(suggestion.suggested_text);
      // Could show temporary "Copied!" feedback
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  const startTime = formatTime(suggestion.start_time);
  const endTime = formatTime(suggestion.end_time);

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-medium">
          <span className="material-icons">lightbulb</span>
          Suggested Missing Line ({startTime} - {endTime})
        </span>
        <button
          className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900 rounded transition"
          title="Delete this suggestion"
          onClick={() => onDelete(suggestionIndex)}
        >
          <span className="material-icons text-gray-600 dark:text-gray-400">delete</span>
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Suggested Text:
          </label>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 text-gray-900 dark:text-gray-100">
            {suggestion.suggested_text}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400">
          <span>Confidence: {suggestion.confidence}</span>
          <span>Reason: {suggestion.reason}</span>
          {suggestion.pitch_activity && <span>Pitch Activity: {suggestion.pitch_activity}</span>}
        </div>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            title="Add this as a new lyric line"
            onClick={() => onAccept(suggestionIndex)}
          >
            <span className="material-icons text-sm">add_circle</span>
            Add as New Line
          </button>
          <button
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition"
            title="Copy suggested text"
            onClick={handleCopy}
          >
            <span className="material-icons text-sm">content_copy</span>
            Copy Text
          </button>
        </div>
      </div>
    </div>
  );
}
