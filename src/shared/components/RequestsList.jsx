export function RequestsList({ requests, onApprove, onReject }) {
  const handleApprove = async (requestId) => {
    if (onApprove) {
      await onApprove(requestId);
    }
  };

  const handleReject = async (requestId) => {
    if (onReject) {
      await onReject(requestId);
    }
  };

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const otherRequests = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="p-4 space-y-6">
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Pending Approval ({pendingRequests.length})
          </h3>
          <div className="space-y-2">
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 flex items-center justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                    <strong>{request.song.title}</strong>
                    {request.song.artist && (
                      <span className="text-gray-600 dark:text-gray-400">
                        {' '}
                        - {request.song.artist}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-600 dark:text-gray-400">
                    <span>From: {request.requesterName}</span>
                    {request.message && <span className="italic">"{request.message}"</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition"
                    onClick={() => handleApprove(request.id)}
                  >
                    ✓ Approve
                  </button>
                  <button
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition"
                    onClick={() => handleReject(request.id)}
                  >
                    ✗ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {otherRequests.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Recent Requests
          </h3>
          <div className="space-y-2">
            {otherRequests.slice(0, 10).map((request) => {
              const statusColors = {
                approved: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
                rejected: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
              };
              const badgeColors = {
                approved: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
                rejected: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
              };

              return (
                <div
                  key={request.id}
                  className={`${statusColors[request.status] || 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'} border rounded-lg p-4`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        <strong>{request.song.title}</strong>
                        {request.song.artist && (
                          <span className="text-gray-600 dark:text-gray-400">
                            {' '}
                            - {request.song.artist}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-600 dark:text-gray-400">
                        <span>From: {request.requesterName}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${badgeColors[request.status] || 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}
                        >
                          {request.status}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {requests.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p>No song requests yet</p>
        </div>
      )}
    </div>
  );
}
