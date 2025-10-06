/**
 * StatusBar - Renderer status bar component
 *
 * Displays status messages, server URL, latency, and xruns
 */

import React, { useState, useEffect } from 'react';
import './StatusBar.css';

export function StatusBar({ bridge }) {
  const [statusText, setStatusText] = useState('Ready');
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
      bridge.getServerUrl()
        .then(url => {
          setWebUrl(url || null);
        })
        .catch(console.error);
    }

    // Poll for server URL updates (every 5 seconds)
    const pollInterval = setInterval(() => {
      if (bridge.getServerUrl) {
        bridge.getServerUrl()
          .then(url => {
            setWebUrl(url || null);
          })
          .catch(console.error);
      }
    }, 5000);

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
      clearInterval(pollInterval);
    };
  }, [bridge]);

  const handleUrlClick = () => {
    if (webUrl && bridge?.openExternal) {
      bridge.openExternal(webUrl);
    }
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        <span>{statusText}</span>
      </div>
      <div className="status-center">
        {webUrl && (
          <span
            className="web-url-display"
            onClick={handleUrlClick}
            title="Click to open in browser"
          >
            🌐 {webUrl}
          </span>
        )}
      </div>
      <div className="status-right">
        <span>
          Latency: {latency !== null ? `${latency.toFixed(1)} ms` : '-- ms'}
        </span>
        <span>XRuns: {xruns}</span>
      </div>
    </div>
  );
}
