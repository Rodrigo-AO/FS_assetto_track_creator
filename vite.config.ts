import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { acInstallerPlugin } from './server/acInstallerPlugin';

export default defineConfig({
  plugins: [react(), acInstallerPlugin()],
  server: { port: 5173 },
  test: { environment: 'node' },
});
