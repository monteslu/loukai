import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../utils/qrCodeGenerator.js', () => ({
  generateQRCode: vi.fn(() => Promise.resolve(null)),
}));

import { ServerTab } from './ServerTab.jsx';

function stubBridge(overrides = {}) {
  return {
    getServerUrl: vi.fn(() => Promise.resolve('http://localhost:3069')),
    getLocalServerUrl: vi.fn(() => Promise.resolve('http://localhost:3069')),
    getServerSettings: vi.fn(() => Promise.resolve(null)),
    getRequests: vi.fn(() => Promise.resolve([])),
    getAppVersion: vi.fn(() => Promise.resolve('1.2.3')),
    ...overrides,
  };
}

describe('ServerTab', () => {
  it('shows the app version at the bottom', async () => {
    render(<ServerTab bridge={stubBridge()} />);
    expect(await screen.findByText('Loukai v1.2.3')).toBeInTheDocument();
  });

  it('shows no version line when the version cannot be read', async () => {
    const bridge = stubBridge({ getAppVersion: vi.fn(() => Promise.reject(new Error('no'))) });
    render(<ServerTab bridge={bridge} />);
    await waitFor(() => expect(bridge.getAppVersion).toHaveBeenCalled());
    expect(screen.queryByText(/Loukai v/)).toBeNull();
  });
});
