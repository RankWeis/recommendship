<script lang="ts">
	import { rateItem } from '#lib/actions.ts';
	import { useCategories } from '#lib/categories.svelte.ts';
	import { db } from '#lib/db/index.ts';
	import { liveQuery } from '#lib/db/live.svelte.ts';
	import { parseJson, type ItemRow } from '#lib/db/rows.ts';
	import { fmtRating, stars } from '#lib/format.ts';
	import { recomputeScores } from '#lib/scoring.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import Sheet from './Sheet.svelte';

	const categories = useCategories();
	const found = liveQuery<ItemRow & { recommender_ids: string; recommender_names: string; predicted: number | null }>(() => ({
		sql: `SELECT i.*, p.predicted,
				(SELECT json_group_array(rc.recommender_id) FROM recommendation rc WHERE rc.item_id = i.id) AS recommender_ids,
				(SELECT json_group_array(r.name) FROM recommendation rc JOIN recommender r ON r.id = rc.recommender_id WHERE rc.item_id = i.id) AS recommender_names
			FROM item i LEFT JOIN item_prediction p ON p.id = i.id WHERE i.id = ?`,
		params: [ui.rateItemId ?? '']
	}));
	const item = $derived(found.rows[0]);

	let rating = $state(3.5);
	let review = $state('');
	let saving = $state(false);

	// Start from the existing rating, else the prediction rounded to a half step.
	let loadedFor: string | null = null;
	$effect(() => {
		if (!item || loadedFor === item.id) return;
		loadedFor = item.id;
		rating = item.rating ?? (item.predicted != null ? Math.round(item.predicted * 2) / 2 : 3.5);
		review = item.review ?? '';
	});
	$effect(() => {
		if (!ui.rateItemId) loadedFor = null;
	});

	type Record = { recommender_id: string; mean_raw: number | null; n: number };
	const records = (categoryId: string) =>
		db.getAll<Record>('SELECT recommender_id, mean_raw, n FROM recommender_stats WHERE category_id = ?', [categoryId]);

	async function save() {
		if (!item) return;
		saving = true;
		try {
			const ids = parseJson<string[]>(item.recommender_ids, []);
			const names = parseJson<string[]>(item.recommender_names, []);
			const before = new Map((await records(item.category_id)).map((r) => [r.recommender_id, r]));
			await rateItem(item.id, rating, review);
			await recomputeScores();
			const after = new Map((await records(item.category_id)).map((r) => [r.recommender_id, r]));

			// The small payoff that keeps you rating (§5.3): "Sam's movie record: 4.5 → 4.3".
			const cat = categories.get(item.category_id).name.toLowerCase();
			const lines = ids.map((id, k) => {
				const b = before.get(id);
				const a = after.get(id);
				const name = names[k] ?? 'Someone';
				if (!a?.mean_raw) return null;
				if (!b?.n || b.mean_raw == null) return `${name}'s first rated ${cat}: ${fmtRating(a.mean_raw)}`;
				if (b.mean_raw.toFixed(1) === a.mean_raw.toFixed(1)) return `${name}'s ${cat} record holds at ${fmtRating(a.mean_raw)}`;
				return `${name}'s ${cat} record: ${fmtRating(b.mean_raw)} → ${fmtRating(a.mean_raw)}`;
			});
			ui.rateItemId = null;
			toast(lines.filter(Boolean).join(' · ') || `Rated ${fmtRating(rating)}`);
		} finally {
			saving = false;
		}
	}
</script>

<Sheet open={!!ui.rateItemId} onclose={() => (ui.rateItemId = null)} label="Rate">
	{#if item}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<div>
				<h2>{item.title}</h2>
				<p class="muted small">
					{categories.get(item.category_id).icon}
					{categories.get(item.category_id).name}
					{#if parseJson<string[]>(item.recommender_names, []).length}
						· from {parseJson<string[]>(item.recommender_names, []).join(' & ')}
					{/if}
				</p>
			</div>

			<div class="score">
				<span class="big num">{rating.toFixed(1)}</span>
				<span class="stars" aria-hidden="true">{stars(rating)}</span>
			</div>
			<input type="range" min="1" max="5" step="0.5" bind:value={rating} aria-label="Rating" />
			<div class="ticks muted small" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>

			<textarea class="field" rows="2" bind:value={review} placeholder="Any thoughts? (optional)"></textarea>

			<button class="btn primary" disabled={saving}>Save rating</button>
		</form>
	{/if}
</Sheet>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	h2 {
		font-size: 1.25rem;
	}

	p {
		margin: 0.2rem 0 0;
	}

	.score {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		justify-content: center;
		margin-top: 0.5rem;
	}

	.big {
		font-size: 2.6rem;
		font-weight: 700;
	}

	.stars {
		color: var(--gold);
		font-size: 1.5rem;
		min-width: 6ch;
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
		height: 2rem;
	}

	.ticks {
		display: flex;
		justify-content: space-between;
		margin-top: -0.6rem;
		padding: 0 0.3rem;
	}

	.btn.primary {
		padding: 0.75rem;
	}
</style>
