// The invite gate and admin rules, through the real HTTP routes. Better Auth is
// stubbed: the `x-test-user` header says who is signed in.

import { PGlite } from '@electric-sql/pglite';
import * as schema from '@recommendship/schema/pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { authOptions, openSeat, signupAllowed, type Auth } from '../src/auth';
import type { Db } from '../src/db';
import { LookupUnavailable, type Lookup } from '../src/lookup';
import { loadEnv } from '../src/env';

const env = loadEnv({
	NODE_ENV: 'test',
	DATABASE_URL: 'unused',
	BETTER_AUTH_SECRET: 'x'.repeat(32),
	BETTER_AUTH_URL: 'http://localhost:5173',
	POWERSYNC_URL: 'http://localhost:8080',
	ADMIN_EMAILS: 'admin@example.com'
});

const users: Record<string, { id: string; email: string; name: string }> = {
	admin: { id: 'admin', email: 'admin@example.com', name: 'Admin' },
	alice: { id: 'alice', email: 'alice@example.com', name: 'Alice' },
	bob: { id: 'bob', email: 'bob@example.com', name: 'Bob' }
};

const auth = {
	handler: () => new Response('auth'),
	api: {
		getSession: async ({ headers }: { headers: Headers }) => {
			const user = users[headers.get('x-test-user') ?? ''];
			return user ? { user, session: {} } : null;
		},
		getToken: async () => ({ token: 'jwt' })
	}
} as unknown as Auth;

let app: ReturnType<typeof createApp>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
	db = drizzle(new PGlite(), { schema });
	await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
	const now = new Date().toISOString();
	await db.insert(schema.appUser).values([
		{ id: 'admin', email: users.admin!.email, createdAt: now, approvedAt: now },
		{ id: 'alice', email: users.alice!.email, createdAt: now },
		{ id: 'bob', email: users.bob!.email, createdAt: now }
	]);
	app = createApp({ env, db: db as unknown as Db, auth });
});

