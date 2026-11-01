<script lang="ts">
	import type { Snippet } from 'svelte';

	let { open, onclose, label, children }: { open: boolean; onclose: () => void; label: string; children: Snippet } = $props();

	function onkeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

{#if open}
	<div class="backdrop" onclick={onclose} role="presentation"></div>
	<div class="sheet" role="dialog" aria-modal="true" aria-label={label}>
		<div class="grip" aria-hidden="true"></div>
		{@render children()}
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 35%);
		z-index: 40;
		animation: fade 0.15s ease-out;
	}

	.sheet {
		position: fixed;
		left: 50%;
		bottom: 0;
		transform: translateX(-50%);
		width: min(100%, 560px);
		max-height: 92dvh;
		overflow-y: auto;
		background: var(--surface);
		border-radius: 20px 20px 0 0;
		padding: 0.5rem 16px calc(1rem + var(--safe-bottom));
		z-index: 41;
		box-shadow: var(--shadow);
		animation: rise 0.2s ease-out;
	}

	.grip {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--line);
		margin: 0 auto 0.75rem;
	}

	@keyframes rise {
		from {
			transform: translate(-50%, 30px);
			opacity: 0;
		}
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
