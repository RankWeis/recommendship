// The on-device database: SQLite (WASM) persisted to OPFS, managed by PowerSync.
//
// Weekend 1 never calls `connect()`, so nothing syncs yet. Every write to a
// synced table still lands in PowerSync's upload queue, which means that once
// the server exists (Weekend 2) everything captured so far uploads on first
// connect. The derived tables are local-only and never enter the queue.

import { DrizzleAppSchema } from '@powersync/drizzle-driver';
import { PowerSyncDatabase, WASQLiteVFS } from '@powersync/web';
import {
	appUser,
	category,
	item,
	itemPrediction,
	recommendation,
	recommender,
	recommenderStats
} from '@recommendship/schema';

export const AppSchema = new DrizzleAppSchema({
	app_user: appUser,
	category,
	recommender,
	item,
	recommendation,
	recommender_stats: { tableDefinition: recommenderStats, options: { localOnly: true } },
	item_prediction: { tableDefinition: itemPrediction, options: { localOnly: true } }
});

/**
 * Placeholder user_id for rows written on the device. The server's write
 * handler always stamps the signed-in user's id instead, and the synced copy
 * then replaces the local one, so this never reaches Postgres.
 */
export const LOCAL_USER_ID = 'local';

export const db = new PowerSyncDatabase({
	schema: AppSchema,
	database: {
		dbFilename: 'recommendship.db',
		// OPFS-backed and works in Safari, which matters for an iPhone PWA.
		vfs: WASQLiteVFS.OPFSCoopSyncVFS,
		// Each tab syncs on its own instead of sharing one connection through a
		// SharedWorker. Shared workers are missing or blocked in some browsers and
		// webviews, and a phone PWA rarely has two tabs open.
		enableMultiTabs: false
	}
});

let ready: Promise<void> | undefined;

/** Opens the database. Safe to call repeatedly. */
export function initDb(): Promise<void> {
	ready ??= db.init();
	return ready;
}

/**
 * Lets go of the database file before this page goes away. Only one page can hold it,
 * and iOS keeps a home-screen app's old page alive across a full-page redirect (Google
 * sign-in), so the page that comes back would otherwise wait on "Opening…" forever.
 * This instance can't be reopened afterwards; the page reloads if it is shown again.
 */
export async function releaseDb() {
	if (!ready) return;
	ready = undefined;
	await db.close().catch((e) => console.warn('closing the database', e));
}
