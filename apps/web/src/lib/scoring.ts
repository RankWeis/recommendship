// Runs the scoring model (§4.6) on the device: read every rated and pending item
// from local SQLite, fit the model in memory, and rewrite the local-only derived
// tables in one transaction. Data volumes are tiny, so a full recompute takes
// milliseconds and there is no incremental math.

import { DEFAULT_CONFIG, recompute, type ScoreConfig, type ScoreInput, type Status } from '@recommendship/score';
import { db, LOCAL_USER_ID } from './db';

export const SCORE_CONFIG: ScoreConfig = DEFAULT_CONFIG;

export async function loadScoreInput(): Promise<ScoreInput> {
	const [items, recommendations] = await Promise.all([
		db.getAll<{ id: string; category_id: string; status: Status; rating: number | null }>(
			'SELECT id, category_id, status, rating FROM item'
		),
		db.getAll<{ item_id: string; recommender_id: string }>('SELECT item_id, recommender_id FROM recommendation')
	]);
	return {
		items: items.map((i) => ({ id: i.id, categoryId: i.category_id, status: i.status, rating: i.rating })),
		recommendations: recommendations.map((r) => ({ itemId: r.item_id, recommenderId: r.recommender_id }))
	};
}

async function run() {
	const { stats, predictions } = recompute(await loadScoreInput(), SCORE_CONFIG);
	const now = new Date().toISOString();
	await db.writeTransaction(async (tx) => {
		await tx.execute('DELETE FROM recommender_stats');
		await tx.execute('DELETE FROM item_prediction');
		if (stats.length) {
			await tx.executeBatch(
				`INSERT INTO recommender_stats
					(id, user_id, recommender_id, category_id, n, mean_raw, offset_shrunk, hit_rate, pending, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				stats.map((s) => [
					`${s.recommenderId}:${s.categoryId ?? 'all'}`,
					LOCAL_USER_ID,
					s.recommenderId,
					s.categoryId,
					s.n,
					s.meanRaw,
					s.offsetShrunk,
					s.hitRate,
					s.pending,
					now
				])
			);
		}
		if (predictions.length) {
			await tx.executeBatch(
				`INSERT INTO item_prediction (id, predicted, confidence, lower_bound, explanation, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
				predictions.map((p) => [p.itemId, p.predicted, p.confidence, p.lowerBound, JSON.stringify(p.explanation), now])
			);
		}
	});
}

let chain: Promise<void> = Promise.resolve();

/** Queue a recompute; runs never overlap. Resolves once this one has been written. */
export function recomputeScores(): Promise<void> {
	chain = chain.then(run).catch((e) => console.error('recompute failed', e));
	return chain;
}

/**
 * Recompute whenever items or recommendations change, from local edits now and
 * from sync later. Returns a function that stops watching.
 */
export function startAutoRecompute(): () => void {
	void recomputeScores();
	return db.onChange({ onChange: () => void recomputeScores() }, { tables: ['item', 'recommendation'], throttleMs: 50 });
}
