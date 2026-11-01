<script lang="ts">
	import ItemRow from '#lib/components/ItemRow.svelte';
	import { useCategories } from '#lib/categories.svelte.ts';
	import { liveQuery } from '#lib/db/live.svelte.ts';
	import { LIST_ITEM_COLUMNS, LIST_ITEM_FROM, type ListItemRow } from '#lib/db/rows.ts';
	import { usePeople } from '#lib/people.svelte.ts';

	const categories = useCategories();
	const people = usePeople();
	const tried = liveQuery<ListItemRow>(() => ({
		sql: `SELECT ${LIST_ITEM_COLUMNS} FROM ${LIST_ITEM_FROM} WHERE i.status = 'TRIED' ORDER BY i.rated_at DESC`
	}));
	const dismissed = liveQuery<ListItemRow>(() => ({
		sql: `SELECT ${LIST_ITEM_COLUMNS} FROM ${LIST_ITEM_FROM} WHERE i.status = 'DISMISSED' ORDER BY i.added_at DESC`
	}));
</script>

<main class="page">
	{#if tried.ready && !tried.rows.length && !dismissed.rows.length}
		<div class="empty">
			Nothing rated yet.
			<span class="on-touch">Swipe right on something on the Put List once you've tried it.</span>
			<span class="on-mouse">Press ✓ on something on the Put List once you've tried it.</span>
		</div>
	{/if}

	{#if tried.rows.length}
		<h2 class="section-title">Tried · {tried.rows.length}</h2>
		<ul class="list">
			{#each tried.rows as item (item.id)}
				<ItemRow {item} category={categories.get(item.category_id)} nameOf={people.nameOf} showCategory />
			{/each}
		</ul>
	{/if}

	{#if dismissed.rows.length}
		<h2 class="section-title">Dismissed · {dismissed.rows.length}</h2>
		<p class="muted small">These never count against anyone.</p>
		<ul class="list">
			{#each dismissed.rows as item (item.id)}
				<ItemRow {item} category={categories.get(item.category_id)} nameOf={people.nameOf} showCategory />
			{/each}
		</ul>
	{/if}
</main>

<style>
	.list {
		margin: 0;
		padding: 0;
	}
</style>
