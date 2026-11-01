<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { deleteRecommender, mergeRecommenders, renameRecommender } from '#lib/actions.ts';
	import ItemRow from '#lib/components/ItemRow.svelte';
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import { useCategories } from '#lib/categories.svelte.ts';
	import { liveQuery } from '#lib/db/live.svelte.ts';
	import { LIST_ITEM_COLUMNS, LIST_ITEM_FROM, type ListItemRow, type RecommenderRow, type StatsRow } from '#lib/db/rows.ts';
	import { fmtOffset, fmtPct, fmtRating } from '#lib/format.ts';
	import { usePeople } from '#lib/people.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';

	const id = $derived(page.params.id ?? '');
	const categories = useCategories();
	const people = usePeople();

	const person = liveQuery<RecommenderRow>(() => ({ sql: 'SELECT * FROM recommender WHERE id = ?', params: [id] }));
	const stats = liveQuery<StatsRow>(() => ({
		sql: 'SELECT * FROM recommender_stats WHERE recommender_id = ? ORDER BY category_id IS NOT NULL, n DESC',
		params: [id]
	}));
	const items = liveQuery<ListItemRow>(() => ({
		sql: `SELECT ${LIST_ITEM_COLUMNS} FROM ${LIST_ITEM_FROM}
			WHERE i.id IN (SELECT item_id FROM recommendation WHERE recommender_id = ?)
			ORDER BY p.predicted DESC NULLS LAST, i.rating DESC`,
		params: [id]
	}));

	const overall = $derived(stats.rows.find((s) => s.category_id === null));
	const byCategory = $derived(stats.rows.filter((s) => s.category_id !== null));
	const pending = $derived(items.rows.filter((i) => i.status === 'TO_TRY'));
	const rated = $derived(items.rows.filter((i) => i.status === 'TRIED' && i.rating != null).sort((a, b) => b.rating! - a.rating!));
	const best = $derived(rated.slice(0, 3));
	const worst = $derived(rated.length > 3 ? rated.slice(-3).reverse() : []);

	let editing = $state(false);
	let name = $state('');
	let merging = $state(false);
	const others = $derived(people.all.filter((r) => r.id !== id));

	const recs = (n: number) => `${n} recommendation${n === 1 ? '' : 's'}`;

	async function merge(fromName: string, target: { id: string | null; name: string }) {
		if (!target.id) return;
		if (!confirm(`Merge ${fromName} into ${target.name}? ${fromName}'s ${recs(items.rows.length)} move to ${target.name}, and ${fromName} is removed.`)) return;
		await mergeRecommenders(id, target.id);
		merging = false;
		toast(`Merged ${fromName} into ${target.name}`);
		await goto(`/recommenders/${target.id}`, { replaceState: true });
	}

	async function remove(personName: string) {
		if (!confirm(`Delete ${personName}? Their ${recs(items.rows.length)} are removed; the items stay on your lists.`)) return;
		await deleteRecommender(id);
		toast(`Deleted ${personName}`);
		await goto('/recommenders', { replaceState: true });
	}
</script>

