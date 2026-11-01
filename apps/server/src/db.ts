import * as schema from '@recommendship/schema/pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url: string) {
	// Close idle connections quickly so Neon's compute can scale to zero between uses.
	const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 10_000 });
	return { pool, db: drizzle(pool, { schema }) as Db };
}
