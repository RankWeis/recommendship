import { liveQuery } from './db/live.svelte';
import type { RecommenderRow } from './db/rows';

/** All recommenders, with a name lookup for explanations and toasts. */
export function usePeople() {
	const q = liveQuery<RecommenderRow>(() => ({ sql: 'SELECT id, name, notes, created_at FROM recommender ORDER BY name' }));
	const byId = $derived(new Map(q.rows.map((r) => [r.id, r])));
	return {
		get all() {
			return q.rows;
		},
		nameOf: (id: string) => byId.get(id)?.name ?? 'Someone'
	};
}
