/**
 * ServerTab - Server settings and management component
 */

import React, { useState, useEffect } from 'react';
import './ServerTab.css';

export function ServerTab({ bridge }) {
  const [serverUrl, setServerUrl] = useState(null);
  const [serverPort, setServerPort] = useState(null);
  const [settings, setSettings] = useState({
    serverName: 'Loukai Karaoke',
    port: 3069,
    allowSongRequests: true,
    requireKJApproval: true,
    streamVocalsToClients: false
  });
  const [adminPassword, setAdminPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [message, setMessage] = useState(null);

  // Load initial server status and settings
  useEffect(() => {
    if (!bridge) return;

    const loadData = async () => {
      try {
        // Get server URL
        const url = await bridge.getServerUrl();
        setServerUrl(url);
        if (url) {
          const port = new URL(url).port;
          setServerPort(port);
        }

        // Get settings
        const serverSettings = await bridge.getServerSettings();
        if (serverSettings) {
          setSettings({
            serverName: serverSettings.serverName || 'Loukai Karaoke',
            port: serverSettings.port || 3069,
            allowSongRequests: serverSettings.allowSongRequests !== false,
            requireKJApproval: serverSettings.requireKJApproval !== false,
            streamVocalsToClients: serverSettings.streamVocalsToClients === true
          });
        }

        // Check password status
        if (bridge.getAdminPasswordStatus) {
          const passwordSet = await bridge.getAdminPasswordStatus();
          setHasPassword(passwordSet);
        }

        // Get request stats
        updateRequestsStats();
      } catch (error) {
        console.error('Failed to load server data:', error);
      }
    };

    loadData();

    // Poll for server URL and request stats
    const pollInterval = setInterval(() => {
      if (bridge.getServerUrl) {
        bridge.getServerUrl()
          .then(url => {
            setServerUrl(url);
            if (url) {
              const port = new URL(url).port;
              setServerPort(port);
            }
          })
          .catch(console.error);
      }
      updateRequestsStats();
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [bridge]);

  const updateRequestsStats = async () => {
    try {
      if (!bridge?.getRequests) return;
      const requests = await bridge.getRequests();
      const pending = requests.filter(r => r.status === 'pending').length;
      setPendingRequests(pending);
      setTotalRequests(requests.length);
    } catch (error) {
      // Silently fail
    }
  };

  const handleSaveSettings = async () => {
    try {
      await bridge.updateServerSettings(settings);
      showMessage('Settings saved successfully', 'success');
    } catch (error) {
      console.error('Failed to save settings:', error);
      showMessage('Failed to save settings', 'error');
    }
  };

  const handleSetPassword = async () => {
    const password = adminPassword.trim();

    if (!password) {
      showMessage('Please enter a password', 'error');
      return;
    }

    if (password.length < 6) {
      showMessage('Password must be at least 6 characters', 'error');
      return;
    }

    try {
      if (bridge.setAdminPassword) {
        await bridge.setAdminPassword(password);
        setAdminPassword('');
        setHasPassword(true);
        showMessage('Admin password set successfully', 'success');
      }
    } catch (error) {
      console.error('Failed to set password:', error);
      showMessage('Failed to set admin password', 'error');
    }
  };

  const handleOpenServer = () => {
    if (serverUrl && bridge?.openExternal) {
      bridge.openExternal(serverUrl);
    }
  };

  const handleOpenAdmin = async () => {
    try {
      if (serverPort && bridge?.openExternal) {
        bridge.openExternal(`http://localhost:${serverPort}/admin`);
      }
    } catch (error) {
      console.error('Failed to open admin panel:', error);
    }
  };

  const handleClearRequests = async () => {
    if (!confirm('Are you sure you want to clear all song requests? This cannot be undone.')) {
      return;
    }

    try {
      if (bridge.clearAllRequests) {
        await bridge.clearAllRequests();
        showMessage('All requests cleared', 'success');
        updateRequestsStats();
      }
    } catch (error) {
      console.error('Failed to clear requests:', error);
      showMessage('Failed to clear requests', 'error');
    }
  };

  const showMessage = (text, type = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSettingChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const isServerRunning = !!serverUrl;

  return (
    <div className="server-container">
      {message && (
        <div className={`server-message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="server-header">
        <h2>Web Server Settings</h2>
        <div className="server-status">
          <span className={`status-indicator ${isServerRunning ? 'online' : 'offline'}`}></span>
          <span>
            {isServerRunning ? `Running on port ${serverPort}` : 'Not running'}
          </span>
        </div>
      </div>

      <div className="server-content">
        {/* Server Control */}
        <div className="server-section">
          <h3>Server Control</h3>
          <div className="server-controls">
            <div className="control-row">
              <label>Server Status:</label>
              <div className="control-group">
                <span>{serverUrl || 'Not running'}</span>
                <button
                  className="action-btn"
                  onClick={handleOpenServer}
                  disabled={!isServerRunning}
                >
                  <span className="material-icons">open_in_new</span>
                  Open in Browser
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Server Settings */}
        <div className="server-section">
          <h3>General Settings</h3>
          <div className="settings-grid">
            <div className="setting-row">
              <label htmlFor="serverName">Server Name:</label>
              <input
                type="text"
                id="serverName"
                className="setting-input"
                placeholder="Loukai Karaoke"
                value={settings.serverName}
                onChange={(e) => handleSettingChange('serverName', e.target.value)}
              />
            </div>

            <div className="setting-row">
              <label htmlFor="serverPort">Port:</label>
              <input
                type="number"
                id="serverPort"
                className="setting-input"
                placeholder="3069"
                min="1024"
                max="65535"
                value={settings.port}
                onChange={(e) => handleSettingChange('port', parseInt(e.target.value) || 3069)}
              />
            </div>
            <div className="setting-description">
              Server must be restarted for port changes to take effect
            </div>

            <div className="setting-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  id="allowSongRequests"
                  checked={settings.allowSongRequests}
                  onChange={(e) => handleSettingChange('allowSongRequests', e.target.checked)}
                />
                <span>Allow Song Requests</span>
              </label>
            </div>

            <div className="setting-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  id="requireKJApproval"
                  checked={settings.requireKJApproval}
                  onChange={(e) => handleSettingChange('requireKJApproval', e.target.checked)}
                />
                <span>Require KJ Approval</span>
              </label>
            </div>

            <div className="setting-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  id="streamVocalsToClients"
                  checked={settings.streamVocalsToClients}
                  onChange={(e) => handleSettingChange('streamVocalsToClients', e.target.checked)}
                />
                <span>Stream Vocals to Clients (LAN only)</span>
              </label>
            </div>

            <div className="setting-row">
              <button className="save-btn" onClick={handleSaveSettings}>
                <span className="material-icons">save</span>
                Save Settings
              </button>
            </div>
          </div>
        </div>

        {/* Admin Password */}
        <div className="server-section">
          <h3>Admin Security</h3>
          <div className="settings-grid">
            <div className="setting-row">
              <label htmlFor="adminPassword">Admin Password:</label>
              <div className="password-group">
                <input
                  type="password"
                  id="adminPassword"
                  className="setting-input"
                  placeholder="Enter new admin password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
                <button className="action-btn" onClick={handleSetPassword}>
                  <span className="material-icons">security</span>
                  Set Password
                </button>
              </div>
            </div>

            <div className="setting-description">
              KJs will need this password to access the admin panel
            </div>

            <div className="setting-row">
              <div className={`password-status ${hasPassword ? 'set' : ''}`}>
                {hasPassword ? 'Admin password is set' : 'No admin password set'}
              </div>
            </div>
          </div>
        </div>

        {/* Song Requests */}
        <div className="server-section">
          <h3>Song Requests</h3>
          <div className="requests-summary">
            <div className="summary-stats">
              <div className="stat-item">
                <span className="stat-value">{pendingRequests}</span>
                <span className="stat-label">Pending</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{totalRequests}</span>
                <span className="stat-label">Total</span>
              </div>
            </div>
            <div className="requests-actions">
              <button className="action-btn" onClick={handleOpenAdmin}>
                <span className="material-icons">admin_panel_settings</span>
                Open Admin Panel
              </button>
              <button className="action-btn danger" onClick={handleClearRequests}>
                <span className="material-icons">delete_sweep</span>
                Clear All Requests
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
