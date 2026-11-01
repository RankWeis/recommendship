<script lang="ts">
	import { dismissToast, toasts } from '#lib/toast.svelte.ts';
</script>

<div class="toasts" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast">
			<span>{t.message}</span>
			{#if t.action}
				<button
					class="btn ghost"
					onclick={() => {
						t.action?.run();
						dismissToast(t.id);
					}}>{t.action.label}</button
				>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(88px + var(--safe-bottom));
		width: min(calc(100% - 32px), 520px);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		z-index: 60;
		pointer-events: none;
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		background: var(--text);
		color: var(--bg);
		padding: 0.65rem 0.9rem;
		border-radius: 12px;
		box-shadow: var(--shadow);
		font-size: 0.93rem;
		animation: pop 0.18s ease-out;
	}

	.toast .btn {
		color: var(--accent);
		padding: 0.2rem 0.4rem;
	}

	@keyframes pop {
		from {
			transform: translateY(8px);
			opacity: 0;
		}
	}
</style>
