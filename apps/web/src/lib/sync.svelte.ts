// Accounts and sync. The app works fully without an account (everything stays
// on this device). Signing in with an approved account connects PowerSync:
// changes made so far upload through POST /api/write, and the account's data
// streams down from every other device.

import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector, PowerSyncCredentials } from '@powersync/web';
import { db, releaseDb } from './db';
import { toast } from './toast.svelte';

export interface Me {
	user: { id: string; email: string; name: string };
	approved: boolean;
	suspended: boolean;
	admin: boolean;
	/** This person's limits (an admin can set their own); null = no limit. */
	limits?: { rows: number | null; changesPerDay: number | null };
}

export type SyncState = 'local' | 'pending' | 'offline' | 'syncing' | 'synced' | 'error';

export const account = $state({
	/** null = not signed in; undefined = not known yet. */
	me: undefined as Me | null | undefined,
	sync: 'local' as SyncState,
	/** Local changes not yet accepted by the server. */
	queued: 0,
	lastSyncedAt: null as Date | null,
	/** The error behind sync === 'error', shown on the Account page. */
	syncError: null as string | null,
	/** Why a sync is taking a while (not an error), shown on the Account page. */
	syncNote: null as string | null,
	/** Replaced by /api/public/config; the limits here are the server's defaults, for when it can't be reached. */
	config: { google: false, devLogin: false, limits: { rows: 10_000, categories: 100 }, lookup: { movie: false, tv: false, book: false } }
});

// Remember the last known account so the app connects (and keeps queuing) when
// it starts with no signal. Storage may be unavailable, so every access is guarded.
const CACHE_KEY = 'rs.me';
function cacheMe(me: Me | null) {
	try {
		if (me) localStorage.setItem(CACHE_KEY, JSON.stringify(me));
		else localStorage.removeItem(CACHE_KEY);
	} catch {
		// Only a startup hint.
	}
}
function cachedMe(): Me | null {
	try {
		return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Me | null;
	} catch {
		return null;
	}
}

class Connector implements PowerSyncBackendConnector {
	async fetchCredentials(): Promise<PowerSyncCredentials | null> {
		const res = await fetch('/api/sync/credentials');
		// Signed out or not approved: no connection until that changes.
		if (res.status === 401 || res.status === 403) return null;
		if (!res.ok) throw new Error(`credentials: HTTP ${res.status}`);
		return (await res.json()) as PowerSyncCredentials;
	}

	async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
		const tx = await database.getNextCrudTransaction();
		if (!tx) return;
		const ops = tx.crud.map((e) => ({ op: e.op, table: e.table, id: e.id, data: e.opData ?? null }));
		const res = await fetch('/api/write', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ops })
		});
		// A malformed batch will never succeed; drop it rather than block the queue forever.
		// Anything else that isn't OK (offline, signed out, unapproved, rate limited, server error)
		// throws so PowerSync keeps the queue and retries later.
		if (res.status === 400) {
			console.error('upload rejected as malformed', await res.text());
		} else if (!res.ok) {
			// The server's reason (e.g. the daily change budget) is what the Account page shows.
			const reason = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
			throw new Error(reason ?? `HTTP ${res.status}`);
		} else {
			const result = (await res.json()) as { rejected: { reason: string }[] };
			// Rejected ops are dropped and the server's copy replaces the device's, so say so
			// rather than let things quietly vanish (e.g. at the per-user row limit).
			if (result.rejected.length) {
				console.warn('server rejected some changes', result.rejected);
				const n = result.rejected.length;
				toast(`${n} change${n === 1 ? '' : 's'} weren't saved: ${result.rejected[0]!.reason}`, undefined, 8000);
			}
		}
		await tx.complete();
	}
}

const connector = new Connector();

/** The API's per-minute limits (see /api/write), as opposed to a real failure. */
const PACED = /changes in a minute|slow down/;

function updateStatus() {
	const s = db.currentStatus;
	account.lastSyncedAt = s.lastSyncedAt ?? null;
	const { downloadError } = s.dataFlowStatus;
	// PowerSync keeps the last upload error until an upload succeeds. With nothing left
	// in the queue there is no next upload, so an old blip would otherwise stick forever.
	const uploadError = account.queued > 0 ? s.dataFlowStatus.uploadError : undefined;
	// The server's per-minute limits (a big import, a long offline stretch) pause the
	// upload, they don't fail it: PowerSync retries and the queue drains a minute at a time.
	const paced = !!uploadError && PACED.test(uploadError.message);
	account.syncNote = paced ? 'Uploading in batches, a minute at a time. Keep the app open until it says Synced.' : null;
	account.syncError = paced
		? null
		: uploadError
		? `Upload: ${uploadError.message}`
		: downloadError
			? `Download: ${downloadError.message}`
			: null;
	if (!account.me) account.sync = 'local';
	else if (!account.me.approved) account.sync = 'pending';
	// No signal is the common case, not an error; the browser knows before PowerSync does.
	else if (!navigator.onLine || !s.connected) account.sync = 'offline';
	else if ((uploadError && !paced) || downloadError) account.sync = 'error';
	else if (paced || s.dataFlowStatus.uploading || s.dataFlowStatus.downloading || !s.hasSynced) account.sync = 'syncing';
	else account.sync = 'synced';
}

