<script lang="ts">
	import { page } from '$app/state';
	import { planBackupImport, readBackup, writeImport } from '#lib/actions.ts';
	import { parseBackup, toCsv } from '#lib/backup.ts';
	import { relativeDate } from '#lib/format.ts';
	import { account, devSignIn, redeemInvite, signInWithGoogle, signOut } from '#lib/sync.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';

	let email = $state('dev@recommendship.test');
	let password = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state('');

	// Sign-in failures come back here as ?error=… (see onAPIError in the server's auth config).
	const signInError = $derived.by(() => {
		const e = page.url.searchParams.get('error');
		if (!e) return '';
		if (/signups?_full/i.test(e)) return 'Sign-ups are full for today. Please try again tomorrow.';
		return `Sign-in didn't complete (${e.replace(/_/g, ' ').toLowerCase()}). Please try again.`;
	});

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	type Invite = {
		code: string;
		note: string | null;
		createdAt: string;
		usedBy: string | null;
		usedAt: string | null;
		usedByEmail: string | null;
	};

	async function deleteInvite(i: Invite) {
		const ask = i.usedAt
			? `Remove ${i.code} from the list? ${i.usedByEmail ?? 'The person who used it'} stays approved; to cut them off, use Suspend on the Admin page.`
			: `Revoke ${i.code}? It stops working straight away.`;
		if (!confirm(ask)) return;
		const res = await fetch(`/api/invites/${encodeURIComponent(i.code)}`, { method: 'DELETE' });
		if (!res.ok && res.status !== 404) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
		if (newCode === i.code) newCode = '';
		toast(i.usedAt ? `Removed ${i.code}` : `Revoked ${i.code}`);
		await loadInvites();
	}
	let invites = $state<Invite[]>([]);
	let newCode = $state('');
	let note = $state('');

	async function loadInvites() {
		const res = await fetch('/api/invites');
		if (res.ok) invites = await res.json();
	}
	$effect(() => {
		if (account.me?.admin) {
			void loadInvites();
		}
	});

	async function createInvite() {
		const res = await fetch('/api/invites', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ note: note.trim() || undefined })
		});
		if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
		newCode = (await res.json()).code;
		note = '';
		await loadInvites();
	}

	// ---- Your data: download a backup or spreadsheet, import a backup. ----

	let importing = $state(false);
	let dataError = $state('');
	let fileInput: HTMLInputElement | undefined = $state();

	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	function download(name: string, type: string, text: string) {
		const url = URL.createObjectURL(new Blob([text], { type }));
		Object.assign(document.createElement('a'), { href: url, download: name }).click();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}

	async function exportBackup(as: 'json' | 'csv') {
		dataError = '';
		const backup = await readBackup();
		const name = `recommendship-${new Date().toISOString().slice(0, 10)}`;
		if (as === 'json') download(`${name}.json`, 'application/json', JSON.stringify(backup, null, '\t'));
		else download(`${name}.csv`, 'text/csv;charset=utf-8', toCsv(backup));
	}

	/** Your own limits when signed in (an admin may have changed them), else the defaults. */
	function importLimits() {
		const mine = account.me?.limits;
		if (!mine) return account.config.limits;
		return mine.rows == null ? { rows: Infinity, categories: Infinity } : { rows: mine.rows, categories: account.config.limits.categories };
	}

	async function importBackup(file: File) {
		dataError = '';
		importing = true;
		try {
			const plan = await planBackupImport(parseBackup(await file.text()), importLimits());
			if (plan.overLimit) throw new Error(`Nothing was imported. ${plan.overLimit}`);
			const { item, recommender, recommendation, category } = plan.rows;
			if (!item.length && !recommender.length && !recommendation.length && !category.length) {
				toast('Nothing new in that backup: you already have all of it');
				return;
			}
			const adds = [
				item.length && plural(item.length, 'item'),
				recommender.length && plural(recommender.length, 'person', 'people'),
				recommendation.length && plural(recommendation.length, 'recommendation'),
				category.length && plural(category.length, 'type')
			].filter(Boolean);
			const kept = plan.alreadyHere.items ? ` ${plural(plan.alreadyHere.items, 'item')} you already have stay as they are.` : '';
			if (!confirm(`Import ${adds.join(', ')}?${kept}`)) return;
			await writeImport(plan.rows);
			toast(`Imported ${adds.join(', ')}`);
		} catch (e) {
			dataError = e instanceof Error ? e.message : String(e);
		} finally {
			importing = false;
			if (fileInput) fileInput.value = '';
		}
	}

	let signingOut = $state(false);

	async function confirmSignOut() {
		if (!confirm('Sign out? Your data stays in your account; this device’s copy is removed.')) return;
		signingOut = true;
		try {
			// Uploads anything still queued first, and refuses if that doesn't finish.
			const result = await signOut();
			if (result.signedOut) return;
			const why = navigator.onLine ? "couldn't be uploaded just now" : "can't be uploaded while you're offline";
			const discard = confirm(
				`Some changes on this device ${why} (${result.pending} pending updates). Signing out now deletes them for good.\n\n` +
					'Cancel to stay signed in (they’ll upload when the connection is back), or OK to sign out anyway.'
			);
			if (discard) await signOut({ discardUnsynced: true });
		} finally {
			signingOut = false;
		}
	}

	const STATUS: Record<string, string> = {
		local: 'Only on this device',
		pending: 'Waiting for an invite',
		offline: 'Offline, changes will upload later',
		syncing: 'Syncing…',
		synced: 'Synced',
		error: 'Sync problem, retrying'
	};
