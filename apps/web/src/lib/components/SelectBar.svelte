<script lang="ts">
	// Select mode for a list of items: pick some or all of what's shown, then delete them.
	// The page keeps the selection (a SvelteSet of ids) and passes what's on screen.
	import { deleteItems } from '#lib/actions.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import type { SvelteSet } from 'svelte/reactivity';

	let { selected, shown, ondone }: { selected: SvelteSet<string>; shown: string[]; ondone: () => void } = $props();

	let deleting = $state(false);
	const allShown = $derived(shown.length > 0 && shown.every((id) => selected.has(id)));

	$effect(() => {
		ui.selecting = true;
		return () => {
			ui.selecting = false;
		};
	});

	function toggleAll() {
		if (allShown) for (const id of shown) selected.delete(id);
		else for (const id of shown) selected.add(id);
	}

	async function remove() {
		const ids = [...selected];
		const what = ids.length === 1 ? 'this item' : `these ${ids.length.toLocaleString()} items`;
		if (!confirm(`Delete ${what} and who recommended them? People who only recommended these go too. This can't be undone.`)) return;
		deleting = true;
		try {
			const r = await deleteItems(ids);
			toast(`Deleted ${r.items.toLocaleString()} item${r.items === 1 ? '' : 's'}${r.people ? ` and ${r.people} ${r.people === 1 ? 'person' : 'people'}` : ''}`);
			selected.clear();
			ondone();
		} finally {
			deleting = false;
		}
	}
</script>

<div class="select-bar" role="toolbar" aria-label="Selected items">
	<span class="count"><b class="num">{selected.size.toLocaleString()}</b> selected</span>
	<button class="btn ghost small" onclick={toggleAll} disabled={!shown.length}>
		{#if allShown}<span class="wide">Select none</span><span class="narrow">None</span>{:else}<span class="wide">Select all</span><span
				class="narrow">All</span
			>
			{shown.length.toLocaleString()}{/if}
	</button>
	<button class="btn small danger-fill" onclick={remove} disabled={!selected.size || deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
	<button class="btn ghost small" onclick={ondone}>Done</button>
</div>

<style>
	.select-bar {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(16px + var(--safe-bottom));
		width: min(calc(100% - 32px), 648px);
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.6rem 0.5rem 0.9rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 999px;
		box-shadow: var(--shadow);
		z-index: 35;
	}

	.count {
		margin-right: auto;
		white-space: nowrap;
	}

	.select-bar .btn {
		white-space: nowrap;
	}

	.narrow {
		display: none;
	}

	/* Phones: drop the words that don't fit. */
	@media (max-width: 420px) {
		.select-bar {
			gap: 0.15rem;
			padding: 0.4rem 0.4rem 0.4rem 0.8rem;
		}

		.select-bar .btn {
			padding-left: 0.55rem;
			padding-right: 0.55rem;
		}

		.wide {
			display: none;
		}

		.narrow {
			display: inline;
		}
	}

	.danger-fill {
		background: var(--bad);
		border-color: var(--bad);
		color: var(--bg);
	}

	.danger-fill:disabled {
		opacity: 0.45;
	}
</style>
