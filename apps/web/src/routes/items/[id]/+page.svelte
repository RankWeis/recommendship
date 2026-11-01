<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		addRecommendation,
		changeRecommender,
		deleteItem,
		matchItem,
		mergeItems,
		removeRecommendation,
		setEnthusiasm,
		setRecommendationNote,
		setStatus,
		updateItem
	} from '#lib/actions.ts';
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import TitleMatches from '#lib/components/TitleMatches.svelte';
	import { lookupKind, type Match } from '#lib/lookup.ts';
	import type { Enthusiasm } from '@recommendship/schema';
	import Confidence from '#lib/components/Confidence.svelte';
	import { useCategories } from '#lib/categories.svelte.ts';
	import { liveQuery } from '#lib/db/live.svelte.ts';
	import { parseExplanation, type ItemRow } from '#lib/db/rows.ts';
	import { explain, fmtRating, relativeDate, stars } from '#lib/format.ts';
	import { usePeople } from '#lib/people.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';

	const id = $derived(page.params.id ?? '');
	const categories = useCategories();
	const people = usePeople();

	const found = liveQuery<ItemRow & { predicted: number | null; confidence: number | null; explanation: string | null }>(() => ({
		sql: `SELECT i.*, p.predicted, p.confidence, p.explanation FROM item i LEFT JOIN item_prediction p ON p.id = i.id WHERE i.id = ?`,
		params: [id]
	}));
	const recs = liveQuery<{ id: string; recommender_id: string; name: string; note: string | null; enthusiasm: number | null; received_at: string }>(
		() => ({
			sql: `SELECT rc.id, rc.recommender_id, r.name, rc.note, rc.enthusiasm, rc.received_at
				FROM recommendation rc JOIN recommender r ON r.id = rc.recommender_id WHERE rc.item_id = ? ORDER BY rc.received_at`,
			params: [id]
		})
	);

	const item = $derived(found.rows[0]);
	const category = $derived(item ? categories.get(item.category_id) : null);
	const explanation = $derived(parseExplanation(item?.explanation ?? null));

	let editing = $state(false);
	let title = $state('');
	let categoryId = $state('');

	const HYPE = ['', 'might like', 'you should', 'you MUST'];

	// Editing who recommended it, how hyped they were, and their note.
	let adding = $state(false);
	let changingId = $state<string | null>(null);
	let notingId = $state<string | null>(null);
	let noteText = $state('');

	async function add(name: string) {
		const added = await addRecommendation(id, name);
		toast(added ? `Added ${name}` : `${name} is already here`);
		adding = false;
	}

	async function change(recId: string, from: string, to: string) {
		await changeRecommender(recId, to);
		toast(`${from} → ${to}`);
		changingId = null;
	}

	const hype = (recId: string, current: number | null, v: Enthusiasm) => setEnthusiasm(recId, current === v ? null : v);

	// Merge: find the item this one duplicates. Starts from the first letters of the
	// title, so a typo ("Severence") already lists the original ("Severance").
	let merging = $state(false);
	let query = $state('');
	const allItems = liveQuery<{ id: string; title: string; category_id: string; status: string }>(() => ({
		sql: 'SELECT id, title, category_id, status FROM item ORDER BY lower(title)'
	}));
	const candidates = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return allItems.rows.filter((i) => i.id !== id && i.title.toLowerCase().includes(q)).slice(0, 8);
	});

	function startMerge(t: string) {
		query = t.slice(0, Math.min(4, t.length));
		merging = !merging;
	}

	const recCount = (n: number) => `${n} recommendation${n === 1 ? '' : 's'}`;

	async function merge(from: { id: string; title: string }, into: { id: string; title: string }) {
		if (!confirm(`Merge “${from.title}” into “${into.title}”? Its ${recCount(recs.rows.length)} and anything “${into.title}” is missing (like a rating) move across, then “${from.title}” is removed.`)) return;
		await mergeItems(from.id, into.id);
		toast(`Merged into “${into.title}”`);
		await goto(`/items/${into.id}`, { replaceState: true });
	}

	// Link an item typed by hand to the real movie, show or book: poster, year, who made it.
	let matching = $state(false);
	let matchQuery = $state('');
	const kind = $derived(lookupKind(category?.external_source));

	async function pickMatch(from: { id: string; title: string }, m: Match) {
		const { duplicate } = await matchItem(from.id, m);
		matching = false;
		if (!duplicate) {
			toast(`Linked to “${m.title}”${m.year ? ` (${m.year})` : ''}`);
		} else if (confirm(`You already have “${duplicate.title}” for that. Merge “${from.title}” into it?`)) {
			await mergeItems(from.id, duplicate.id);
			toast(`Merged into “${duplicate.title}”`);
			await goto(`/items/${duplicate.id}`, { replaceState: true });
		}
	}

	async function remove(t: string) {
		if (!confirm(`Delete “${t}”${recs.rows.length ? ` and its ${recCount(recs.rows.length)}` : ''}? This can't be undone.`)) return;
		await deleteItem(id);
		toast(`Deleted “${t}”`);
		await goto('/', { replaceState: true });
	}
