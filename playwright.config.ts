import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the full local stack. Start Postgres + PowerSync first:
//   pnpm stack        (docker compose up + migrations)
//   pnpm test:e2e     (starts `pnpm dev` if it isn't already running)
export default defineConfig({
	testDir: 'e2e',
	timeout: 90_000,
	expect: { timeout: 30_000 },
	fullyParallel: false,
	retries: 0,
	use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm dev',
		url: 'http://localhost:5173/api/public/config',
		reuseExistingServer: true,
		timeout: 60_000
	}
});