const call = (as: string | null, method: string, path: string, body?: unknown) =>
	app.request(path, {
		method,
		headers: { ...(as ? { 'x-test-user': as } : {}), 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});

const putItem = {
	op: 'PUT',
	table: 'item',
	id: 'i1',
	data: { category_id: 'cat-book', title: 'Piranesi', status: 'TO_TRY', added_at: '2026-11-01T10:00:00.000Z' }
};

describe('invite gate', () => {
	it('refuses everything under /api without a session', async () => {
		expect((await call(null, 'GET', '/api/me')).status).toBe(401);
		expect((await call(null, 'POST', '/api/write', { ops: [] })).status).toBe(401);
	});

	it("keeps unapproved accounts from syncing or writing (their queue waits on the device)", async () => {
		expect(await (await call('alice', 'GET', '/api/me')).json()).toMatchObject({ approved: false, admin: false });
		expect((await call('alice', 'GET', '/api/sync/credentials')).status).toBe(403);
		expect((await call('alice', 'POST', '/api/write', { ops: [putItem] })).status).toBe(403);
	});

	it('lets only admins create and list invites', async () => {
		expect((await call('alice', 'POST', '/api/invites', {})).status).toBe(403);
		expect((await call('alice', 'GET', '/api/invites')).status).toBe(403);
		const res = await call('admin', 'POST', '/api/invites', { note: 'for Alice' });
		expect((await res.json()).code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
		expect(await (await call('admin', 'GET', '/api/invites')).json()).toHaveLength(1);
	});

	it('approves on a valid code, once', async () => {
		const { code } = await (await call('admin', 'POST', '/api/invites', {})).json();

		expect((await call('alice', 'POST', '/api/invites/redeem', { code: 'WRONG-CODE1' })).status).toBe(400);
		const ok = await call('alice', 'POST', '/api/invites/redeem', { code: code.toLowerCase() });
		expect(await ok.json()).toEqual({ approved: true });

		expect(await (await call('alice', 'GET', '/api/sync/credentials')).json()).toEqual({ endpoint: 'http://localhost:8080', token: 'jwt' });
		expect(await (await call('alice', 'POST', '/api/write', { ops: [putItem] })).json()).toEqual({ applied: 1, rejected: [] });

		// The same code doesn't work twice.
		expect((await call('bob', 'POST', '/api/invites/redeem', { code })).status).toBe(400);
		expect(await (await call('bob', 'GET', '/api/me')).json()).toMatchObject({ approved: false });
	});

	it('rejects malformed and oversized batches', async () => {
		expect((await call('admin', 'POST', '/api/write', { ops: 'nope' })).status).toBe(400);
		const ops = Array.from({ length: 501 }, () => putItem);
		expect((await call('admin', 'POST', '/api/write', { ops })).status).toBe(400);
	});
});

const ops = (n: number, from = 0) =>
	Array.from({ length: n }, (_, k) => ({ ...putItem, id: `i${from + k}`, data: { ...putItem.data, title: `Book ${from + k}` } }));

describe('revoking invites', () => {
	it('revokes an unused code so it stops working', async () => {
		const { code } = await (await call('admin', 'POST', '/api/invites', {})).json();
		expect(await (await call('admin', 'DELETE', `/api/invites/${code}`)).json()).toEqual({ deleted: true, wasUsed: false });
		expect((await call('alice', 'POST', '/api/invites/redeem', { code })).status).toBe(400);
		expect((await call('admin', 'DELETE', `/api/invites/${code}`)).status).toBe(404);
	});

	it('removes a used code from the list without un-approving who used it', async () => {
		const { code } = await (await call('admin', 'POST', '/api/invites', { note: 'for Alice' })).json();
		await call('alice', 'POST', '/api/invites/redeem', { code });
		expect(await (await call('admin', 'GET', '/api/invites')).json()).toMatchObject([{ code, usedByEmail: 'alice@example.com' }]);
		expect(await (await call('admin', 'DELETE', `/api/invites/${code}`)).json()).toEqual({ deleted: true, wasUsed: true });
		expect(await (await call('alice', 'GET', '/api/me')).json()).toMatchObject({ approved: true });
		expect(await (await call('admin', 'GET', '/api/invites')).json()).toEqual([]);
	});

	it('is admin-only', async () => {
		const { code } = await (await call('admin', 'POST', '/api/invites', {})).json();
		expect((await call('alice', 'DELETE', `/api/invites/${code}`)).status).toBe(403);
	});
});

describe('write budget', () => {
	const limited = () => createApp({ env: { ...env, WRITE_OPS_PER_MINUTE: 5, WRITE_OPS_PER_DAY: 8 }, db: db as unknown as Db, auth });
	const write = (a: ReturnType<typeof createApp>, batch: unknown[]) =>
		a.request('/api/write', { method: 'POST', headers: { 'x-test-user': 'admin', 'content-type': 'application/json' }, body: JSON.stringify({ ops: batch }) });

	it('counts changes, not requests, per minute', async () => {
		const a = limited();
		expect((await write(a, ops(5))).status).toBe(200);
		const res = await write(a, ops(1, 5));
		expect(res.status).toBe(429);
		expect(res.headers.get('retry-after')).toBe('60');
	});

	it('caps changes per day, across restarts (kept in Postgres)', async () => {
		expect((await write(limited(), ops(5))).status).toBe(200);
		// A fresh app (as after a deploy) has a fresh minute window but the same daily count.
		const res = await write(limited(), ops(4, 5));
		expect(res.status).toBe(429);
		expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(await res.json()).toMatchObject({ error: expect.stringMatching(/changes today/) });
		const [usage] = await db.select().from(schema.writeUsage);
		expect(usage).toMatchObject({ userId: 'admin', ops: 9 });
	});
});

describe('suspension', () => {
	const approveAlice = async () => {
		const { code } = await (await call('admin', 'POST', '/api/invites', {})).json();
		await call('alice', 'POST', '/api/invites/redeem', { code });
		expect((await call('alice', 'POST', '/api/write', { ops: [putItem] })).status).toBe(200);
	};

	it('cuts off writes, sync and new invites, and keeps data unless asked', async () => {
		await approveAlice();
		const res = await call('admin', 'POST', '/api/admin/users/alice/suspend', { reason: 'spam' });
		expect(await res.json()).toEqual({ suspended: true, dataDeleted: false });

		expect(await (await call('alice', 'GET', '/api/me')).json()).toMatchObject({ approved: false, suspended: true });
		expect((await call('alice', 'POST', '/api/write', { ops: [putItem] })).status).toBe(403);
		expect((await call('alice', 'GET', '/api/sync/credentials')).status).toBe(403);
		// Sync streams only serve approved users, so clearing approval revokes sync too.
		const [profile] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, 'alice'));
		expect(profile?.approvedAt).toBeNull();
		// A fresh invite code doesn't get them back in.
		const { code } = await (await call('admin', 'POST', '/api/invites', {})).json();
		expect((await call('alice', 'POST', '/api/invites/redeem', { code })).status).toBe(403);
		expect(await db.select().from(schema.item)).toHaveLength(1);
	});

	it('can delete their data, and unsuspending restores access', async () => {
		await approveAlice();
		await call('admin', 'POST', '/api/admin/users/alice/suspend', { deleteData: true });
		expect(await db.select().from(schema.item)).toHaveLength(0);
		await call('admin', 'POST', '/api/admin/users/alice/unsuspend', {});
		expect(await (await call('alice', 'GET', '/api/me')).json()).toMatchObject({ approved: true, suspended: false });
		expect((await call('alice', 'POST', '/api/write', { ops: [putItem] })).status).toBe(200);
	});

	it('is admin-only, and admins cannot suspend themselves or other admins', async () => {
		expect((await call('alice', 'POST', '/api/admin/users/bob/suspend', {})).status).toBe(403);
		expect((await call('alice', 'GET', '/api/admin/users')).status).toBe(403);
		expect((await call('admin', 'POST', '/api/admin/users/admin/suspend', {})).status).toBe(400);
		expect((await call('admin', 'POST', '/api/admin/users/nobody/suspend', {})).status).toBe(404);
	});

	it('lists users with their usage for the admin page', async () => {
		await approveAlice();
		const { users, total } = await (await call('admin', 'GET', '/api/admin/users')).json();
		expect(total).toBe(3);
		expect(users.find((u: { id: string }) => u.id === 'alice')).toMatchObject({
			items: 1,
			people: 0,
			changesToday: 1,
			admin: false,
			suspendedAt: null,
			rowLimit: env.ROW_QUOTA,
			changeLimit: env.WRITE_OPS_PER_DAY,
			customLimits: false,
			nearLimit: false
		});
		expect(users.find((u: { id: string }) => u.id === 'admin')).toMatchObject({ admin: true });
	});
});

