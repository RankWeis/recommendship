<script lang="ts">
	// Movies, shows or books matching a typed title, from TMDB or Open Library. Searches
	// shortly after typing stops, and shows nothing when lookup can't help (offline,
	// nothing found), so typing a title and saving it always works.
	import { searchTitles, type LookupKind, type Match } from '#lib/lookup.ts';

	let { kind, query, onpick, label = 'Matching titles' }: { kind: LookupKind; query: string; onpick: (m: Match) => void; label?: string } =
		$props();

	let results = $state<Match[]>([]);

	$effect(() => {
		const q = query.trim();
		const k = kind;
		if (q.length < 2) {
			results = [];
			return;
		}
		const ctrl = new AbortController();
		const timer = setTimeout(async () => {
			const found = await searchTitles(k, q, ctrl.signal);
			if (!ctrl.signal.aborted) results = found;
		}, 300);
		return () => {
			clearTimeout(timer);
			ctrl.abort();
		};
	});
</script>

{#if results.length}
	<div class="matches">
		<ul aria-label={label}>
			{#each results as m (m.source + m.id)}
				<li>
					<button type="button" class="match" onclick={() => onpick(m)}>
						<span class="thumb" aria-hidden="true">
							{#if m.imageUrl}<img src={m.imageUrl} alt="" loading="lazy" />{/if}
						</span>
						<span class="text">
							<span class="title">{m.title}</span>
							{#if m.year || m.creator}<span class="muted small">{[m.year, m.creator].filter(Boolean).join(' · ')}</span>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
		<p class="muted small source">From {kind === 'book' ? 'Open Library' : 'TMDB'} · or just save what you typed</p>
	</div>
{/if}

<style>
	.matches {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface);
		overflow: hidden;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0.25rem;
		max-height: 15rem;
		overflow-y: auto;
	}

	.match {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		padding: 0.35rem 0.4rem;
		border-radius: 8px;
		color: inherit;
		font: inherit;
	}

	.match:hover,
	.match:focus-visible {
		background: var(--accent-soft);
	}

	.thumb {
		flex: 0 0 auto;
		width: 2.2rem;
		height: 3.2rem;
		border-radius: 4px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.title {
		overflow-wrap: anywhere;
	}

	.source {
		margin: 0;
		padding: 0.3rem 0.65rem 0.45rem;
		border-top: 1px solid var(--line);
	}
</style>
