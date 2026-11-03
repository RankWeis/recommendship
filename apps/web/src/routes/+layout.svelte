<script lang="ts">
	import '../app.css';
	import { page, updated } from '$app/state';
	import AboutContent from '#lib/components/AboutContent.svelte';
	import QuickAdd from '#lib/components/QuickAdd.svelte';
	import RateSheet from '#lib/components/RateSheet.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import { initDb, releaseDb } from '#lib/db/index.ts';
	import { startAutoRecompute } from '#lib/scoring.ts';
	import { account, startSync } from '#lib/sync.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { ui } from '#lib/ui.svelte.ts';
	import { onMount, untrack, type Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	let status = $state<'opening' | 'ready' | 'failed'>('opening');
	let error = $state('');
	/** Opening normally takes well under a second; past this, say what to do. */
	let slow = $state(false);

	onMount(() => {
		if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js').catch((e) => console.warn('service worker', e));
		}

		const stops: (() => void)[] = [];
		const slowTimer = setTimeout(() => (slow = true), 8_000);
		stops.push(() => clearTimeout(slowTimer));

		// Only one page can hold the database. Let go of it when this page goes away (a
		// redirect, or iOS keeping it in the background), and start fresh if it comes back.
		const onHide = () => void releaseDb();
		const onShow = (e: PageTransitionEvent) => {
			if (e.persisted) location.reload();
		};
		addEventListener('pagehide', onHide);
		addEventListener('pageshow', onShow);
		stops.push(() => {
			removeEventListener('pagehide', onHide);
			removeEventListener('pageshow', onShow);
		});

		initDb()
			.then(() => {
				stops.push(startAutoRecompute());
				status = 'ready';
				// Never blocks the UI: the app works offline and signed out.
				void startSync().then((stop) => stops.push(stop));
			})
			.catch((e) => {
				console.error(e);
				error = String(e?.message ?? e);
				status = 'failed';
			});
		return () => stops.forEach((s) => s());
	});

	// SvelteKit spots a new deploy (it checks the version when the tab comes back, every
	// hour, and when a chunk fails to load) and reloads on the next navigation anyway. Say
	// so, and let the person pick the moment rather than lose a half-filled sheet to it.
	// untrack: pushing the toast reads the toast list, which must not re-run this effect.
	$effect(() => {
		if (updated.current) untrack(() => toast('A new version is ready.', { label: 'Reload', run: () => location.reload() }, Infinity));
	});

	const SYNC_LABEL: Record<string, string> = {
		local: 'On this device only. Sign in to sync',
		pending: 'Waiting for an invite',
		offline: 'Offline, changes will upload later',
		syncing: 'Syncing',
		synced: 'Synced',
		error: 'Sync problem, retrying'
	};

	const tabs = [
		{ href: '/', label: 'Put List' },
		{ href: '/tried', label: 'Tried' },
		{ href: '/recommenders', label: 'People' }
	];
	// Plain pages that don't need the on-device database, so they show even where it can't
	// open (a private window) or while it's opening; Google's reviewers link to them.
	const INFO_PAGES = ['/about', '/privacy', '/terms'];
	const infoPage = $derived(INFO_PAGES.includes(page.url.pathname));

	const isActive = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));

	function onkeydown(e: KeyboardEvent) {
		// "n" anywhere (outside a text field) opens Quick Add.
		const t = e.target as HTMLElement;
		if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !t.closest('input, textarea, select, [contenteditable]')) {
			e.preventDefault();
			ui.quickAddOpen = true;
		}
	}
</script>

<svelte:window {onkeydown} />