describe('approving without a code', () => {
	it('lets an admin approve someone who is waiting, so they can sync and write', async () => {
		expect((await call('alice', 'POST', '/api/write', { ops: [putItem] })).status).toBe(403);
		expect(await (await call('admin', 'POST', '/api/admin/users/alice/approve', {})).json()).toEqual({ approved: true });
		expect(await (await call('alice', 'GET', '/api/me')).json()).toMatchObject({ approved: true });
		expect((await call('alice', 'GET', '/api/sync/credentials')).status).toBe(200);
		expect((await call('alice', 'POST', '/api/write', { ops: [putItem] })).status).toBe(200);
		// Approving again is harmless.
		expect((await call('admin', 'POST', '/api/admin/users/alice/approve', {})).status).toBe(200);
	});

	it("is admin-only, and doesn't let a suspended account back in", async () => {
		expect((await call('alice', 'POST', '/api/admin/users/bob/approve', {})).status).toBe(403);
		expect((await call('admin', 'POST', '/api/admin/users/nobody/approve', {})).status).toBe(404);
		await call('admin', 'POST', '/api/admin/users/bob/suspend', {});
		expect((await call('admin', 'POST', '/api/admin/users/bob/approve', {})).status).toBe(400);
		expect(await (await call('bob', 'GET', '/api/me')).json()).toMatchObject({ approved: false, suspended: true });
	});
});

