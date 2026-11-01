import { SEED_CATEGORIES } from '@recommendship/schema';
import { liveQuery } from './db/live.svelte';
import type { CategoryRow } from './db/rows';

const seedRows: CategoryRow[] = SEED_CATEGORIES.map((c) => ({
	id: c.id,
	name: c.name,
	icon: c.icon,
	external_source: c.externalSource,
	sort_order: c.sortOrder
}));

/**
 * System categories live in code (identical on every device, nothing to sync);
 * the `category` table only holds the ones you add yourself.
 */
export function useCategories() {
	const custom = liveQuery<CategoryRow>(() => ({
		sql: 'SELECT id, name, icon, external_source, sort_order FROM category ORDER BY sort_order, name'
	}));
	const all = $derived([...seedRows, ...custom.rows]);
	const byId = $derived(new Map(all.map((c) => [c.id, c])));
	return {
		get all() {
			return all;
		},
		get(id: string): CategoryRow {
			return byId.get(id) ?? { id, name: 'Unknown', icon: '•', external_source: 'NONE', sort_order: 999 };
		}
	};
}
