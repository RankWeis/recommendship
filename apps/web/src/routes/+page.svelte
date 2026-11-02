<script lang="ts">
	import ItemRow from '#lib/components/ItemRow.svelte';
	import SelectBar from '#lib/components/SelectBar.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { useCategories } from '#lib/categories.svelte.ts';
	import { liveQuery } from '#lib/db/live.svelte.ts';
	import { LIST_ITEM_COLUMNS, LIST_ITEM_FROM, parseJson, type ListItemRow } from '#lib/db/rows.ts';
	import { usePeople } from '#lib/people.svelte.ts';
	import { loadSampleData } from '#lib/sample.ts';
	import { account } from '#lib/sync.svelte.ts';
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

	// Filters: who recommended it, and how hyped they were. Both must hold for the same
	// person ("Sam said you MUST"), so they apply to each recommendation, not the item.
	const HYPE = [
		{ value: '', label: 'Any hype' },
		{ value: '3', label: '★★★ MUST' },
		{ value: '2', label: '★★ should' },
		{ value: '1', label: '★ might like' },
		{ value: 'none', label: 'No hype' }
	] as const;
	let person = $state('');
	let hype = $state<(typeof HYPE)[number]['value']>('');
	const filtering = $derived(!!person || !!hype);

	const withRecs = $derived(
		list.rows.map((item) => {
			const ids = parseJson<string[]>(item.recommender_ids, []);
			const levels = parseJson<(number | null)[]>(item.recommender_enthusiasm, []);
			return { item, recs: ids.map((id, k) => ({ id, level: levels[k] ?? null })) };
		})
	);
	const hypeMatches = (level: number | null) => !hype || (hype === 'none' ? level == null : level === Number(hype));
	const filtered = $derived(
		filtering
			? withRecs.filter(({ recs }) => recs.some((r) => (!person || r.id === person) && hypeMatches(r.level))).map(({ item }) => item)
			: list.rows
	);
	// People with something on the Put List, most first.
	const personOptions = $derived.by(() => {
		const n = new Map<string, number>();
		for (const { recs } of withRecs) for (const r of recs) n.set(r.id, (n.get(r.id) ?? 0) + 1);
		return [...n].sort((a, b) => b[1] - a[1] || people.nameOf(a[0]).localeCompare(people.nameOf(b[0])));
	});

	const counts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const i of filtered) m.set(i.category_id, (m.get(i.category_id) ?? 0) + 1);
		return m;
	});
	const tabs = $derived(categories.all.filter((c) => counts.has(c.id)));
	const shown = $derived(tab === 'all' ? filtered : filtered.filter((i) => i.category_id === tab));

	// A filter can empty the chosen type's tab; fall back to All rather than show nothing.
	$effect(() => {
		if (tab !== 'all' && !counts.has(tab)) tab = 'all';
	});

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
			{#if account.me === null}
				<p class="muted">
					No account needed to try it: everything stays on this device. <a href="/account">Sign in</a> any time to back it up and use it on
					your other devices.
				</p>
			{/if}
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
					All <span class="count">{filtered.length}</span>
				</button>
				{#each tabs as c (c.id)}
					<button class="chip" role="tab" aria-selected={tab === c.id} class:active={tab === c.id} onclick={() => (tab = c.id)}>
						<span aria-hidden="true">{c.icon}</span>{c.name} <span class="count">{counts.get(c.id)}</span>
					</button>
				{/each}
			</div>
			<div class="filters">
				<select bind:value={person} aria-label="Recommended by" class:on={!!person}>
					<option value="">Anyone</option>
					{#each personOptions as [id, n] (id)}
						<option value={id}>{people.nameOf(id)} ({n})</option>
					{/each}
				</select>
				<select bind:value={hype} aria-label="How hyped" class:on={!!hype}>
					{#each HYPE as h (h.value)}
						<option value={h.value}>{h.label}</option>
					{/each}
				</select>
				{#if filtering}
					<button class="btn ghost small" onclick={() => ((person = ''), (hype = ''))}>Clear</button>
				{/if}
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

		{#if filtering && !shown.length}
			<p class="empty small">
				Nothing on the Put List matches. <button class="link-btn" onclick={() => ((person = ''), (hype = ''))}>Clear the filters</button>
			</p>
		{/if}
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

	.filters {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}

	.filters select {
		flex: 1 1 0;
		min-width: 0;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		font: inherit;
		font-size: 0.9rem;
		color: inherit;
	}

	.filters select.on {
		border-color: var(--accent);
		background: var(--accent-soft);
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