describe('monitoring', () => {
	const list = async (query = '') => (await call('admin', 'GET', `/api/admin/users${query}`)).json();
	const emails = (r: { users: { email: string }[] }) => r.users.map((u) => u.email);

	it('filters by status, searches, and sorts by what people store', async () => {
		await call('admin', 'POST', '/api/admin/users/alice/approve');
		await call('admin', 'POST', '/api/write', { ops: ops(3) });
		expect(emails(await list('?filter=waiting'))).toEqual(['bob@example.com']);
		expect(emails(await list('?q=ALI'))).toEqual(['alice@example.com']);
		expect(emails(await list('?q=%25'))).toEqual([]);
		expect(emails(await list('?sort=rows'))[0]).toBe('admin@example.com');
		// Unknown values fall back to everyone, newest first.
		expect((await list('?filter=nope&sort=nope')).total).toBe(3);
	});

	it('flags people close to a limit, by their own limits', async () => {
		// 4 of 5 items is 80%.
		await call('admin', 'PUT', '/api/admin/users/admin/limits', { unlimited: false, rows: 5, changesPerDay: null });
		await call('admin', 'POST', '/api/write', { ops: ops(4) });
		const near = await list('?filter=near');
		expect(emails(near)).toEqual(['admin@example.com']);
		expect(near.users[0]).toMatchObject({ items: 4, rowLimit: 5, customLimits: true, nearLimit: true });
	});

	it('pages through everyone', async () => {
		const now = new Date().toISOString();
		await db.insert(schema.appUser).values(Array.from({ length: 60 }, (_, k) => ({ id: `u${k}`, email: `u${k}@example.com`, createdAt: now })));
		const first = await list();
		expect(first).toMatchObject({ total: 63, pageSize: 50 });
		expect(first.users).toHaveLength(50);
		expect((await list('?offset=50')).users).toHaveLength(13);
	});

	it('totals accounts, waiting, rows and today\'s changes', async () => {
		await call('admin', 'POST', '/api/write', { ops: ops(2) });
		await call('admin', 'POST', '/api/admin/users/bob/suspend', {});
		const stats = await (await call('admin', 'GET', '/api/admin/stats')).json();
		expect(stats).toMatchObject({
			total: 3,
			today: 3,
			last7Days: 3,
			waiting: 1,
			suspended: 1,
			items: 2,
			changesToday: 2,
			nearLimit: 0,
			customLimits: 0,
			approved: 1,
			defaults: { rows: env.ROW_QUOTA, changesPerDay: env.WRITE_OPS_PER_DAY, newAccountsPerDay: env.MAX_NEW_USERS_PER_DAY, openSignupsUpTo: 0 }
		});
		expect((await call('alice', 'GET', '/api/admin/stats')).status).toBe(403);
	});
});

