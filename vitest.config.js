import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.spec.js',
        '**/*.test.js',
        'dist/',
        'src/renderer/lib/',
        'src/main/preload.js',
        '**/*.config.js',
        // Exclude JSX components (UI code - not unit testable)
        '**/*.jsx',
        // Exclude main process (Electron - requires integration tests)
        'src/main/**',
        // Exclude renderer process (DOM-dependent)
        'src/renderer/**',
        // Exclude web app (DOM-dependent)
        'src/web/**',
        // Exclude utils (file system dependent)
        'src/utils/**',
        'src/native/**',
        // Exclude integration code (IPC, hooks, adapters)
        'src/shared/hooks/**',
        'src/shared/adapters/**',
        'src/shared/state/**',
        'src/shared/utils/**',
        'src/shared/constants.js',
        'src/shared/ipcContracts.js',
      ],
      thresholds: {
        lines: 80,
        functions: 95,
        branches: 89,
        statements: 80,
      },
    },
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['node_modules', 'dist', 'src/renderer/lib'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@main': path.resolve(__dirname, './src/main'),
    },
  },
});
