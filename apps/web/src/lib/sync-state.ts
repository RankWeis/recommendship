// Which sync state the app shows, from what the browser and PowerSync report.
// A plain module (no PowerSync, no Svelte) so it can be unit tested.

export type SyncState = 'local' | 'pending' | 'offline' | 'syncing' | 'synced' | 'error';

/** Why the server refused sync credentials, if it did (see Connector.fetchCredentials). */
export type CredentialsRefusal = 'signed-out' | 'not-approved' | null;

export interface SyncInputs {
	me: { approved: boolean } | null | undefined;
	online: boolean;
	connected: boolean;
	connecting: boolean;
	hasSynced: boolean;
	uploading: boolean;
	downloading: boolean;
	uploadError?: Error;
	downloadError?: Error;
	/** The upload error is the server's per-minute pacing, not a failure. */
	paced: boolean;
	refusal: CredentialsRefusal;
}

export function syncState(s: SyncInputs): { state: SyncState; error: string | null } {
	if (!s.me) return { state: 'local', error: null };
	if (!s.me.approved || s.refusal === 'not-approved') return { state: 'pending', error: null };
	// No signal is the common case, not an error; the browser knows before PowerSync does.
	if (!s.online) return { state: 'offline', error: null };
	if (s.refusal === 'signed-out') return { state: 'error', error: 'Your sign-in has expired. Sign out and sign in again.' };
	// With a signal, a failure to connect (credentials, the sync service, a token PowerSync
	// won't accept) is a real problem: show it, rather than call it "Offline" and hide it.
	const uploadError = s.uploadError && !s.paced ? s.uploadError : undefined;
	if (uploadError) return { state: 'error', error: `Upload: ${uploadError.message}` };
	if (s.downloadError) return { state: 'error', error: `Download: ${s.downloadError.message}` };
	if (!s.connected) return { state: s.connecting ? 'syncing' : 'offline', error: null };
	if (s.paced || s.uploading || s.downloading || !s.hasSynced) return { state: 'syncing', error: null };
	return { state: 'synced', error: null };
}
