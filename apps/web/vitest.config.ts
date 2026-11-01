import { defineConfig } from 'vitest/config';

// Unit tests cover plain modules only (no SvelteKit or PowerSync), so they skip the app's Vite plugins.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