<header>
	<div class="bar">
		<a class="brand" href="/" aria-label="Recommendship">
			<img class="brand-icon" src="/icon.svg" alt="" width="26" height="26" /><span class="brand-text" aria-hidden="true">Recommend<span>ship</span></span>
		</a>
		<nav aria-label="Main">
			{#each tabs as t (t.href)}
				<a href={t.href} class:active={isActive(t.href)} aria-current={isActive(t.href) ? 'page' : undefined}>{t.label}</a>
			{/each}
			{#if !infoPage && status === 'ready' && !ui.selecting}
				<!-- Desktop only (see .add below): on a tall window the corner button sits far below the list. -->
				<button class="add" onclick={() => (ui.quickAddOpen = true)} aria-label="Add a recommendation" title="Add (n)">＋ Add</button>
			{/if}
			<button class="help" aria-label="What is Recommendship?" title="What is this?" aria-expanded={ui.aboutOpen} onclick={() => (ui.aboutOpen = true)}
				>?</button
			>
			<a
				href="/account"
				class="sync"
				class:active={isActive('/account')}
				title={SYNC_LABEL[account.sync] + (account.queued ? ` · ${account.queued} to upload` : '')}
				aria-label="Account and sync: {SYNC_LABEL[account.sync]}"
			>
				<span class="dot {account.sync}"></span><span class="sync-label" aria-hidden="true">Sync</span>
			</a>
		</nav>
	</div>
</header>

{#if infoPage}
	{@render children()}
{:else if status === 'ready'}
	{@render children()}
	{#if !ui.selecting}
		<button class="fab" onclick={() => (ui.quickAddOpen = true)} aria-label="Add a recommendation" title="Add (n)">＋</button>
	{/if}
	<QuickAdd />
	<RateSheet />
{:else if status === 'failed'}
	<main class="page empty">
		<h2>Couldn't open the on-device database</h2>
		<p>{error}</p>
		<p class="small">Recommendship stores everything in your browser (OPFS). Private windows and some older browsers block it.</p>
	</main>
{:else}
	<main class="page empty" aria-busy="true">
		{#if slow}
			<h2>Still opening…</h2>
			<p>Recommendship may be open somewhere else (another tab or window), which keeps this one waiting.</p>
			<p class="small">Close it there and reload. On a phone's home-screen app, swipe the app away and open it again.</p>
			<button class="btn primary" onclick={() => location.reload()}>Reload</button>
		{:else}
			Opening…
		{/if}
	</main>
{/if}

<Sheet open={ui.aboutOpen} onclose={() => (ui.aboutOpen = false)} label="About Recommendship">
	<AboutContent onclose={() => (ui.aboutOpen = false)} />
</Sheet>

<Toasts />

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 30;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--line);
		padding-top: env(safe-area-inset-top, 0px);
	}

	.bar {
		max-width: 680px;
		margin: 0 auto;
		padding: 0.6rem max(16px, env(safe-area-inset-right, 0px)) 0.6rem max(16px, env(safe-area-inset-left, 0px));
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.brand {
		font-weight: 800;
		font-size: 1.15rem;
		letter-spacing: -0.02em;
		text-decoration: none;
	}

	.brand-text span {
		color: var(--accent);
	}

	.brand-icon {
		display: none;
		border-radius: 7px;
	}

	nav {
		display: flex;
		gap: 0.25rem;
	}

	nav a {
		white-space: nowrap;
		text-decoration: none;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		font-weight: 600;
		font-size: 0.92rem;
		color: var(--muted);
	}

	nav a.active {
		background: var(--surface-2);
		color: var(--text);
	}

	.help {
		width: 1.6rem;
		height: 1.6rem;
		align-self: center;
		border-radius: 50%;
		border: 1.5px solid var(--muted);
		background: none;
		color: var(--muted);
		font-weight: 700;
		font-size: 0.85rem;
		line-height: 1;
		padding: 0;
		margin-left: 0.2rem;
	}

	.help:hover,
	.help[aria-expanded='true'] {
		border-color: var(--text);
		color: var(--text);
	}

	/* The dot alone didn't read as "account": a muted grey ring before it turns green. The
	   label says what it is; the dot still carries the state. */
	nav a.sync {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: 0.2rem;
	}

	.dot {
		flex-shrink: 0;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 2px solid var(--muted);
	}

	.dot.synced {
		background: var(--good);
		border-color: var(--good);
	}

	.dot.syncing {
		background: var(--accent);
		border-color: var(--accent);
		animation: pulse 1s ease-in-out infinite alternate;
	}

	.dot.pending,
	.dot.offline {
		border-color: var(--gold);
	}

	.dot.error {
		background: var(--bad);
		border-color: var(--bad);
	}

	@keyframes pulse {
		to {
			opacity: 0.4;
		}
	}

	.fab {
		position: fixed;
		right: max(16px, calc(50% - 340px + 16px));
		bottom: calc(20px + var(--safe-bottom));
		width: 58px;
		height: 58px;
		border-radius: 50%;
		border: none;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 1.8rem;
		box-shadow: var(--shadow);
		z-index: 35;
	}

	.add {
		display: none;
		align-self: center;
		border: none;
		border-radius: 999px;
		padding: 0.35rem 0.8rem;
		margin-left: 0.3rem;
		background: var(--accent);
		color: var(--accent-ink);
		font-weight: 700;
		font-size: 0.92rem;
		white-space: nowrap;
	}

	/* Desktop (a mouse and room in the header): Add lives in the sticky header, next to the
	   content, instead of floating in the window's bottom corner. Touch screens keep the FAB. */
	@media (min-width: 720px) and (hover: hover) and (pointer: fine) {
		.add {
			display: inline-block;
		}

		.fab {
			display: none;
		}
	}

	/* Phones, Pro Max sizes (430–440 px) included: the full-size header, with the Sync label,
	   needs about 510 px. */
	@media (max-width: 520px) {
		.bar {
			gap: 0.5rem;
		}

		.brand {
			font-size: 1rem;
		}

		nav {
			gap: 0;
		}

		nav a {
			padding: 0.35rem 0.4rem;
			font-size: 0.88rem;
		}

		nav a.sync {
			gap: 0.25rem;
			margin-left: 0.1rem;
		}

		.help {
			width: 1.4rem;
			height: 1.4rem;
			margin-left: 0.1rem;
		}
	}

	/* Most phones below the Pro Max sizes (iPhone SE at 320 px up to 402 px): the icon stands
	   in for the name, so the Sync label fits. The compact header needs about 410 px. */
	@media (max-width: 412px) {
		.brand-text {
			display: none;
		}

		.brand-icon {
			display: block;
		}

		nav a {
			padding: 0.35rem 0.3rem;
			font-size: 0.84rem;
		}
	}
</style>
