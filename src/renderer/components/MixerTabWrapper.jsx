/**
 * MixerTabWrapper - Mounts MixerTab into the renderer's mixer tab
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BridgeProvider } from '../../shared/context/BridgeContext.jsx';
import { ElectronBridge } from '../adapters/ElectronBridge.js';
import { MixerTab } from './MixerTab.jsx';

const bridge = new ElectronBridge();

export function mountMixerTab() {
  const mixerTabElement = document.getElementById('mixer-tab');
  if (!mixerTabElement) {
    console.error('Mixer tab element not found');
    return;
  }

  // Clear existing vanilla content
  mixerTabElement.innerHTML = '<div id="react-mixer-root"></div>';

  const root = ReactDOM.createRoot(document.getElementById('react-mixer-root'));
  root.render(
    <BridgeProvider bridge={bridge}>
      <MixerTab bridge={bridge} />
    </BridgeProvider>
  );

  console.log('✅ MixerTab mounted');
}