describe('per-user limits', () => {
	const setLimits = (id: string, body: unknown, as = 'admin') => call(as, 'PUT', `/api/admin/users/${id}/limits`, body);

	it('gives one person a smaller row limit, and shows it to them', async () => {
		await setLimits('admin', { unlimited: false, rows: 2, changesPerDay: null });
		const res = await (await call('admin', 'POST', '/api/write', { ops: ops(3) })).json();
		expect(res.applied).toBe(2);
		expect(res.rejected[0].reason).toBe('limit of 2 items reached');
		expect(await (await call('admin', 'GET', '/api/me')).json()).toMatchObject({ limits: { rows: 2, changesPerDay: env.WRITE_OPS_PER_DAY } });
	});

	it('lets an unlimited person past the row limit and the daily budget', async () => {
		const tight = createApp({ env: { ...env, ROW_QUOTA: 2, WRITE_OPS_PER_DAY: 2 }, db: db as unknown as Db, auth });
		const write = (n: number, from = 0) =>
			tight.request('/api/write', {
				method: 'POST',
				headers: { 'x-test-user': 'admin', 'content-type': 'application/json' },
				body: JSON.stringify({ ops: ops(n, from) })
			});
		await setLimits('admin', { unlimited: true, rows: null, changesPerDay: null });
		expect(await (await write(3)).json()).toEqual({ applied: 3, rejected: [] });
		expect((await write(3, 3)).status).toBe(200);

		// Back to the defaults: their limits row is removed, and the tight defaults apply again.
		await setLimits('admin', { unlimited: false, rows: null, changesPerDay: null });
		expect(await db.select().from(schema.userLimits)).toEqual([]);
		expect((await write(1, 6)).status).toBe(429);
	});

	it('is admin-only, and checks what it is given', async () => {
		expect((await setLimits('bob', { unlimited: true, rows: null, changesPerDay: null }, 'alice')).status).toBe(403);
		expect((await setLimits('nobody', { unlimited: true, rows: null, changesPerDay: null })).status).toBe(404);
		expect((await setLimits('bob', { unlimited: 'yes' })).status).toBe(400);
		expect((await setLimits('bob', { unlimited: false, rows: -1, changesPerDay: null })).status).toBe(400);
	});
});

describe('lookup endpoint', () => {
	const fake = {
		search: async (kind: string, q: string) => {
			if (kind === 'tv') throw new LookupUnavailable('movie and TV lookup is not set up');
			return [{ source: 'OPEN_LIBRARY', id: 'OL1W', title: q, year: 2020, creator: 'Susanna Clarke', imageUrl: null }];
		},
		details: async () => ({ creator: 'Denis Villeneuve' }),
		available: { movie: false, tv: false, book: true }
	} as unknown as Lookup;
	const withLookup = () => createApp({ env, db: db as unknown as Db, auth, lookup: fake });
	const get = (path: string, as: string | null = 'alice') => withLookup().request(path, { headers: as ? { 'x-test-user': as } : {} });

	it('looks up for any signed-in account, waiting ones included', async () => {
		expect((await get('/api/lookup?kind=book&q=Piranesi', null)).status).toBe(401);
		expect(await (await get('/api/lookup?kind=book&q=Piranesi')).json()).toEqual({
			results: [{ source: 'OPEN_LIBRARY', id: 'OL1W', title: 'Piranesi', year: 2020, creator: 'Susanna Clarke', imageUrl: null }]
		});
		expect(await (await get('/api/lookup/details?source=TMDB_MOVIE&id=693134')).json()).toEqual({ creator: 'Denis Villeneuve' });
	});

	it('checks the query, reports a provider that is not set up, and says which are', async () => {
		expect((await get('/api/lookup?kind=podcast&q=x')).status).toBe(400);
		expect((await get('/api/lookup?kind=book&q=x')).status).toBe(400);
		const res = await get('/api/lookup?kind=tv&q=Severance');
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: 'movie and TV lookup is not set up' });
		expect(await (await withLookup().request('/api/public/config')).json()).toMatchObject({ lookup: { movie: false, tv: false, book: true } });
	});

	it('limits each account to 60 lookups a minute', async () => {
		const a = withLookup();
		for (let k = 0; k < 60; k++) expect((await a.request(`/api/lookup?kind=book&q=book${k}`, { headers: { 'x-test-user': 'bob' } })).status).toBe(200);
		expect((await a.request('/api/lookup?kind=book&q=one more', { headers: { 'x-test-user': 'bob' } })).status).toBe(429);
	});
});