async function refreshQueue() {
	try {
		account.queued = (await db.getUploadQueueStats()).count;
		updateStatus();
	} catch {
		// The database may be closing.
	}
}

async function fetchMe(): Promise<Me | null | 'offline'> {
	try {
		const res = await fetch('/api/me');
		if (res.status === 401) return null;
		if (!res.ok) return 'offline';
		return (await res.json()) as Me;
	} catch {
		return 'offline';
	}
}

/** Work out who's signed in and connect if they're approved. Call after the database is open. */
export async function startSync(): Promise<() => void> {
	const stopStatus = db.registerListener({
		statusChanged: () => {
			updateStatus();
			void refreshQueue();
		}
	});
	const stopQueue = db.onChange({ onChange: () => void refreshQueue() }, { tables: ['ps_crud'], throttleMs: 200 });
	addEventListener('online', updateStatus);
	addEventListener('offline', updateStatus);
	void fetch('/api/public/config')
		.then((r) => (r.ok ? r.json() : null))
		.then((c) => {
			if (c) account.config = { ...account.config, ...c };
		})
		.catch(() => {});

	await refreshSession();
	void refreshQueue();
	return () => {
		stopStatus();
		stopQueue();
		removeEventListener('online', updateStatus);
		removeEventListener('offline', updateStatus);
	};
}

export async function refreshSession() {
	const me = await fetchMe();
	account.me = me === 'offline' ? cachedMe() : me;
	if (me !== 'offline') cacheMe(me);
	if (account.me?.approved) await db.connect(connector);
	updateStatus();
}

class AuthError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

async function authPost(path: string, body: unknown) {
	const res = await fetch(`/api/auth/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({}));
	if (res.status === 429) throw new AuthError('Too many sign-in attempts. Wait a few seconds and try again.', 429);
	if (/signups?_full/i.test(data?.message ?? '')) throw new AuthError('Sign-ups are full for today. Please try again tomorrow.', res.status);
	if (!res.ok) throw new AuthError(data?.message ?? `HTTP ${res.status}`, res.status);
	return data;
}

export async function signInWithGoogle() {
	const { url } = await authPost('sign-in/social', { provider: 'google', callbackURL: '/account', errorCallbackURL: '/account' });
	// Queued changes stay in the file and upload after sign-in.
	await releaseDb();
	location.href = url;
}

/** Local development and tests only (the server refuses it in production). */
export async function devSignIn(email: string, password: string) {
	try {
		await authPost('sign-in/email', { email, password });
	} catch (e) {
		// Only "wrong email or password" means the account may not exist yet.
		if (!(e instanceof AuthError) || e.status !== 401) throw e;
		await authPost('sign-up/email', { email, password, name: email.split('@')[0] });
	}
	await refreshSession();
}

export async function redeemInvite(code: string) {
	const res = await fetch('/api/invites/redeem', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
	await refreshSession();
}

/** Changes on this device that the server hasn't accepted yet, counted now (not the cached figure). */
export async function pendingUploads(): Promise<number> {
	return (await db.getUploadQueueStats()).count;
}

/** Give PowerSync a chance to upload what's queued. Resolves with how many changes are still waiting. */
async function flushUploads(timeoutMs: number): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	let left = await pendingUploads();
	while (left > 0 && navigator.onLine && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 500));
		left = await pendingUploads();
	}
	return left;
}

/**
 * Sign out and wipe this device's copy of the account, so the next person to
 * sign in here doesn't see it. That wipe would also delete changes the server
 * hasn't accepted yet, so unless `discardUnsynced` is set this first tries to
 * upload them and refuses (returning the count) if any are left.
 */
export async function signOut({ discardUnsynced = false } = {}): Promise<{ signedOut: boolean; pending: number }> {
	if (!discardUnsynced) {
		const pending = await flushUploads(10_000);
		if (pending > 0) return { signedOut: false, pending };
	}
	// Better Auth only accepts JSON bodies; without one it answers 415 and the session survives.
	await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
	await db.disconnectAndClear();
	cacheMe(null);
	account.me = null;
	updateStatus();
	return { signedOut: true, pending: 0 };
}
