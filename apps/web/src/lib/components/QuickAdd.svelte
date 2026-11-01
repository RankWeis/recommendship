<script lang="ts">
	import type { Enthusiasm } from '@recommendship/schema';
	import { createCategory, quickAdd } from '#lib/actions.ts';
	import { useCategories } from '#lib/categories.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { getLastCategory, getStickyRecommender, setLastCategory, setStickyRecommender, ui } from '#lib/ui.svelte.ts';
	import { lookupKind, type Match } from '#lib/lookup.ts';
	import PersonPicker from './PersonPicker.svelte';
	import Sheet from './Sheet.svelte';
	import TitleMatches from './TitleMatches.svelte';

	const categories = useCategories();

	let title = $state('');
	/** The movie, show or book picked from the suggestions; cleared by editing the title. */
	let match = $state<Match | null>(null);
	/** People picked so far, plus whatever is typed but not picked yet (saved too). */
	let who = $state<string[]>([]);
	let whoTyped = $state('');
	let categoryId = $state('cat-movie');
	let enthusiasm = $state<Enthusiasm | null>(null);
	let note = $state('');
	let showMore = $state(false);
	let saving = $state(false);
	let newCategory = $state<{ name: string; icon: string } | null>(null);

	// Fresh form each time the sheet opens, with the sticky recommender and last category.
	$effect(() => {
		if (!ui.quickAddOpen) return;
		title = '';
		match = null;
		note = '';
		enthusiasm = null;
		showMore = false;
		newCategory = null;
		who = getStickyRecommender()
			.split(',')
			.map((n) => n.trim())
			.filter(Boolean);
		whoTyped = '';
		categoryId = getLastCategory();
	});

	const names = $derived([...who, whoTyped.trim()].filter(Boolean));
	const kind = $derived(lookupKind(categories.get(categoryId)?.external_source));

	const canSave = $derived(title.trim().length > 0 && !saving);

	async function save() {
		if (!canSave) return;
		saving = true;
		try {
			const recommenderNames = names.filter(Boolean);
			const r = await quickAdd({ title, categoryId, recommenderNames, enthusiasm, note, match });
			if (recommenderNames.length) setStickyRecommender(recommenderNames.join(', '));
			setLastCategory(categoryId);
			ui.quickAddOpen = false;
			if (!r.existing) {
				toast(`Added “${title.trim()}”${r.attached.length ? ` from ${r.attached.join(' & ')}` : ''}`);
			} else if (r.attached.length) {
				toast(`${r.attached.join(' & ')} also recommended this ✓`);
			} else {
				toast(`Already on your list${r.alreadyThere.length ? ` from ${r.alreadyThere.join(' & ')}` : ''}`);
			}
		} finally {
			saving = false;
		}
	}

	async function addCategory() {
		if (!newCategory?.name.trim()) return;
		categoryId = await createCategory(newCategory.name, newCategory.icon);
		newCategory = null;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void save();
		}
	}

	const HYPE: { v: Enthusiasm; label: string }[] = [
		{ v: 1, label: 'might like' },
		{ v: 2, label: 'you should' },
		{ v: 3, label: 'you MUST' }
	];
</script>

<Sheet open={ui.quickAddOpen} onclose={() => (ui.quickAddOpen = false)} label="Add a recommendation">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions (only listens for ⌘/Ctrl+Enter from its fields) -->
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
		{onkeydown}
	>
		<label class="row">
			<span class="label">What?</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="field"
				bind:value={title}
				oninput={() => (match = null)}
				placeholder="Piranesi, Severance, that ramen place…"
				autofocus
				autocomplete="off"
			/>
		</label>
		{#if match}
			<p class="matched small">
				<span>✓ {[match.title, match.year, match.creator].filter(Boolean).join(' · ')}</span>
				<button type="button" class="btn ghost small" aria-label="Not this one" onclick={() => (match = null)}>×</button>
			</p>
		{:else if kind}
			<TitleMatches
				{kind}
				query={title}
				onpick={(m) => {
					match = m;
					title = m.title;
				}}
			/>
		{/if}

		<div class="cats" role="group" aria-label="Category">
			{#each categories.all as c (c.id)}
				<button
					type="button"
					class="chip"
					aria-pressed={c.id === categoryId}
					onclick={() => {
						if (c.id !== categoryId) match = null;
						categoryId = c.id;
					}}
				>
					<span aria-hidden="true">{c.icon}</span>{c.name}
				</button>
			{/each}
			<button type="button" class="chip" onclick={() => (newCategory = { name: '', icon: '' })}>＋ New</button>
		</div>
		{#if newCategory}
			<div class="new-cat">
				<input class="field icon" bind:value={newCategory.icon} placeholder="🍷" maxlength="4" aria-label="Icon" />
				<input class="field" bind:value={newCategory.name} placeholder="Category name" aria-label="Category name" />
				<button type="button" class="btn" onclick={addCategory}>Add</button>
			</div>
		{/if}

		<div class="row who">
			<span class="label" id="who-label">Who?</span>
			<PersonPicker bind:selected={who} bind:pending={whoTyped} multiple label="Who recommended it" placeholder="Search people, or type a new name" />
		</div>

		{#if showMore}
			<div class="more">
				<div class="hype" role="group" aria-label="How hyped were they?">
					{#each HYPE as h (h.v)}
						<button
							type="button"
							class="chip"
							aria-pressed={enthusiasm === h.v}
							onclick={() => (enthusiasm = enthusiasm === h.v ? null : h.v)}>{'★'.repeat(h.v)} {h.label}</button
						>
					{/each}
				</div>
				<textarea class="field" rows="2" bind:value={note} placeholder="“Watch it without trailers”"></textarea>
			</div>
		{:else}
			<button type="button" class="btn ghost more-toggle muted" onclick={() => (showMore = true)}>☆ how hyped? · 📝 note</button>
		{/if}

		<div class="actions">
			<span class="muted small hint">⌘/Ctrl + Enter</span>
			<button class="btn primary save" disabled={!canSave}>Save</button>
		</div>
	</form>
</Sheet>

<style>
	.matched {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0;
		padding: 0.2rem 0.2rem 0.2rem 0.7rem;
		border-radius: 10px;
		background: var(--accent-soft);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.label {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.cats,
	.hype {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding-bottom: 2px;
	}


	.new-cat {
		display: flex;
		gap: 0.4rem;
	}

	.new-cat .icon {
		width: 4rem;
		text-align: center;
	}

	.more {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.more-toggle {
		align-self: flex-start;
		padding-left: 0;
		font-weight: 500;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.25rem;
	}

	.save {
		min-width: 8rem;
		padding: 0.7rem 1.2rem;
	}

	@media (hover: none) {
		.hint {
			visibility: hidden;
		}
	}
</style>
