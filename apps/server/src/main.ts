import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './app';
import { createAuth } from './auth';
import { createDb } from './db';
import { loadEnv } from './env';
import { runMigrations } from './migrate';

const env = loadEnv();
// On Fly, migrations run as the deploy's release_command; MIGRATE_ON_BOOT covers docker compose.
if (process.env.MIGRATE_ON_BOOT === 'true') await runMigrations();

const { pool, db } = createDb(env.DATABASE_URL);
const app = createApp({ env, db, auth: createAuth(env, pool, db) });

// In production the same origin serves the built PWA, so auth cookies need no cross-site setup.
if (env.STATIC_DIR) {
	const root = path.resolve(env.STATIC_DIR);
	const shell = await readFile(path.join(root, 'index.html'), 'utf8');
	app.use('/*', serveStatic({ root }));
	// SPA fallback: any other page route gets the app shell.
	app.get('*', (c) => c.html(shell));
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`api listening on :${info.port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => void pool.end().finally(() => process.exit(0)));
}
