// Applies all database migrations: the app tables (Drizzle SQL in ../drizzle),
// then Better Auth's own tables. Safe to run on every deploy.

import { getMigrations } from 'better-auth/db/migration';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { authOptions } from './auth';
import { createDb } from './db';
import { loadEnv } from './env';

export async function runMigrations() {
	const env = loadEnv();
	const { pool, db } = createDb(env.DATABASE_URL);
	try {
		await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
		const { runMigrations: runAuth } = await getMigrations(authOptions(env, pool));
		await runAuth();
		// Accounts made before sign-in stopped keeping these (see auth.ts). Cheap and idempotent.
		await pool.query(`UPDATE "user" SET image = NULL WHERE image IS NOT NULL`);
		await pool.query(`UPDATE account SET "idToken" = NULL WHERE "idToken" IS NOT NULL`);
		console.log('migrations applied');
	} finally {
		await pool.end();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await runMigrations();
}
