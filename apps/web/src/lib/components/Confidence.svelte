<script lang="ts">
	import { confidenceDots } from '#lib/format.ts';

	let { value }: { value: number | null | undefined } = $props();
	const dots = $derived(confidenceDots(value));
</script>

<span class="dots" title={dots.label} aria-label={dots.label}>
	{#each [0, 1, 2] as i (i)}
		<span class:on={i < dots.filled}></span>
	{/each}
</span>

<style>
	.dots {
		display: inline-flex;
		gap: 3px;
		vertical-align: middle;
	}

	span span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		border: 1px solid var(--muted);
	}

	span span.on {
		background: var(--accent);
		border-color: var(--accent);
	}
</style>