</script>

{#snippet yourData()}
	<h2 class="section-title">Your data</h2>
	<div class="card panel">
		<p class="small muted">
			Download everything you've logged. The backup file can be imported here or into another account; the spreadsheet is for reading.
		</p>
		<div class="row wrap">
			<button class="btn" onclick={() => exportBackup('json').catch((e) => (dataError = String(e)))}>Download backup</button>
			<button class="btn" onclick={() => exportBackup('csv').catch((e) => (dataError = String(e)))}>Download spreadsheet</button>
		</div>
		<div class="row wrap">
			<button class="btn" disabled={importing} onclick={() => fileInput?.click()}>{importing ? 'Importing…' : 'Import a backup'}</button>
			<input
				bind:this={fileInput}
				type="file"
				accept=".json,application/json"
				aria-label="Backup file to import"
				hidden
				onchange={(e) => {
					const file = e.currentTarget.files?.[0];
					if (file) void importBackup(file);
				}}
			/>
		</div>
		<p class="small muted">Importing adds what you don't have yet: people match by name and items by title and type.</p>
		{#if dataError}<p class="error small">{dataError}</p>{/if}
	</div>
{/snippet}

<main class="page">
	<h1 class="section-title">Account</h1>

	{#if account.me === undefined}
		<p class="muted">Checking…</p>
	{:else if account.me === null}
		<div class="card panel">
			<h2>Sync across your devices</h2>
			<p class="muted">
				Right now everything lives on this device only. Sign in to back it up and see it on your phone and laptop. What you've already
				added comes with you.
			</p>
			{#if account.config.google}
				<button class="btn primary" disabled={busy} onclick={() => run(signInWithGoogle)}>Continue with Google</button>
			{/if}
			{#if account.config.devLogin}
				<form
					class="dev"
					onsubmit={(e) => {
						e.preventDefault();
						void run(() => devSignIn(email, password));
					}}
				>
					<p class="small muted">Development sign-in (off in production)</p>
					<input class="field" type="email" bind:value={email} autocomplete="username" aria-label="Email" />
					<input class="field" type="password" bind:value={password} autocomplete="current-password" placeholder="Password (8+ characters)" aria-label="Password" />
					<button class="btn" disabled={busy}>Sign in or create account</button>
				</form>
			{/if}
			{#if !account.config.google && !account.config.devLogin}
				<p class="small muted">Sign-in isn't available right now. Check your connection.</p>
			{/if}
		</div>
		{@render yourData()}
	{:else}
		<div class="card panel">
			<div class="who">
				<div>
					<b>{account.me.user.name || account.me.user.email}</b>
					<div class="muted small">{account.me.user.email}{account.me.admin ? ' · admin' : ''}</div>
				</div>
				<button class="btn ghost muted small" onclick={confirmSignOut} disabled={signingOut}>
					{signingOut ? 'Uploading…' : 'Sign out'}
				</button>
			</div>
			<div class="status">
				<span class="dot {account.sync}"></span>
				<span>{STATUS[account.sync]}</span>
				{#if account.queued}<span class="muted small">· {account.queued} to upload</span>{/if}
				{#if account.lastSyncedAt && account.sync === 'synced'}<span class="muted small">· {relativeDate(account.lastSyncedAt.toISOString())}</span>{/if}
			</div>
			{#if account.sync === 'syncing' && account.syncNote}
				<p class="small muted">{account.syncNote}</p>
			{/if}
			{#if account.sync === 'error' && account.syncError}
				<p class="small muted sync-error">{account.syncError}</p>
			{/if}
		</div>

		{#if account.me.suspended}
			<div class="card panel">
				<h2>This account is suspended</h2>
				<p class="muted">Syncing is turned off for this account. What's on this device stays here. If you think this is a mistake, ask whoever invited you.</p>
			</div>
		{:else if !account.me.approved}
			<div class="card panel">
				<h2>Your account is waiting to be let in</h2>
				<p class="muted">
					Recommendship is letting people in a few at a time. You can keep using the app meanwhile: everything stays on this device and
					uploads once you're in. Have an invite code?
				</p>
				<form
					class="row"
					onsubmit={(e) => {
						e.preventDefault();
						void run(async () => {
							await redeemInvite(code);
							toast("You're in. Syncing now.");
						});
					}}
				>
					<input class="field code" bind:value={code} placeholder="ABCDE-FGHJK" aria-label="Invite code" autocomplete="off" />
					<button class="btn primary" disabled={busy || !code.trim()}>Join</button>
				</form>
			</div>
		{/if}

		{@render yourData()}

		{#if account.me.admin}
			<h2 class="section-title">Invites</h2>
			<div class="card panel">
				<form
					class="row"
					onsubmit={(e) => {
						e.preventDefault();
						void run(createInvite);
					}}
				>
					<input class="field" bind:value={note} placeholder="Who's it for? (optional)" aria-label="Invite note" />
					<button class="btn primary" disabled={busy}>New code</button>
				</form>
				{#if newCode}
					<p class="new-code">
						<b class="num">{newCode}</b>
						<button class="btn ghost small" onclick={() => navigator.clipboard?.writeText(newCode).then(() => toast('Copied'))}>Copy</button>
					</p>
				{/if}
				{#if invites.length}
					<table class="data">
						<thead><tr><th>Code</th><th>For</th><th>Status</th><th></th></tr></thead>
						<tbody>
							{#each invites as i (i.code)}
								<tr>
									<td class="num">{i.code}</td>
									<td>{i.note ?? ''}</td>
									<td class="muted">
										{#if i.usedAt}used {relativeDate(i.usedAt)}{#if i.usedByEmail}<br /><span class="small">by {i.usedByEmail}</span>{/if}{:else}unused{/if}
									</td>
									<td class="r">
										<button class="btn ghost small danger" onclick={() => run(() => deleteInvite(i))}>
											{i.usedAt ? 'Remove' : 'Revoke'}
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>

			<h2 class="section-title">Users</h2>
			<a class="card panel admin-link" href="/admin">
				<span><b>Users and monitoring</b><br /><span class="muted small">Sign-ups, usage, approving, suspending and per-person limits</span></span>
				<span aria-hidden="true">›</span>
			</a>
		{/if}
	{/if}

	{#if signInError && !account.me}<p class="error">{signInError}</p>{/if}
	{#if error}<p class="error">{error}</p>{/if}

	<!-- TMDB's terms ask for this notice wherever its data is used. -->
	<footer class="credits small muted">
		Movie and TV details and posters from <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>. This product uses the
		TMDB API but is not endorsed or certified by TMDB. Book details and covers from
		<a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a>.
	</footer>
</main>

<style>
	.panel {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-bottom: 0.8rem;
	}

	h2 {
		font-size: 1.1rem;
	}

	p {
		margin: 0;
	}

	.dev {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-top: 1px dashed var(--line);
		padding-top: 0.8rem;
	}

	.who {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.row {
		display: flex;
		gap: 0.5rem;
	}

	.row.wrap {
		flex-wrap: wrap;
	}

	.code {
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.new-code {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.2rem;
	}

	.error {
		color: var(--bad);
	}

	.credits {
		margin-top: 2rem;
		line-height: 1.5;
	}

	.credits a {
		color: inherit;
	}

	.admin-link {
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		color: inherit;
		text-decoration: none;
	}









	.danger:hover {
		color: var(--bad);
	}

	.sync-error {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		word-break: break-word;
	}

	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--muted);
	}

	.dot.synced {
		background: var(--good);
	}

	.dot.syncing {
		background: var(--accent);
	}

	.dot.pending,
	.dot.offline {
		background: var(--gold);
	}

	.dot.error {
		background: var(--bad);
	}
</style>
