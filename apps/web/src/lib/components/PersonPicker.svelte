<script lang="ts">
	// Search your people wherever you type a name: Quick Add (several people), adding
	// or changing a person on an item, merging people. Matches that start with what you
	// typed come first, then everyone else containing it; with nothing typed it offers
	// the people you used most recently. Enter or a click picks the highlighted person,
	// or adds a new one when that's allowed.
	import { liveQuery } from '#lib/db/live.svelte.ts';

	export interface Picked {
		/** null when this is a new person, created on save. */
		id: string | null;
		name: string;
	}

	let {
		selected = $bindable([]),
		pending = $bindable(''),
		multiple = false,
		allowNew = true,
		excludeIds = [],
		placeholder = 'Search people',
		label,
		autofocus = false,
		onpick
	}: {
		/** Names picked so far (multiple mode). */
		selected?: string[];
		/** Text typed but not yet picked, so a form can include it on save. */
		pending?: string;
		multiple?: boolean;
		allowNew?: boolean;
		excludeIds?: string[];
		placeholder?: string;
		label: string;
		autofocus?: boolean;
		onpick?: (p: Picked) => void;
	} = $props();

	const people = liveQuery<{ id: string; name: string }>(() => ({
		sql: `SELECT r.id, r.name, max(rc.received_at) AS last_at
			FROM recommender r LEFT JOIN recommendation rc ON rc.recommender_id = r.id
			GROUP BY r.id ORDER BY last_at DESC NULLS LAST, lower(r.name)`
	}));

	// Several pickers can be on one page (adding and changing people on an item).
	const listId = `person-options-${Math.random().toString(36).slice(2, 8)}`;
	let focused = $state(false);
	let highlight = $state(0);
	let input: HTMLInputElement | undefined = $state();

	const q = $derived(pending.trim().toLowerCase());
	const taken = $derived(new Set(selected.map((n) => n.toLowerCase())));
	const matches = $derived.by(() => {
		const pool = people.rows.filter((p) => !excludeIds.includes(p.id) && !taken.has(p.name.toLowerCase()));
		if (!q) return pool.slice(0, 6);
		const starts = pool.filter((p) => p.name.toLowerCase().startsWith(q));
		const contains = pool.filter((p) => !p.name.toLowerCase().startsWith(q) && p.name.toLowerCase().includes(q));
		return [...starts, ...contains].slice(0, 6);
	});
	const exact = $derived(people.rows.some((p) => p.name.toLowerCase() === q) || taken.has(q));
	const offerNew = $derived(allowNew && !!q && !exact);
	const options = $derived<Picked[]>([...matches, ...(offerNew ? [{ id: null, name: pending.trim() }] : [])]);

	$effect(() => {
		void options.length;
		highlight = 0;
	});

	function pick(p: Picked) {
		if (multiple) selected = [...selected, p.name];
		onpick?.(p);
		pending = '';
		input?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' && options.length) {
			e.preventDefault();
			highlight = (highlight + 1) % options.length;
		} else if (e.key === 'ArrowUp' && options.length) {
			e.preventDefault();
			highlight = (highlight - 1 + options.length) % options.length;
		} else if ((e.key === 'Enter' || (multiple && e.key === ',')) && q && options[highlight] && !e.metaKey && !e.ctrlKey) {
			e.preventDefault();
			pick(options[highlight]!);
		} else if (e.key === 'Backspace' && multiple && !pending && selected.length) {
			selected = selected.slice(0, -1);
		} else if (e.key === 'Escape' && pending) {
			e.stopPropagation();
			pending = '';
		}
	}
</script>

<div class="picker" class:focused>
	{#each selected as name, k (name)}
		<span class="chip person">
			{name}
			<button type="button" class="x" aria-label="Remove {name}" onclick={() => (selected = selected.filter((_, j) => j !== k))}>×</button>
		</span>
	{/each}
	<!-- svelte-ignore a11y_autofocus -->
	<input
		bind:this={input}
		bind:value={pending}
		{placeholder}
		aria-label={label}
		role="combobox"
		aria-expanded={focused && options.length > 0}
		aria-controls={listId}
		autocomplete="off"
		{autofocus}
		onfocus={() => (focused = true)}
		onblur={() => (focused = false)}
		{onkeydown}
	/>
	{#if focused && options.length}
		<ul class="options" id={listId} role="listbox" aria-label="Matching people">
			{#each options as o, k (o.id ?? `new:${o.name}`)}
				<li>
					<!-- mousedown keeps focus in the input, so the list doesn't close before the click lands -->
					<button
						type="button"
						role="option"
						aria-selected={k === highlight}
						class:active={k === highlight}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(o)}
					>
						{#if o.id}{o.name}{:else}Add “{o.name}” as a new person{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 10px;
		padding: 0.35rem 0.5rem;
	}

	.picker.focused {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	input {
		flex: 1;
		min-width: 8rem;
		border: none;
		outline: none;
		background: transparent;
		padding: 0.35rem 0.2rem;
	}

	.person {
		padding: 0.2rem 0.3rem 0.2rem 0.6rem;
	}

	.x {
		border: none;
		background: none;
		color: var(--muted);
		padding: 0 0.2rem;
		font-size: 1rem;
		line-height: 1;
	}

	.options {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 4px);
		z-index: 50;
		list-style: none;
		margin: 0;
		padding: 0.25rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
		box-shadow: var(--shadow);
	}

	.options button {
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		padding: 0.5rem 0.6rem;
		border-radius: 8px;
	}

	.options button.active {
		background: var(--accent-soft);
	}
</style>
