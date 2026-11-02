import { describe, expect, it } from 'vitest';
import { syncState, type SyncInputs } from './sync-state';

const base: SyncInputs = {
	me: { approved: true },
	online: true,
	connected: true,
	connecting: false,
	hasSynced: true,
	uploading: false,
	downloading: false,
	paced: false,
	refusal: null
};
const state = (over: Partial<SyncInputs>) => syncState({ ...base, ...over });

describe('syncState', () => {
	it('is local signed out and pending before approval', () => {
		expect(state({ me: null }).state).toBe('local');
		expect(state({ me: { approved: false } }).state).toBe('pending');
		expect(state({ refusal: 'not-approved' }).state).toBe('pending');
	});

	it('is offline only when there is no signal, or nothing has failed yet', () => {
		expect(state({ online: false, connected: false, downloadError: new Error('Failed to fetch') })).toEqual({ state: 'offline', error: null });
		expect(state({ connected: false }).state).toBe('offline');
	});

	it('shows a failure to connect as an error, not as offline', () => {
		expect(state({ connected: false, downloadError: new Error('credentials: HTTP 502') })).toEqual({
			state: 'error',
			error: 'Download: credentials: HTTP 502'
		});
	});

	it('says so when the sign-in has expired', () => {
		expect(state({ connected: false, refusal: 'signed-out' }).state).toBe('error');
	});

	it('is syncing while connecting, uploading, paced or before the first sync', () => {
		expect(state({ connected: false, connecting: true }).state).toBe('syncing');
		expect(state({ uploading: true }).state).toBe('syncing');
		expect(state({ hasSynced: false }).state).toBe('syncing');
		expect(state({ paced: true, uploadError: new Error('slow down') })).toEqual({ state: 'syncing', error: null });
	});

	it('reports upload errors and is otherwise synced', () => {
		expect(state({ uploadError: new Error('HTTP 500') })).toEqual({ state: 'error', error: 'Upload: HTTP 500' });
		expect(state({}).state).toBe('synced');
	});
});
