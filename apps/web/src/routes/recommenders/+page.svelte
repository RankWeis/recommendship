<script lang="ts">
	import { useCategories } from '#lib/categories.svelte.ts';
	import { liveQuery } from '#lib/db/live.svelte.ts';
	import type { StatsRow } from '#lib/db/rows.ts';
	import { fmtOffset, fmtRating } from '#lib/format.ts';

	const categories = useCategories();
	// Overall stats rows have the id `<person id>:all` (see scoring.ts), so joining on the
	// id is a key lookup; matching recommender_id and category_id took ~200 ms per 250 people.
	const people = liveQuery<{ id: string; name: string; n: number | null; mean_raw: number | null; offset_shrunk: number | null; pending: number | null }>(
		() => ({
			sql: `SELECT r.id, r.name, s.n, s.mean_raw, s.offset_shrunk, s.pending
				FROM recommender r LEFT JOIN recommender_stats s ON s.id = r.id || ':all'
				WHERE r.id IN (SELECT recommender_id FROM recommendation)
				ORDER BY (coalesce(s.n, 0) > 0) DESC, s.offset_shrunk DESC, r.name`
		})
	);
	const perCategory = liveQuery<StatsRow>(() => ({
		sql: 'SELECT * FROM recommender_stats WHERE category_id IS NOT NULL AND n > 0 ORDER BY category_id'
	}));
	const byPerson = $derived.by(() => {
		const m = new Map<string, StatsRow[]>();
		for (const s of perCategory.rows) m.set(s.recommender_id, [...(m.get(s.recommender_id) ?? []), s]);
		return m;
	});

	// Bar height for the per-category sparkline; shrunk offsets rarely pass ±0.75.
	const bar = (x: number) => Math.min(Math.abs(x) / 0.75, 1) * 12;
</script>

<main class="page">
	<h1 class="section-title">Whose picks land for you</h1>
	{#if people.ready && !people.rows.length}
		<div class="empty">No recommenders yet. They appear here once you log something they suggested.</div>
	{/if}
	<ul class="board">
		{#each people.rows as p, k (p.id)}
			<li>
				<a href="/recommenders/{p.id}" class="row">
					<span class="rank muted num">{p.n ? k + 1 : ''}</span>
					<span class="who">
						<span class="name">{p.name}</span>
						<span class="muted small">{p.n ?? 0} rated · {p.pending ?? 0} pending{p.n ? ` · avg ${fmtRating(p.mean_raw)}` : ''}</span>
					</span>
					<span class="spark" aria-label="Per-category offsets">
						{#each byPerson.get(p.id) ?? [] as s (s.id)}
							<span
								class="b"
								class:neg={s.offset_shrunk < 0}
								title="{categories.get(s.category_id ?? '').name}: {fmtOffset(s.offset_shrunk)} ({s.n} rated)"
								style:height="{bar(s.offset_shrunk) + 4}px"
							></span>
						{/each}
					</span>
					<span class="score num" class:pos={(p.offset_shrunk ?? 0) > 0.05} class:neg={(p.offset_shrunk ?? 0) < -0.05}>
						{p.n ? fmtOffset(p.offset_shrunk ?? 0) : 'new'}
					</span>
				</a>
			</li>
		{/each}
	</ul>
	{#if people.rows.length}
		<p class="muted small">
			The score is how much better or worse a person's picks run for you than a middling 3.5, shrunk toward zero until there's
			enough evidence. It comes only from your ratings of their picks.
		</p>
	{/if}
</main>

<style>
	.board {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.25rem;
		border-bottom: 1px solid var(--line);
		text-decoration: none;
	}

	.rank {
		width: 1.4rem;
		text-align: right;
	}

	.who {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.name {
		font-weight: 600;
	}

	.spark {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 16px;
	}

	.b {
		width: 5px;
		border-radius: 2px;
		background: var(--good);
	}

	.b.neg {
		background: var(--bad);
	}

	.score {
		width: 3.2rem;
		text-align: right;
		font-weight: 700;
		font-size: 1.05rem;
	}
</style>
