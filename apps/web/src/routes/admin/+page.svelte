<script lang="ts">
	// Admins only: keep an eye on sign-ups and usage, let people in, cut them off, and
	// give someone their own limits. Everything here is server data, so it needs a connection.
	import { relativeDate } from '#lib/format.ts';
	import { account } from '#lib/sync.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';

	type Limit = number | null;
	type AdminUser = {
		id: string;
		email: string | null;
		name: string | null;
		createdAt: string;
		approvedAt: string | null;
		suspendedAt: string | null;
		items: number;
		people: number;
		recommendations: number;
		changesToday: number;
		/** Their effective limits; null = none. */
		rowLimit: Limit;
		changeLimit: Limit;
		customLimits: boolean;
		nearLimit: boolean;
		admin: boolean;
	};
	type Stats = {
		total: number;
		today: number;
		last7Days: number;
		waiting: number;
		suspended: number;
		nearLimit: number;
		customLimits: number;
		items: number;
		people: number;
		recommendations: number;
		changesToday: number;
		defaults: { rows: number; changesPerDay: number; newAccountsPerDay: number };
	};

	const FILTERS = [
		{ key: 'all', label: 'Everyone' },
		{ key: 'waiting', label: 'Waiting' },
		{ key: 'near', label: 'Near a limit' },
		{ key: 'custom', label: 'Own limits' },
		{ key: 'suspended', label: 'Suspended' }
	] as const;
	type Filter = (typeof FILTERS)[number]['key'];

	let stats = $state<Stats | null>(null);
	let users = $state<AdminUser[]>([]);
	let total = $state(0);
	let filter = $state<Filter>('all');
	let sort = $state<'newest' | 'rows' | 'changes'>('newest');
	let q = $state('');
	let loading = $state(false);
	let error = $state('');
	let editing = $state<string | null>(null);
	let draft = $state({ mode: 'default' as 'default' | 'custom' | 'unlimited', rows: '', changesPerDay: '' });

	const fmt = (n: number) => n.toLocaleString();
	const fmtLimit = (n: Limit) => (n == null ? 'no limit' : fmt(n));

	async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await fetch(path, init);
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
		return body as T;
	}

	async function loadStats() {
		stats = await getJson<Stats>('/api/admin/stats');
	}

	/** First page for the current search, filter and sort; `more` appends the next page. */
	async function loadUsers(more = false) {
		loading = true;
		error = '';
		try {
			const params = new URLSearchParams({ filter, sort, q: q.trim(), offset: String(more ? users.length : 0) });
			const page = await getJson<{ users: AdminUser[]; total: number }>(`/api/admin/users?${params}`);
			users = more ? [...users, ...page.users] : page.users;
			total = page.total;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	const refresh = () => Promise.all([loadStats(), loadUsers()]).catch((e) => (error = String(e)));

	$effect(() => {
		if (account.me?.admin) void loadStats().catch((e) => (error = String(e)));
	});

	// Reload when the filter or sort changes, and shortly after typing stops.
	$effect(() => {
		if (!account.me?.admin) return;
		void filter;
		void sort;
		void q;
		const timer = setTimeout(() => void loadUsers(), 250);
		return () => clearTimeout(timer);
	});

	async function act(path: string, body: unknown, done: string, method = 'POST') {
		try {
			await getJson(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			toast(done);
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	const who = (u: AdminUser) => u.email ?? u.name ?? 'this user';

	function suspend(u: AdminUser) {
		if (!confirm(`Suspend ${who(u)}? They can't sync or upload until you unsuspend them. Their data is kept.`)) return;
		const deleteData =
			(u.items > 0 || u.people > 0) &&
			confirm(`Also delete everything ${who(u)} has stored (${u.items} items, ${u.people} people)? This can't be undone. Cancel keeps it.`);
		void act(`/api/admin/users/${u.id}/suspend`, { deleteData }, deleteData ? `Suspended ${who(u)} and deleted their data` : `Suspended ${who(u)}`);
	}

	function editLimits(u: AdminUser) {
		editing = editing === u.id ? null : u.id;
		draft = {
			mode: !u.customLimits ? 'default' : u.rowLimit == null && u.changeLimit == null ? 'unlimited' : 'custom',
			rows: u.customLimits && u.rowLimit != null ? String(u.rowLimit) : '',
			changesPerDay: u.customLimits && u.changeLimit != null ? String(u.changeLimit) : ''
		};
	}

	function saveLimits(u: AdminUser) {
		const n = (s: string) => (s.trim() ? Math.max(0, Math.round(Number(s.replace(/[,\s]/g, '')))) : null);
		const body =
			draft.mode === 'unlimited'
				? { unlimited: true, rows: null, changesPerDay: null }
				: draft.mode === 'custom'
					? { unlimited: false, rows: n(draft.rows), changesPerDay: n(draft.changesPerDay) }
					: { unlimited: false, rows: null, changesPerDay: null };
		if ([body.rows, body.changesPerDay].some((x) => x != null && !Number.isFinite(x))) {
			error = 'Limits are whole numbers';
			return;
		}
		editing = null;
		const done = draft.mode === 'unlimited' ? `${who(u)} has no limits` : draft.mode === 'custom' ? `Saved ${who(u)}'s limits` : `${who(u)} is back on the defaults`;
		void act(`/api/admin/users/${u.id}/limits`, body, done, 'PUT');
	}

	const status = (u: AdminUser) => (u.suspendedAt ? 'suspended' : u.admin ? 'admin' : u.approvedAt ? 'approved' : 'waiting');
	const pct = (used: number, limit: Limit) => (limit ? Math.round((used / limit) * 100) : 0);
	const fullest = (u: AdminUser) => Math.max(u.items, u.people, u.recommendations);
</script>

<main class="page">
	<h1 class="section-title">Admin</h1>

	{#if account.me === undefined}
		<p class="muted">Checking…</p>
	{:else if !account.me?.admin}
		<p class="muted">This page is for admins.</p>
	{:else}
		{#if stats}
			<div class="tiles">
				<div class="tile card">
					<span class="muted small">Accounts</span>
					<b class="num">{fmt(stats.total)}</b>
					<span class="muted small">+{fmt(stats.today)} today · +{fmt(stats.last7Days)} this week</span>
				</div>
				<button class="tile card" class:alert={stats.waiting > 0} onclick={() => (filter = 'waiting')}>
					<span class="muted small">Waiting</span>
					<b class="num">{fmt(stats.waiting)}</b>
					<span class="muted small">to approve</span>
				</button>
				<button class="tile card" class:alert={stats.nearLimit > 0} onclick={() => (filter = 'near')}>
					<span class="muted small">Near a limit</span>
					<b class="num">{fmt(stats.nearLimit)}</b>
					<span class="muted small">80% or more</span>
				</button>
				<button class="tile card" onclick={() => (filter = 'suspended')}>
					<span class="muted small">Suspended</span>
					<b class="num">{fmt(stats.suspended)}</b>
					<span class="muted small">{fmt(stats.customLimits)} with own limits</span>
				</button>
				<div class="tile card wide">
					<span class="muted small">Stored</span>
					<b class="num">{fmt(stats.items + stats.people + stats.recommendations)}</b>
					<span class="muted small">{fmt(stats.items)} items · {fmt(stats.people)} people · {fmt(stats.recommendations)} recommendations</span>
				</div>
				<div class="tile card wide">
					<span class="muted small">Changes today</span>
					<b class="num">{fmt(stats.changesToday)}</b>
					<span class="muted small">
						New accounts today: {fmt(stats.today)} of {fmt(stats.defaults.newAccountsPerDay)}
					</span>
				</div>
			</div>
			<p class="small muted defaults">
				Defaults: {fmt(stats.defaults.rows)} each of items, people and recommendations · {fmt(stats.defaults.changesPerDay)} changes a day.
			</p>
		{/if}

		<div class="controls">
			<input class="field" type="search" bind:value={q} placeholder="Search email or name" aria-label="Search users" />
			<select class="field" bind:value={sort} aria-label="Sort users">
				<option value="newest">Newest</option>
				<option value="rows">Most stored</option>
				<option value="changes">Busiest today</option>
			</select>
		</div>
		<div class="filters" role="group" aria-label="Show">
			{#each FILTERS as f (f.key)}
				<button class="chip" aria-pressed={filter === f.key} onclick={() => (filter = f.key)}>{f.label}</button>
			{/each}
		</div>

		{#if error}<p class="error small">{error}</p>{/if}

		<p class="small muted">{loading && !users.length ? 'Loading…' : `${fmt(total)} ${total === 1 ? 'account' : 'accounts'}`}</p>
		<div class="card users">
			{#each users as u (u.id)}
				<div class="user">
					<div class="top">
						<div class="who-col">
							<b>{u.name || u.email}</b>
							<span class="muted small">{u.email}</span>
							<span class="small badges">
								<span class="badge {status(u)}">{status(u) === 'waiting' ? 'waiting for invite' : status(u)}</span>
								{#if u.nearLimit}<span class="badge near">near a limit</span>{/if}
								{#if u.customLimits}<span class="badge own">{u.rowLimit == null && u.changeLimit == null ? 'no limits' : 'own limits'}</span>{/if}
							</span>
						</div>
						{#if !u.admin}
							<div class="user-actions">
								{#if u.suspendedAt}
									<button class="btn small" onclick={() => act(`/api/admin/users/${u.id}/unsuspend`, {}, `${who(u)} can sync again`)}>Unsuspend</button>
								{:else}
									{#if !u.approvedAt}
										<button class="btn small" onclick={() => act(`/api/admin/users/${u.id}/approve`, {}, `${who(u)} is in: their app starts syncing`)}>Approve</button>
									{/if}
									<button class="btn ghost small" aria-expanded={editing === u.id} onclick={() => editLimits(u)}>Limits</button>
									<button class="btn ghost small danger" onclick={() => suspend(u)}>Suspend</button>
								{/if}
							</div>
						{/if}
					</div>
					<span class="small muted">
						{fmt(u.items)} items · {fmt(u.people)} people · {fmt(u.recommendations)} recs
						{#if u.rowLimit != null}<span class:hot={pct(fullest(u), u.rowLimit) >= 80}>({pct(fullest(u), u.rowLimit)}% of {fmt(u.rowLimit)})</span>{/if}
						· {fmt(u.changesToday)} changes today
						{#if u.changeLimit != null}<span class:hot={pct(u.changesToday, u.changeLimit) >= 80}>({pct(u.changesToday, u.changeLimit)}%)</span>{/if}
						· joined {relativeDate(u.createdAt)}
					</span>

					{#if editing === u.id}
						<form
							class="limits"
							onsubmit={(e) => {
								e.preventDefault();
								saveLimits(u);
							}}
						>
							<div class="filters" role="radiogroup" aria-label="Limits for {who(u)}">
								<label class="chip" class:active={draft.mode === 'default'}><input type="radio" bind:group={draft.mode} value="default" />Defaults</label>
								<label class="chip" class:active={draft.mode === 'custom'}><input type="radio" bind:group={draft.mode} value="custom" />Own limits</label>
								<label class="chip" class:active={draft.mode === 'unlimited'}><input type="radio" bind:group={draft.mode} value="unlimited" />No limits</label>
							</div>
							{#if draft.mode === 'custom'}
								<div class="limit-fields">
									<label class="small">
										Items, people, recs (each)
										<input class="field" inputmode="numeric" bind:value={draft.rows} placeholder={stats ? fmt(stats.defaults.rows) : 'default'} />
									</label>
									<label class="small">
										Changes a day
										<input class="field" inputmode="numeric" bind:value={draft.changesPerDay} placeholder={stats ? fmt(stats.defaults.changesPerDay) : 'default'} />
									</label>
								</div>
								<p class="small muted">Leave one empty to keep its default.</p>
							{:else if draft.mode === 'unlimited'}
								<p class="small muted">No row limit and no daily budget. The per-minute flood guard still applies.</p>
							{/if}
							<div class="row">
								<button class="btn primary small">Save</button>
								<button type="button" class="btn ghost small" onclick={() => (editing = null)}>Cancel</button>
							</div>
						</form>
					{/if}
				</div>
			{:else}
				{#if !loading}<p class="muted small empty">No accounts match.</p>{/if}
			{/each}
		</div>
		{#if users.length < total}
			<button class="btn more" disabled={loading} onclick={() => loadUsers(true)}>{loading ? 'Loading…' : `Show more (${fmt(total - users.length)} left)`}</button>
		{/if}
	{/if}
</main>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}

	@media (max-width: 560px) {
		.tiles {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.tile {
		padding: 0.7rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		text-align: left;
		font: inherit;
		color: inherit;
		min-width: 0;
	}

	button.tile {
		cursor: pointer;
	}

	.tile.wide {
		grid-column: span 2;
	}

	.tile b {
		font-size: 1.4rem;
	}

	.tile.alert b {
		color: var(--gold);
	}

	.defaults {
		margin: 0.5rem 0 1rem;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.controls input {
		flex: 1;
		min-width: 0;
	}

	.controls select {
		flex: 0 0 auto;
		width: auto;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.6rem;
	}

	.filters input[type='radio'] {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.users {
		padding: 0.2rem 1rem;
		margin: 0.4rem 0 0.8rem;
	}

	.user {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.7rem 0;
		border-bottom: 1px solid var(--line);
	}

	.user:last-child {
		border-bottom: none;
	}

	.top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.6rem;
	}

	.user-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.who-col {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.badge {
		display: inline-block;
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-weight: 600;
	}

	.badge.suspended {
		background: var(--bad);
		color: var(--bg);
	}

	.badge.waiting,
	.badge.near {
		background: var(--gold);
		color: var(--bg);
	}

	.badge.own {
		background: var(--accent-soft);
	}

	.hot {
		color: var(--bad);
		font-weight: 600;
	}

	.limits {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem 0 0.2rem;
	}

	.limits .filters {
		margin: 0;
	}

	.limit-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.limit-fields label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.row {
		display: flex;
		gap: 0.5rem;
	}

	.danger:hover {
		color: var(--bad);
	}

	.error {
		color: var(--bad);
	}

	.empty {
		padding: 0.7rem 0;
		margin: 0;
	}

	.more {
		width: 100%;
	}
</style>