</script>

<main class="page">
	{#if item && category}
		<div class="head">
			<span class="icon" class:has-poster={!!item.image_url} aria-hidden="true">
				{category.icon}
				{#if item.image_url}<img class="poster" src={item.image_url} alt="" onerror={(e) => e.currentTarget.remove()} />{/if}
			</span>
			{#if editing}
				<form
					class="edit"
					onsubmit={async (e) => {
						e.preventDefault();
						if (title.trim()) await updateItem(item.id, { title, categoryId });
						editing = false;
					}}
				>
					<input class="field" bind:value={title} aria-label="Title" />
					<select class="field" bind:value={categoryId} aria-label="Category">
						{#each categories.all as c (c.id)}
							<option value={c.id}>{c.icon} {c.name}</option>
						{/each}
					</select>
					<div class="row-actions">
						<button class="btn primary">Save</button>
						<button type="button" class="btn" onclick={() => (editing = false)}>Cancel</button>
					</div>
				</form>
			{:else}
				<div class="titles">
					<h1>{item.title}</h1>
					{#if item.year || item.creator}<p class="made">{[item.year, item.creator].filter(Boolean).join(' · ')}</p>{/if}
					<p class="muted small">
						{category.name} · added {relativeDate(item.added_at)}
						<button
							class="btn ghost small link"
							onclick={() => {
								title = item.title;
								categoryId = item.category_id;
								editing = true;
							}}>Edit</button
						>
						<button class="btn ghost small link" onclick={() => startMerge(item.title)} aria-expanded={merging}>Merge</button>
						{#if kind && !item.external_id}
							<button
								class="btn ghost small link"
								aria-expanded={matching}
								onclick={() => {
									matchQuery = item.title;
									matching = !matching;
								}}>Find a match</button
							>
						{/if}
						<button class="btn ghost small link danger" onclick={() => remove(item.title)}>Delete</button>
					</p>
				</div>
			{/if}
		</div>

		{#if matching && kind}
			<div class="card merge">
				<label class="small" for="match-search">Which one is it? Linking adds the poster, year and who made it, and fixes the title.</label>
				<input id="match-search" class="field" bind:value={matchQuery} autocomplete="off" />
				<TitleMatches {kind} query={matchQuery} onpick={(m) => pickMatch(item, m)} />
			</div>
		{/if}

		{#if merging}
			<div class="card merge">
				<label class="small" for="merge-search">Same thing as… (for duplicates like “Severence” → “Severance”)</label>
				<input id="merge-search" class="field" bind:value={query} placeholder="Search your items" autocomplete="off" />
				{#if candidates.length}
					<ul class="candidates">
						{#each candidates as c (c.id)}
							<li>
								<button class="candidate" onclick={() => merge(item, c)}>
									<span aria-hidden="true">{categories.get(c.category_id).icon}</span>
									<span class="c-title">{c.title}</span>
									<span class="muted small">{c.status === 'TRIED' ? 'tried' : c.status === 'DISMISSED' ? 'dismissed' : 'on your list'}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if query.trim()}
					<p class="muted small">No other items match “{query.trim()}”.</p>
				{/if}
			</div>
		{/if}

		{#if item.status === 'TRIED' && item.rating != null}
			<div class="card panel">
				<div class="rating">
					<span class="stars">{stars(item.rating)}</span>
					<b class="num">{fmtRating(item.rating)}</b>
					<span class="muted small">your rating</span>
				</div>
				{#if item.review}<p class="review">“{item.review}”</p>{/if}
				<div class="row-actions">
					<button class="btn" onclick={() => (ui.rateItemId = item.id)}>Change rating</button>
					<button class="btn ghost muted" onclick={() => setStatus(item.id, 'TO_TRY')}>Back to the Put List</button>
				</div>
			</div>
		{:else if item.status === 'DISMISSED'}
			<div class="card panel">
				<p class="muted">You dismissed this. It doesn't count against anyone.</p>
				<button class="btn" onclick={() => setStatus(item.id, 'TO_TRY')}>Back to the Put List</button>
			</div>
		{:else}
			<div class="card panel">
				{#if item.predicted != null}
					<div class="rating">
						<b class="num big">{fmtRating(item.predicted)}</b>
						<Confidence value={item.confidence} />
						<span class="muted small">predicted for you</span>
					</div>
					{#if explanation}<p class="small">{explain(explanation, category.name, people.nameOf)}</p>{/if}
				{/if}
				<div class="row-actions">
					<button class="btn primary" onclick={() => (ui.rateItemId = item.id)}>Tried it, rate</button>
					<button class="btn" onclick={() => setStatus(item.id, 'DISMISSED')}>Dismiss</button>
				</div>
			</div>
		{/if}

		<h2 class="section-title">Recommended by</h2>
		{#if !recs.rows.length}
			<p class="muted">Nobody recorded yet.</p>
		{/if}
		<ul class="recs">
			{#each recs.rows as r (r.id)}
				<li>
					<div class="rec-main">
						<div class="rec-head">
							<a href="/recommenders/{r.recommender_id}"><b>{r.name}</b></a>
							<span class="muted small">· {relativeDate(r.received_at)}</span>
						</div>
						<div class="hype" role="group" aria-label="How hyped was {r.name}?">
							{#each [1, 2, 3] as const as v (v)}
								<button
									class="star"
									class:on={(r.enthusiasm ?? 0) >= v}
									aria-pressed={r.enthusiasm === v}
									aria-label="{r.name}: {HYPE[v]}"
									title={HYPE[v]}
									onclick={() => hype(r.id, r.enthusiasm, v)}>★</button
								>
							{/each}
							<span class="muted small">{r.enthusiasm ? HYPE[r.enthusiasm] : 'how hyped?'}</span>
						</div>

						{#if notingId === r.id}
							<form
								class="note-edit"
								onsubmit={async (e) => {
									e.preventDefault();
									await setRecommendationNote(r.id, noteText);
									notingId = null;
								}}
							>
								<!-- svelte-ignore a11y_autofocus -->
								<textarea class="field" rows="2" bind:value={noteText} placeholder="“Watch it without trailers”" aria-label="Note from {r.name}" autofocus></textarea>
								<div class="row-actions">
									<button class="btn primary small">Save note</button>
									<button type="button" class="btn small" onclick={() => (notingId = null)}>Cancel</button>
								</div>
							</form>
						{:else if r.note}
							<button class="note-btn" onclick={() => ((noteText = r.note ?? ''), (notingId = r.id))} title="Edit note">“{r.note}”</button>
						{/if}

						{#if changingId === r.id}
							<div class="inline-picker">
								<PersonPicker
									label="Who recommended it instead of {r.name}?"
									placeholder="Who was it really?"
									excludeIds={[r.recommender_id]}
									autofocus
									onpick={(p) => change(r.id, r.name, p.name)}
								/>
								<button class="btn ghost small" onclick={() => (changingId = null)}>Cancel</button>
							</div>
						{/if}
					</div>
					<div class="rec-actions">
						{#if !r.note && notingId !== r.id}
							<button class="btn ghost muted small" onclick={() => ((noteText = ''), (notingId = r.id))}>Note</button>
						{/if}
						<button class="btn ghost muted small" onclick={() => (changingId = changingId === r.id ? null : r.id)} aria-label="Change {r.name}">Change</button>
						<button class="btn ghost muted small danger" onclick={() => removeRecommendation(r.id)} aria-label="Remove {r.name}">Remove</button>
					</div>
				</li>
			{/each}
		</ul>
		{#if adding}
			<div class="inline-picker">
				<PersonPicker
					label="Add who recommended it"
					placeholder="Who else recommended it?"
					excludeIds={recs.rows.map((r) => r.recommender_id)}
					autofocus
					onpick={(p) => add(p.name)}
				/>
				<button class="btn ghost small" onclick={() => (adding = false)}>Cancel</button>
			</div>
		{:else}
			<button class="btn add-person" onclick={() => (adding = true)}>＋ Add person</button>
		{/if}
	{:else if found.ready}
		<div class="empty">That item isn't here.</div>
	{/if}
</main>

<style>
	.head {
		display: flex;
		gap: 0.8rem;
		align-items: flex-start;
		padding: 1rem 0;
	}

	.icon {
		position: relative;
		overflow: hidden;
		font-size: 2rem;
		width: 3.2rem;
		height: 3.2rem;
		display: grid;
		place-items: center;
		background: var(--surface-2);
		border-radius: 14px;
		flex: none;
	}

	/* A poster is taller than the icon square. */
	.icon.has-poster {
		width: 4.4rem;
		height: 6.6rem;
		border-radius: 8px;
	}

	.poster {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.titles {
		min-width: 0;
	}

	.made {
		margin: 0.15rem 0 0;
	}

	h1 {
		font-size: 1.5rem;
	}

	.titles p {
		margin: 0.25rem 0 0;
	}

	.link {
		padding: 0 0.3rem;
		color: var(--accent);
	}

	.link.danger {
		color: var(--muted);
	}

	.link.danger:hover {
		color: var(--bad);
	}

	.merge {
		padding: 0.8rem;
		margin-bottom: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.candidates {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.candidate {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.2rem;
		background: none;
		border: none;
		border-bottom: 1px solid var(--line);
		text-align: left;
	}

	.candidate:hover {
		background: var(--surface-2);
	}

	.c-title {
		flex: 1;
		font-weight: 600;
	}

	.edit {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.panel {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.panel p {
		margin: 0;
	}

	.rating {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.rating b {
		font-size: 1.4rem;
	}

	.rating .big {
		font-size: 2rem;
	}

	.stars {
		color: var(--gold);
		font-size: 1.3rem;
	}

	.review {
		font-style: italic;
	}

	.row-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.recs {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.recs li {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--line);
	}

	.rec-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.rec-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.hype {
		display: flex;
		align-items: center;
		gap: 0.1rem;
	}

	.star {
		border: none;
		background: none;
		padding: 0 0.1rem;
		font-size: 1.1rem;
		color: var(--line);
		line-height: 1;
	}

	.star.on {
		color: var(--gold);
	}

	.note-btn {
		border: none;
		background: none;
		padding: 0;
		text-align: left;
		font-style: italic;
	}

	.note-edit {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.inline-picker {
		display: flex;
		gap: 0.4rem;
		align-items: flex-start;
		margin-top: 0.4rem;
	}

	.inline-picker :global(.picker) {
		flex: 1;
	}

	.add-person {
		margin-top: 0.7rem;
	}

	.recs a {
		text-decoration: none;
	}

</style>
