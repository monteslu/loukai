/**
 * LyricRejection - AI correction rejection display component
 *
 * Features:
 * - Shows old vs new text comparison
 * - Displays rejection reason and retention rate
 * - Copy, Accept, Delete actions
 */

export function LyricRejection({ rejection, rejectionIndex, onAccept, onDelete }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rejection.new_text);
      // Could show temporary "Copied!" feedback
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-red-700 dark:text-red-300 font-medium">
          <span className="material-icons">block</span>
          Rejected Update (Line {rejection.line_num})
        </span>
        <button
          className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded transition"
          title="Delete this rejection"
          onClick={() => onDelete(rejectionIndex)}
        >
          <span className="material-icons text-gray-600 dark:text-gray-400">delete</span>
        </button>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Original:
            </label>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 text-gray-900 dark:text-gray-100">
              {rejection.old_text}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Proposed:
            </label>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 text-gray-900 dark:text-gray-100">
              {rejection.new_text}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-sm rounded-lg transition"
                title="Copy proposed text"
                onClick={handleCopy}
              >
                <span className="material-icons text-sm">content_copy</span>
                Copy
              </button>
              <button
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition"
                title="Accept proposed text and replace current lyric"
                onClick={() => onAccept(rejectionIndex)}
              >
                <span className="material-icons text-sm">check_circle</span>
                Accept
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400">
          <span>Reason: {rejection.reason}</span>
          {rejection.retention_rate !== undefined && (
            <span>
              Retention: {(rejection.retention_rate * 100).toFixed(1)}% (min:{' '}
              {(rejection.min_required * 100).toFixed(1)}%)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
