<script lang="ts">
	import ItemRow from '#lib/components/ItemRow.svelte';
	import SelectBar from '#lib/components/SelectBar.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { useCategories } from '#lib/categories.svelte.ts';
	import { liveQuery } from '#lib/db/live.svelte.ts';
	import { LIST_ITEM_COLUMNS, LIST_ITEM_FROM, type ListItemRow } from '#lib/db/rows.ts';
	import { usePeople } from '#lib/people.svelte.ts';
	import { loadSampleData } from '#lib/sample.ts';
	import { ui } from '#lib/ui.svelte.ts';

	const SORTS = {
		best: { label: 'Best guess', order: 'p.predicted DESC NULLS LAST, i.added_at DESC' },
		safe: { label: 'Safe bets', order: 'p.lower_bound DESC NULLS LAST, i.added_at DESC' },
		newest: { label: 'Newest', order: 'i.added_at DESC' },
		oldest: { label: 'Oldest', order: 'i.added_at ASC' }
	} as const;
	type SortKey = keyof typeof SORTS;

	let sort = $state<SortKey>('best');
	let tab = $state<string>('all');
	let loadingSample = $state(false);
	let selecting = $state(false);
	const selected = new SvelteSet<string>();

	const categories = useCategories();
	const people = usePeople();
	// The whole Put List is a local SELECT … ORDER BY predicted (§6).
	const list = liveQuery<ListItemRow>(() => ({
		sql: `SELECT ${LIST_ITEM_COLUMNS} FROM ${LIST_ITEM_FROM} WHERE i.status = 'TO_TRY' ORDER BY ${SORTS[sort].order}`
	}));

	const counts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const i of list.rows) m.set(i.category_id, (m.get(i.category_id) ?? 0) + 1);
		return m;
	});
	const tabs = $derived(categories.all.filter((c) => counts.has(c.id)));
	const shown = $derived(tab === 'all' ? list.rows : list.rows.filter((i) => i.category_id === tab));

	async function sample() {
		loadingSample = true;
		try {
			await loadSampleData();
		} finally {
			loadingSample = false;
		}
	}
</script>

<main class="page">
	{#if list.ready && list.rows.length === 0}
		<div class="empty">
			<h2>The Put List is empty</h2>
			<p>When someone says “you have to watch…”, tap ＋ and log it with who said it.</p>
			<p class="small"><button class="link-btn" onclick={() => (ui.aboutOpen = true)}>New here? What Recommendship does</button></p>
			<p class="actions">
				<button class="btn primary" onclick={() => (ui.quickAddOpen = true)}>Add a recommendation</button>
				<!-- Made-up people and ratings that sync and skew real predictions: local development only. -->
				{#if import.meta.env.DEV}
					<button class="btn" onclick={sample} disabled={loadingSample}>{loadingSample ? 'Loading…' : 'Load sample data'}</button>
				{/if}
			</p>
		</div>
	{:else}
		<div class="toolbar">
			<div class="tabs" role="tablist" aria-label="Category">
				<button class="chip" role="tab" aria-selected={tab === 'all'} class:active={tab === 'all'} onclick={() => (tab = 'all')}>
					All <span class="count">{list.rows.length}</span>
				</button>
				{#each tabs as c (c.id)}
					<button class="chip" role="tab" aria-selected={tab === c.id} class:active={tab === c.id} onclick={() => (tab = c.id)}>
						<span aria-hidden="true">{c.icon}</span>{c.name} <span class="count">{counts.get(c.id)}</span>
					</button>
				{/each}
			</div>
			<div class="tools">
				<button class="btn ghost small" aria-pressed={selecting} onclick={() => ((selecting = !selecting), selected.clear())}
					>{selecting ? 'Cancel' : 'Select'}</button
				>
				<label class="sort small">
				<span class="muted">Sort</span>
				<select bind:value={sort}>
					{#each Object.entries(SORTS) as [key, s] (key)}
						<option value={key}>{s.label}</option>
					{/each}
				</select>
				</label>
			</div>
		</div>

		<ul class="list">
			{#each shown as item (item.id)}
				<ItemRow
					{item}
					category={categories.get(item.category_id)}
					nameOf={people.nameOf}
					showCategory={tab === 'all'}
					{selecting}
					selected={selected.has(item.id)}
					ontoggle={() => (selected.has(item.id) ? selected.delete(item.id) : selected.add(item.id))}
				/>
			{/each}
		</ul>
		{#if selecting}
			<SelectBar {selected} shown={shown.map((i) => i.id)} ondone={() => ((selecting = false), selected.clear())} />
		{/if}
		<p class="muted small hint">
			<span class="on-touch">Tap a number to see why. Swipe right when you've tried it, left to dismiss.</span>
			<span class="on-mouse">Click a number to see why. Press ✓ when you've tried it, ✕ to dismiss.</span>
		</p>
	{/if}
</main>

<style>
	.toolbar {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.8rem 0 0.3rem;
	}

	.tabs {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		scrollbar-width: none;
		margin: 0 -16px;
		padding: 0 16px 2px;
	}

	.count {
		opacity: 0.65;
		font-variant-numeric: tabular-nums;
	}

	.tools {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.sort {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.sort select {
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 8px;
		padding: 0.25rem 0.4rem;
	}

	.list {
		margin: 0;
		padding: 0;
	}

	.hint {
		text-align: center;
		margin-top: 1.2rem;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		flex-wrap: wrap;
		margin-top: 1.2rem;
	}
</style>