<main class="page">
	{#if person.rows[0]}
		{@const p = person.rows[0]}
		<div class="head">
			{#if editing}
				<form
					onsubmit={async (e) => {
						e.preventDefault();
						if (name.trim()) await renameRecommender(p.id, name);
						editing = false;
					}}
				>
					<input class="field" bind:value={name} aria-label="Name" />
					<button class="btn">Save</button>
				</form>
			{:else}
				<h1>{p.name}</h1>
				<div class="person-actions">
					<button
						class="btn ghost muted small"
						onclick={() => {
							name = p.name;
							editing = true;
						}}>Rename</button
					>
					{#if others.length}
						<button class="btn ghost muted small" onclick={() => (merging = !merging)} aria-expanded={merging}>Merge</button>
					{/if}
					<button class="btn ghost muted small danger" onclick={() => remove(p.name)}>Delete</button>
				</div>
			{/if}
		</div>
		{#if merging}
			<div class="merge card">
				<span class="small">Same person as… (for typos like “Sma” → “Sam”)</span>
				<PersonPicker
					label="Merge {p.name} into"
					placeholder="Search your people"
					allowNew={false}
					excludeIds={[p.id]}
					autofocus
					onpick={(target) => merge(p.name, target)}
				/>
			</div>
		{/if}

		<div class="tiles">
			<div class="tile card">
				<span class="muted small">Score</span>
				<b class="num" class:pos={(overall?.offset_shrunk ?? 0) > 0.05} class:neg={(overall?.offset_shrunk ?? 0) < -0.05}
					>{overall?.n ? fmtOffset(overall.offset_shrunk) : '–'}</b
				>
			</div>
			<div class="tile card">
				<span class="muted small">Their avg</span>
				<b class="num">{fmtRating(overall?.mean_raw)}</b>
			</div>
			<div class="tile card">
				<span class="muted small">Hit rate</span>
				<b class="num">{fmtPct(overall?.hit_rate)}</b>
			</div>
			<div class="tile card">
				<span class="muted small">Rated / pending</span>
				<b class="num">{overall?.n ?? 0} / {overall?.pending ?? 0}</b>
			</div>
		</div>

		{#if byCategory.length}
			<h2 class="section-title">By category</h2>
			<table class="data">
				<thead>
					<tr><th>Category</th><th class="r">Rated</th><th class="r">Avg</th><th class="r">Score</th><th class="r">Hits</th><th class="r">Pending</th></tr>
				</thead>
				<tbody>
					{#each byCategory as s (s.id)}
						{@const c = categories.get(s.category_id ?? '')}
						<tr>
							<td>{c.icon} {c.name}</td>
							<td class="r num">{s.n}</td>
							<td class="r num">{fmtRating(s.mean_raw)}</td>
							<td class="r num" class:pos={s.n > 0 && s.offset_shrunk > 0.05} class:neg={s.n > 0 && s.offset_shrunk < -0.05}
								>{s.n ? fmtOffset(s.offset_shrunk) : '–'}</td
							>
							<td class="r num">{fmtPct(s.hit_rate)}</td>
							<td class="r num">{s.pending}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if pending.length}
			<h2 class="section-title">Their pending picks, best guess first</h2>
			<ul class="list">
				{#each pending as item (item.id)}
					<ItemRow {item} category={categories.get(item.category_id)} nameOf={people.nameOf} showCategory />
				{/each}
			</ul>
		{/if}

		{#if best.length}
			<h2 class="section-title">Best picks</h2>
			<ul class="list">
				{#each best as item (item.id)}
					<ItemRow {item} category={categories.get(item.category_id)} nameOf={people.nameOf} showCategory />
				{/each}
			</ul>
		{/if}
		{#if worst.length}
			<h2 class="section-title">Worst picks</h2>
			<ul class="list">
				{#each worst as item (item.id)}
					<ItemRow {item} category={categories.get(item.category_id)} nameOf={people.nameOf} showCategory />
				{/each}
			</ul>
		{/if}
	{:else if person.ready}
		<div class="empty">That person isn't here.</div>
	{/if}
</main>

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 1rem 0 0.75rem;
	}

	.head form {
		display: flex;
		gap: 0.5rem;
		flex: 1;
	}

	.person-actions {
		display: flex;
		gap: 0.1rem;
	}

	.danger:hover {
		color: var(--bad);
	}

	.merge {
		padding: 0.8rem;
		margin-bottom: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}


	h1 {
		font-size: 1.6rem;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}

	@media (max-width: 480px) {
		.tiles {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.tile {
		padding: 0.7rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.tile b {
		font-size: 1.4rem;
	}

	.list {
		margin: 0;
		padding: 0;
	}
</style>
