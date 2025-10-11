/**
 * StatusBar - Renderer status bar component
 *
 * Displays status messages, server URL, latency, and xruns
 */

import React, { useState, useEffect } from 'react';

export function StatusBar({ bridge }) {
  const [statusText, _setStatusText] = useState('Ready');
  const [webUrl, setWebUrl] = useState(null);
  const [latency, setLatency] = useState(null);
  const [xruns, setXruns] = useState(0);

  useEffect(() => {
    if (!bridge) return;

    const unsubscribers = [];

    // Listen for audio latency updates
    if (bridge.onLatencyUpdate) {
      const unsubLatency = bridge.onLatencyUpdate((latencyMs) => {
        setLatency(latencyMs);
      });
      if (unsubLatency) unsubscribers.push(unsubLatency);
    }

    // Listen for xrun updates
    if (bridge.onXRunUpdate) {
      const unsubXrun = bridge.onXRunUpdate((count) => {
        setXruns(count);
      });
      if (unsubXrun) unsubscribers.push(unsubXrun);
    }

    // Get initial server URL
    if (bridge.getServerUrl) {
      bridge
        .getServerUrl()
        .then((url) => {
          setWebUrl(url || null);
        })
        .catch(console.error);
    }

    // Poll for server URL updates (every 5 seconds)
    const pollInterval = setInterval(() => {
      if (bridge.getServerUrl) {
        bridge
          .getServerUrl()
          .then((url) => {
            setWebUrl(url || null);
          })
          .catch(console.error);
      }
    }, 5000);

    return () => {
      unsubscribers.forEach((unsub) => unsub && unsub());
      clearInterval(pollInterval);
    };
  }, [bridge]);

  const handleUrlClick = () => {
    if (webUrl && bridge?.openExternal) {
      bridge.openExternal(webUrl);
    }
  };

  return (
    <div className="flex justify-between items-center h-6 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 text-xs text-gray-600 dark:text-gray-400">
      <div className="flex-1">
        <span>{statusText}</span>
      </div>
      <div className="flex-1 text-center">
        {webUrl && (
          <span
            className="text-blue-500 dark:text-blue-400 cursor-pointer hover:underline"
            onClick={handleUrlClick}
            title="Click to open in browser"
          >
            🌐 {webUrl}
          </span>
        )}
      </div>
      <div className="flex-1 flex gap-4 justify-end">
        <span>Latency: {latency !== null ? `${latency.toFixed(1)} ms` : '-- ms'}</span>
        <span>XRuns: {xruns}</span>
      </div>
    </div>
  );
}