describe('daily sign-up cap', () => {
	it('allows MAX_NEW_USERS_PER_DAY new accounts a day, and admins always', async () => {
		// beforeEach created 3 accounts today.
		const cap = (n: number) => ({ ...env, MAX_NEW_USERS_PER_DAY: n });
		expect(await signupAllowed(db as unknown as Db, cap(4), 'new@example.com')).toBe(true);
		expect(await signupAllowed(db as unknown as Db, cap(3), 'new@example.com')).toBe(false);
		expect(await signupAllowed(db as unknown as Db, cap(3), 'admin@example.com')).toBe(true);
		// Yesterday's sign-ups don't count against today.
		await db.update(schema.appUser).set({ createdAt: '2026-01-01T00:00:00.000Z' });
		expect(await signupAllowed(db as unknown as Db, cap(3), 'new@example.com')).toBe(true);
	});
});

describe('open sign-up', () => {
	it('approves new accounts automatically until OPEN_SIGNUPS_UP_TO are approved', async () => {
		// beforeEach approved one account (the admin).
		const open = (n: number) => ({ ...env, OPEN_SIGNUPS_UP_TO: n });
		expect(await openSeat(db as unknown as Db, open(0))).toBe(false);
		expect(await openSeat(db as unknown as Db, open(2))).toBe(true);
		await db.update(schema.appUser).set({ approvedAt: new Date().toISOString() }).where(eq(schema.appUser.id, 'alice'));
		expect(await openSeat(db as unknown as Db, open(2))).toBe(false);
		// Suspending clears approval, which frees the seat.
		await call('admin', 'POST', '/api/admin/users/alice/suspend', {});
		expect(await openSeat(db as unknown as Db, open(2))).toBe(true);
	});
});

describe('canonical address', () => {
	const prod = createApp({
		env: { ...env, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://recommendship.app' },
		db: undefined as unknown as Db,
		auth
	});
	const get = (url: string) => prod.request(url, { headers: { host: new URL(url).host } });

	it('redirects pages on other hosts to the public domain, keeping the path', async () => {
		for (const from of ['https://recommendship-api.fly.dev/recommenders?x=1', 'https://www.recommendship.app/recommenders?x=1']) {
			const res = await get(from);
			expect(res.status).toBe(301);
			expect(res.headers.get('location')).toBe('https://recommendship.app/recommenders?x=1');
		}
	});

	it('leaves /api and the health check alone (PowerSync reads the JWKS from the fly.dev name)', async () => {
		expect((await get('https://recommendship-api.fly.dev/api/auth/jwks')).status).toBe(200);
		expect((await get('https://recommendship-api.fly.dev/healthz')).status).toBe(200);
	});

	it("doesn't redirect requests already on the public domain", async () => {
		expect((await get('https://recommendship.app/healthz')).status).toBe(200);
	});
});

describe('env', () => {
	it('refuses dev shortcuts in production', () => {
		expect(() => loadEnv({ ...process.env, NODE_ENV: 'production', DATABASE_URL: 'x', BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: 'https://a.b', POWERSYNC_URL: 'https://c.d', DEV_LOGIN: 'true' })).toThrow(/production/);
	});
});

describe('what sign-in keeps', () => {
	it("drops Google's profile picture link and ID token", async () => {
		const hooks = authOptions(env, {} as never, db as unknown as Db).databaseHooks;
		const now = new Date();
		const user = await hooks.user.create.before(
			{ id: 'carol', email: 'carol@example.com', name: 'Carol', image: 'https://lh3.googleusercontent.com/a/pic', emailVerified: true, createdAt: now, updatedAt: now }
		);
		expect(user).toMatchObject({ data: { email: 'carol@example.com', name: 'Carol', image: null } });

		const account = { id: 'a1', userId: 'carol', providerId: 'google', accountId: '123', accessToken: 'at', idToken: 'eyJ.profile.sig', createdAt: now, updatedAt: now };
		expect(await hooks.account.create.before(account as never)).toMatchObject({ data: { accessToken: 'at', idToken: null } });
		expect(await hooks.account.update.before({ idToken: 'eyJ.profile.sig' } as never)).toMatchObject({ data: { idToken: null } });
	});
});
