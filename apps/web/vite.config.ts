import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			// A static SPA: all data lives on the device, so there is nothing to render on a server.
			adapter: adapter({ fallback: 'index.html' }),
			// Registered by hand in +layout.svelte, production only: a caching worker in dev just serves stale files.
			serviceWorker: { register: false }
		})
	],
	// PowerSync ships its own workers and WASM, which Vite's dependency pre-bundling would break.
	// The API (apps/server) runs on :3000 in dev; proxying keeps auth cookies same-origin.
	server: { proxy: { '/api': 'http://localhost:3000' } },
	optimizeDeps: { exclude: ['@powersync/web', '@journeyapps/wa-sqlite'] },
	worker: { format: 'es' }
});
