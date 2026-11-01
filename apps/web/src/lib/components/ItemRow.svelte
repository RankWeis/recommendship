<script lang="ts">
	import { setStatus } from '#lib/actions.ts';
	import type { CategoryRow, ListItemRow } from '#lib/db/rows.ts';
	import { parseExplanation, parseJson } from '#lib/db/rows.ts';
	import { explain, fmtRating, relativeDate, stars } from '#lib/format.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import Confidence from './Confidence.svelte';

	let {
		item,
		category,
		nameOf,
		showCategory = false
	}: { item: ListItemRow; category: CategoryRow; nameOf: (id: string) => string; showCategory?: boolean } = $props();

	const names = $derived(parseJson<string[]>(item.recommender_names, []));
	const explanation = $derived(parseExplanation(item.explanation));
	let showWhy = $state(false);

	// Swipe right = tried (opens the rating sheet), swipe left = dismiss (§5.2).
	const THRESHOLD = 80;
	let dx = $state(0);
	let start: { x: number; y: number; id: number } | null = null;
	let horizontal = false;

	function down(e: PointerEvent) {
		if (e.pointerType === 'mouse' || item.status !== 'TO_TRY') return;
		start = { x: e.clientX, y: e.clientY, id: e.pointerId };
		horizontal = false;
	}

	function move(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		const x = e.clientX - start.x;
		const y = e.clientY - start.y;
		if (!horizontal && Math.abs(x) > 10 && Math.abs(x) > Math.abs(y)) {
			horizontal = true;
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		}
		if (horizontal) dx = x;
	}

	// A swipe ends with a click on the link underneath; swallow it.
	let suppressClick = false;

	function up() {
		if (!start) return;
		start = null;
		suppressClick = horizontal;
		if (dx > THRESHOLD) markTried();
		else if (dx < -THRESHOLD) void dismiss();
		dx = 0;
	}

	function markTried() {
		ui.rateItemId = item.id;
	}

	async function dismiss() {
		const id = item.id;
		await setStatus(id, 'DISMISSED');
		toast(`Dismissed “${item.title}”`, { label: 'Undo', run: () => void setStatus(id, 'TO_TRY') });
	}
</script>

<li class="wrap">
	<div class="under" aria-hidden="true">
		<span class="tried" class:show={dx > 0}>✓ Tried</span>
		<span class="dismiss" class:show={dx < 0}>Dismiss ✕</span>
	</div>
	<div
		class="row"
		style:transform={dx ? `translateX(${dx}px)` : undefined}
		class:dragging={!!dx}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		role="group"
	>
		<a
			class="main"
			href="/items/{item.id}"
			draggable="false"
			onclick={(e) => {
				if (suppressClick) e.preventDefault();
				suppressClick = false;
			}}
		>
			<span class="icon" aria-hidden="true">
				{category.icon}
				{#if item.image_url}<img class="poster" src={item.image_url} alt="" loading="lazy" onerror={(e) => e.currentTarget.remove()} />{/if}
			</span>
			<span class="text">
				<span class="title">{item.title}</span>
				<span class="meta muted small">
					{#if showCategory}{category.name} ·
					{/if}
					{#if names.length}from {names.join(' & ')}{:else}no recommender{/if}
					{#if item.status === 'TO_TRY'}
						· {relativeDate(item.added_at)}
					{/if}
				</span>
			</span>
		</a>

		{#if item.status === 'TRIED' && item.rating != null}
			<span class="rated" title="Your rating"><span class="stars">{stars(item.rating)}</span> <b class="num">{fmtRating(item.rating)}</b></span>
		{:else if item.predicted != null}
			<button class="pred" onclick={() => (showWhy = !showWhy)} aria-expanded={showWhy} title="Why this number?">
				<b class="num">{fmtRating(item.predicted)}</b>
				<Confidence value={item.confidence} />
			</button>
		{/if}

		{#if item.status === 'TO_TRY'}
			<span class="quick">
				<button class="icon-btn" onclick={markTried} title="Tried it, rate" aria-label="Mark “{item.title}” as tried">✓</button>
				<button class="icon-btn" onclick={dismiss} title="Won't do it" aria-label="Dismiss “{item.title}”">✕</button>
			</span>
		{/if}
	</div>
	{#if showWhy && explanation}
		<p class="why small">{explain(explanation, category.name, nameOf)}</p>
	{/if}
</li>

<style>
	.wrap {
		position: relative;
		list-style: none;
		border-bottom: 1px solid var(--line);
		overflow: hidden;
	}

	.under {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 1rem;
		font-weight: 600;
		pointer-events: none;
	}

	.under span {
		opacity: 0;
	}

	.under .show {
		opacity: 1;
	}

	.tried {
		color: var(--good);
	}

	.dismiss {
		color: var(--bad);
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 0.25rem;
		background: var(--bg);
		touch-action: pan-y;
		transition: transform 0.2s ease-out;
	}

	.row.dragging {
		transition: none;
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		text-decoration: none;
	}

	.icon {
		position: relative;
		overflow: hidden;
		font-size: 1.4rem;
		width: 2.2rem;
		height: 2.2rem;
		display: grid;
		place-items: center;
		background: var(--surface-2);
		border-radius: 10px;
		flex: none;
	}

	/* Over the category icon, which shows through if the poster can't load (offline). */
	.poster {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.title {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pred {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		background: var(--accent-soft);
		border: none;
		border-radius: 10px;
		padding: 0.3rem 0.55rem;
		min-width: 3.2rem;
	}

	.pred b {
		font-size: 1.05rem;
	}

	.rated {
		white-space: nowrap;
	}

	.stars {
		color: var(--gold);
	}

	.quick {
		display: flex;
		gap: 0.25rem;
	}

	.icon-btn {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--muted);
		font-size: 0.85rem;
	}

	.icon-btn:hover {
		color: var(--text);
		border-color: var(--muted);
	}

	/* On touch screens swiping replaces the buttons. */
	@media (hover: none) {
		.quick {
			display: none;
		}
	}

	.why {
		margin: 0 0.25rem 0.7rem 3.15rem;
		padding: 0.5rem 0.7rem;
		background: var(--surface-2);
		border-radius: 10px;
	}
</style>
