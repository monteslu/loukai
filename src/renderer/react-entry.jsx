/**
 * React Entry Point for Electron Renderer
 *
 * Single entry point - mounts ONE React app with shared context
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tailwind.css';
import { ElectronBridge } from './adapters/ElectronBridge.js';
import { AppRoot } from './components/AppRoot.jsx';
import { App } from './components/App.jsx';
import { verifyButterchurn } from './js/butterchurnVerify.js';

console.log('🚀 Initializing application...');

// Verify Butterchurn libraries loaded correctly
verifyButterchurn();

// Get the ElectronBridge singleton instance
const bridge = ElectronBridge.getInstance();

// Connect bridge and mount React app
bridge.connect().then(() => {
  console.log('✅ ElectronBridge connected');

  // Mount single React app to root
  const root = document.getElementById('root');
  if (root) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <AppRoot>
          <App bridge={bridge} />
        </AppRoot>
      </React.StrictMode>
    );
    console.log('✅ React app mounted');
  }
});

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  bridge.disconnect();
});
