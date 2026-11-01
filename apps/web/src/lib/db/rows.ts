// Row shapes as SQLite returns them (snake_case columns). Queries are plain SQL
// against the PowerSync views; the Drizzle schema in @recommendship/schema is the
// source of truth for the columns.

import type { ExternalSource, ItemStatus } from '@recommendship/schema';
import type { Explanation } from '@recommendship/score';

export interface CategoryRow {
	id: string;
	name: string;
	icon: string;
	external_source: ExternalSource;
	sort_order: number;
}

export interface ItemRow {
	id: string;
	category_id: string;
	title: string;
	year: number | null;
	creator: string | null;
	image_url: string | null;
	external_source: ExternalSource | null;
	external_id: string | null;
	status: ItemStatus;
	rating: number | null;
	review: string | null;
	added_at: string;
	tried_at: string | null;
}

/** An item joined with its prediction and recommender names (JSON arrays). */
export interface ListItemRow extends ItemRow {
	predicted: number | null;
	confidence: number | null;
	lower_bound: number | null;
	explanation: string | null;
	recommender_ids: string;
	recommender_names: string;
}

export interface RecommenderRow {
	id: string;
	name: string;
	notes: string | null;
	created_at: string;
}

export interface StatsRow {
	id: string;
	recommender_id: string;
	category_id: string | null;
	n: number;
	mean_raw: number | null;
	offset_shrunk: number;
	hit_rate: number | null;
	pending: number;
}

export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
	if (!s) return fallback;
	try {
		return JSON.parse(s) as T;
	} catch {
		return fallback;
	}
};

export const parseExplanation = (s: string | null) => parseJson<Explanation | null>(s, null);

/** SELECT list for ListItemRow; alias the item table as `i`. */
export const LIST_ITEM_COLUMNS = `
	i.id, i.category_id, i.title, i.year, i.creator, i.image_url, i.external_source, i.external_id, i.status, i.rating, i.review, i.added_at, i.tried_at,
	p.predicted, p.confidence, p.lower_bound, p.explanation,
	coalesce(g.recommender_ids, '[]') AS recommender_ids,
	coalesce(g.recommender_names, '[]') AS recommender_names`;

// Who recommended each item, gathered in one pass over recommendations and joined on,
// rather than looked up again for every row (seconds, with a couple of thousand items).
export const LIST_ITEM_FROM = `item i
	LEFT JOIN item_prediction p ON p.id = i.id
	LEFT JOIN (
		SELECT rc.item_id, json_group_array(rc.recommender_id) AS recommender_ids, json_group_array(r.name) AS recommender_names
		FROM recommendation rc JOIN recommender r ON r.id = rc.recommender_id
		GROUP BY rc.item_id
	) g ON g.item_id = i.id`;
