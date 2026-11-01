import { db } from './index';

export interface LiveQuery<T> {
	readonly rows: T[];
	readonly ready: boolean;
}

/**
 * A reactive SQL query. PowerSync works out which tables the query reads and
 * re-runs it whenever they change, whether from a local edit or (later) sync.
 * `get` is tracked, so a query that depends on component state re-subscribes
 * when that state changes. Call during component initialisation.
 */
export function liveQuery<T>(get: () => { sql: string; params?: unknown[] }): LiveQuery<T> {
	const state = $state({ rows: [] as T[], ready: false });
	$effect(() => {
		const { sql, params = [] } = get();
		const controller = new AbortController();
		db.watch(
			sql,
			params,
			{
				onResult: (result) => {
					state.rows = result.array as T[];
					state.ready = true;
				},
				onError: (e) => console.error('liveQuery failed', sql, e)
			},
			{ signal: controller.signal }
		);
		return () => controller.abort();
	});
	return state;
}
