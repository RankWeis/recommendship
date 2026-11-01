// The API surface is small because reads never hit the server: devices read
// their own SQLite and PowerSync streams changes down.
//
//   *    /api/auth/*            Better Auth (sign-in, sessions, JWKS, token)
//   GET  /api/public/config     which sign-in methods are on, and the per-user row limits
//   GET  /api/me                who am I, am I approved
//   GET  /api/lookup            find a movie, show or book by title (TMDB, Open Library)
//   GET  /api/lookup/details    who made it (a film's director, a show's creators)
//   GET  /api/sync/credentials  PowerSync endpoint + short-lived JWT (approved users)
//   POST /api/write             batch of client mutations from the upload queue
//   POST /api/invites           admin: create an invite code
//   GET  /api/invites           admin: list invite codes (with who used each)
//   DELETE /api/invites/:code   admin: revoke an unused code, or remove a used one from the list
//   POST /api/invites/redeem    use a code to get approved
//   GET  /api/admin/stats                 admin: totals for keeping an eye on things
//   GET  /api/admin/users                 admin: accounts with usage and status (search, filter, sort, pages)
//   PUT  /api/admin/users/:id/limits      admin: give someone their own limits, or none
//   POST /api/admin/users/:id/approve     admin: let someone in without an invite code
//   POST /api/admin/users/:id/suspend     admin: cut off writes and sync (optionally delete their data)
//   POST /api/admin/users/:id/unsuspend   admin: restore access
//   GET  /healthz

import { appUser, category, invite, item, recommendation, recommender, suspension, userLimits, writeUsage } from '@recommendship/schema/pg';
import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, gte, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { isAdmin, type Auth } from './auth';
import type { Db } from './db';
import type { Env } from './env';
import { createLookup, LookupUnavailable, type Lookup } from './lookup';
import { rateLimiter } from './rate-limit';
import { applyWrites, batchSchema, NO_QUOTAS, quotas } from './write';

type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
type Vars = { Variables: { session: Session; approved: boolean; suspended: boolean } };

/** 10 characters from an alphabet without look-alikes, shown as ABCDE-FGHJK. */
function inviteCode() {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const bytes = randomBytes(10);
	const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
	return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function createApp({
	env,
	db,
	auth,
	lookup = createLookup({ tmdbToken: env.TMDB_READ_TOKEN, contact: env.BETTER_AUTH_URL })
}: {
	env: Env;
	db: Db;
	auth: Auth;
	lookup?: Lookup;
}) {
	const app = new Hono<Vars>();
	const writeLimit = rateLimiter({ limit: 120, windowMs: 60_000 });
	const opsPerMinute = rateLimiter({ limit: env.WRITE_OPS_PER_MINUTE, windowMs: 60_000 });
	const redeemLimit = rateLimiter({ limit: 10, windowMs: 60 * 60_000 });
	const rowQuotas = quotas(env.ROW_QUOTA);
	const lookupLimit = rateLimiter({ limit: 60, windowMs: 60_000 });

	app.use(secureHeaders({ contentSecurityPolicy: undefined, crossOriginEmbedderPolicy: false }));

	// One public address per environment (BETTER_AUTH_URL): pages opened on any other
	// host (the fly.dev name, www) redirect there, so sign-in cookies and the on-device
	// database always live on the same origin. /api stays reachable on every host:
	// PowerSync fetches the JWKS from the fly.dev name.
	const site = new URL(env.BETTER_AUTH_URL);
	if (env.NODE_ENV === 'production') {
		app.use('*', async (c, next) => {
			const host = c.req.header('host');
			const path = c.req.path;
			if (host && host !== site.host && !path.startsWith('/api/') && path !== '/healthz') {
				const url = new URL(c.req.url);
				return c.redirect(`${site.origin}${url.pathname}${url.search}`, 301);
			}
			await next();
		});
	}

	// One line per API request (method, path, status, time), never bodies or headers, so
	// sync and upload problems show up in `fly logs`. Off in tests.
	if (env.NODE_ENV !== 'test') {
		app.use('/api/*', async (c, next) => {
			const start = performance.now();
			await next();
			console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - start)}ms`);
		});
	}
	app.get('/healthz', (c) => c.text('ok'));
	app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
	// Which sign-in buttons to show.
	app.get('/api/public/config', (c) =>
		c.json({
			google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
			devLogin: env.DEV_LOGIN,
			// So the app can refuse an import that wouldn't fit, rather than half-save it.
			limits: { rows: rowQuotas.item, categories: rowQuotas.category },
			lookup: lookup.available
		})
	);

	// Everything else under /api needs a session.
	app.use('/api/*', async (c, next) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) {
			// Enough to tell "no cookie sent" from "cookie sent but rejected", without logging any values.
			const cookieNames = (c.req.header('cookie') ?? '')
				.split(';')
				.map((p) => p.split('=')[0]?.trim())
				.filter(Boolean);
			console.warn('401', c.req.method, c.req.path, {
				cookies: cookieNames,
				origin: c.req.header('origin') ?? null,
				fetchSite: c.req.header('sec-fetch-site') ?? null,
				fetchMode: c.req.header('sec-fetch-mode') ?? null,
				agent: (c.req.header('user-agent') ?? '').slice(0, 80)
			});
			return c.json({ error: 'sign in first' }, 401);
		}
		const [profile] = await db
			.select({ approvedAt: appUser.approvedAt, suspendedAt: suspension.at })
			.from(appUser)
			.leftJoin(suspension, eq(suspension.userId, appUser.id))
			.where(eq(appUser.id, session.user.id));
		c.set('session', session);
		c.set('suspended', !!profile?.suspendedAt);
		c.set('approved', !!profile?.approvedAt && !profile?.suspendedAt);
		await next();
	});

	const admin = (c: { get: (k: 'session') => Session }) => isAdmin(env, c.get('session').user.email);

	/** A user's limits: the defaults unless an admin set their own. null means no limit. */
	async function limitsFor(userId: string): Promise<{ rows: number | null; changesPerDay: number | null }> {
		const [own] = await db.select().from(userLimits).where(eq(userLimits.userId, userId));
		if (own?.unlimited) return { rows: null, changesPerDay: null };
		return { rows: own?.rows ?? env.ROW_QUOTA, changesPerDay: own?.changesPerDay ?? env.WRITE_OPS_PER_DAY };
	}

	app.get('/api/me', async (c) => {
		const { user } = c.get('session');
		return c.json({
			user: { id: user.id, email: user.email, name: user.name, image: user.image ?? null },
			approved: c.get('approved'),
			suspended: c.get('suspended'),
			admin: admin(c),
			limits: await limitsFor(user.id)
		});
	});

	app.get('/api/sync/credentials', async (c) => {
		// Unapproved accounts get no sync connection at all (the sync rules also filter them out).
		if (!c.get('approved')) return c.json({ error: 'waiting for an invite' }, 403);
		const { token } = await auth.api.getToken({ headers: c.req.raw.headers });
		return c.json({ endpoint: env.POWERSYNC_URL, token });
	});

	// Any signed-in account may look things up (it helps while waiting for an invite too),
	// at a pace no person typing reaches, so nobody uses this as a free TMDB proxy.
	const lookupQuery = z.object({ kind: z.enum(['movie', 'tv', 'book']), q: z.string().trim().min(2).max(100) });
	const detailsQuery = z.object({ source: z.enum(['TMDB_MOVIE', 'TMDB_TV', 'OPEN_LIBRARY']), id: z.string().min(1).max(100) });

	async function lookupResponse(c: Context<Vars>, run: () => Promise<unknown>) {
		if (c.get('suspended')) return c.json({ error: 'this account is suspended' }, 403);
		if (!lookupLimit(c.get('session').user.id)) return c.json({ error: 'too many lookups; try again in a minute' }, 429);
		try {
			return c.json(await run());
		} catch (e) {
			if (e instanceof LookupUnavailable) return c.json({ error: e.message }, 503);
			throw e;
		}
	}

	app.get('/api/lookup', (c) => {
		const query = lookupQuery.safeParse(c.req.query());
		if (!query.success) return c.json({ error: 'expected kind (movie, tv or book) and q (2-100 characters)' }, 400);
		return lookupResponse(c, async () => ({ results: await lookup.search(query.data.kind, query.data.q) }));
	});

	app.get('/api/lookup/details', (c) => {
		const query = detailsQuery.safeParse(c.req.query());
		if (!query.success) return c.json({ error: 'expected source and id' }, 400);
		return lookupResponse(c, () => lookup.details(query.data.source, query.data.id));
	});

	app.post('/api/write', bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
		const userId = c.get('session').user.id;
		// 403 rather than dropping: the device keeps its queue and uploads once approved.
		if (!c.get('approved')) return c.json({ error: 'waiting for an invite' }, 403);
		if (!writeLimit(userId)) return c.json({ error: 'slow down' }, 429);
		const parsed = batchSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: 'bad batch', issues: parsed.error.issues.slice(0, 5) }, 400);

		// Write budget, counted in changes: the row quotas cap how much a user can store,
		// this caps how fast they can churn it. 429 keeps the device's queue for later.
		const cost = parsed.data.ops.length;
		if (!opsPerMinute(userId, cost)) {
			c.header('Retry-After', '60');
			return c.json({ error: `more than ${env.WRITE_OPS_PER_MINUTE} changes in a minute; uploads resume shortly` }, 429);
		}
		const limits = await limitsFor(userId);
		const now = new Date();
		const day = now.toISOString().slice(0, 10);
		const [usage] = await db
			.insert(writeUsage)
			.values({ userId, day, ops: cost })
			.onConflictDoUpdate({ target: [writeUsage.userId, writeUsage.day], set: { ops: sql`${writeUsage.ops} + ${cost}` } })
			.returning({ ops: writeUsage.ops });
		if (limits.changesPerDay != null && (usage?.ops ?? 0) > limits.changesPerDay) {
			const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
			c.header('Retry-After', String(Math.ceil((midnight - now.getTime()) / 1000)));
			console.warn('daily write budget exceeded', userId, usage?.ops);
			return c.json({ error: `more than ${limits.changesPerDay} changes today; uploads resume tomorrow (UTC)` }, 429);
		}

		const result = await applyWrites(db, userId, parsed.data.ops, limits.rows == null ? NO_QUOTAS : quotas(limits.rows));
		if (result.rejected.length) console.warn('write rejections', userId, result.rejected);
		return c.json(result);
	});

	app.post('/api/invites', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const body = z.object({ note: z.string().max(200).optional() }).safeParse(await c.req.json().catch(() => ({})));
		const code = inviteCode();
		await db.insert(invite).values({
			code,
			createdBy: c.get('session').user.id,
			createdAt: new Date().toISOString(),
			note: body.success ? (body.data.note ?? null) : null
		});
		return c.json({ code });
	});

	app.get('/api/invites', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const rows = await db
			.select({
				code: invite.code,
				note: invite.note,
				createdAt: invite.createdAt,
				usedBy: invite.usedBy,
				usedAt: invite.usedAt,
				usedByEmail: appUser.email
			})
			.from(invite)
			.leftJoin(appUser, eq(appUser.id, invite.usedBy))
			.orderBy(desc(invite.createdAt))
			.limit(200);
		return c.json(rows);
	});

	// Revoking an unused code stops it working. Removing a used one only tidies the list:
	// the person it let in stays approved (suspend them to cut them off).
	app.delete('/api/invites/:code', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const deleted = await db
			.delete(invite)
			.where(eq(invite.code, c.req.param('code').toUpperCase()))
			.returning({ usedBy: invite.usedBy });
		if (!deleted.length) return c.json({ error: 'no such code' }, 404);
		return c.json({ deleted: true, wasUsed: !!deleted[0]!.usedBy });
	});

	app.post('/api/invites/redeem', async (c) => {
		const userId = c.get('session').user.id;
		if (c.get('suspended')) return c.json({ error: 'this account is suspended' }, 403);
		if (c.get('approved')) return c.json({ approved: true });
		if (!redeemLimit(userId)) return c.json({ error: 'too many attempts, try again later' }, 429);
		const body = z.object({ code: z.string().trim().toUpperCase().max(20) }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'enter a code' }, 400);

		const now = new Date().toISOString();
		const approved = await db.transaction(async (tx) => {
			const used = await tx
				.update(invite)
				.set({ usedBy: userId, usedAt: now })
				.where(and(eq(invite.code, body.data.code), isNull(invite.usedBy)))
				.returning({ code: invite.code });
			if (!used.length) return false;
			await tx.update(appUser).set({ approvedAt: now }).where(eq(appUser.id, userId));
			return true;
		});
		return approved ? c.json({ approved: true }) : c.json({ error: "that code isn't valid or was already used" }, 400);
	});

	// ---- Admin: who's here, letting someone in, and cutting someone off. ----

	// Everyone's usage, with their effective limits (their own, else the defaults; null = none).
	// near_limit: within 80% of a row limit or of today's change budget.
	const ROW_COUNTS = sql`
		select u.id,
			coalesce(i.n, 0)::int as items, coalesce(p.n, 0)::int as people, coalesce(r.n, 0)::int as recommendations,
			coalesce(w.ops, 0)::int as changes_today,
			case when l.unlimited then null else coalesce(l.rows, ${env.ROW_QUOTA}) end as row_limit,
			case when l.unlimited then null else coalesce(l.changes_per_day, ${env.WRITE_OPS_PER_DAY}) end as change_limit,
			l.user_id is not null as custom_limits
		from app_user u
		left join (select user_id, count(*) n from item group by user_id) i on i.user_id = u.id
		left join (select user_id, count(*) n from recommender group by user_id) p on p.user_id = u.id
		left join (select user_id, count(*) n from recommendation group by user_id) r on r.user_id = u.id
		left join write_usage w on w.user_id = u.id and w.day = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
		left join user_limits l on l.user_id = u.id`;
	const usage = sql`(${ROW_COUNTS}) usage`;
	const nearLimit = sql`(usage.row_limit is not null and greatest(usage.items, usage.people, usage.recommendations) >= 0.8 * usage.row_limit
		or usage.change_limit is not null and usage.changes_today >= 0.8 * usage.change_limit)`;
	const USER_FILTERS = {
		all: undefined,
		waiting: sql`${appUser.approvedAt} is null and ${suspension.at} is null`,
		approved: sql`${appUser.approvedAt} is not null`,
		suspended: sql`${suspension.at} is not null`,
		near: nearLimit,
		custom: sql`usage.custom_limits`
	} satisfies Record<string, SQL | undefined>;
	const USER_SORTS = {
		newest: [desc(appUser.createdAt)],
		rows: [sql`(usage.items + usage.people + usage.recommendations) desc`, desc(appUser.createdAt)],
		changes: [sql`usage.changes_today desc`, desc(appUser.createdAt)]
	};
	const PAGE = 50;
	const listQuery = z.object({
		filter: z.enum(Object.keys(USER_FILTERS) as [keyof typeof USER_FILTERS]).catch('all'),
		sort: z.enum(Object.keys(USER_SORTS) as [keyof typeof USER_SORTS]).catch('newest'),
		q: z.string().trim().max(100).catch(''),
		offset: z.coerce.number().int().min(0).max(1_000_000).catch(0)
	});

	app.get('/api/admin/users', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const { filter, sort, q, offset } = listQuery.parse(c.req.query());
		const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
		const search = q ? or(ilike(appUser.email, like), ilike(appUser.displayName, like)) : undefined;
		const rows = await db
			.select({
				id: appUser.id,
				email: appUser.email,
				name: appUser.displayName,
				createdAt: appUser.createdAt,
				approvedAt: appUser.approvedAt,
				suspendedAt: suspension.at,
				items: sql<number>`usage.items`,
				people: sql<number>`usage.people`,
				recommendations: sql<number>`usage.recommendations`,
				changesToday: sql<number>`usage.changes_today`,
				rowLimit: sql<number | null>`usage.row_limit`,
				changeLimit: sql<number | null>`usage.change_limit`,
				customLimits: sql<boolean>`usage.custom_limits`,
				nearLimit: sql<boolean>`${nearLimit}`,
				total: sql<number>`count(*) over ()`.mapWith(Number)
			})
			.from(appUser)
			.leftJoin(suspension, eq(suspension.userId, appUser.id))
			.innerJoin(usage, sql`usage.id = ${appUser.id}`)
			.where(and(USER_FILTERS[filter], search))
			.orderBy(...USER_SORTS[sort])
			.limit(PAGE)
			.offset(offset);
		return c.json({
			users: rows.map(({ total: _, ...r }) => ({ ...r, admin: isAdmin(env, r.email) })),
			total: rows[0]?.total ?? 0,
			pageSize: PAGE
		});
	});

	app.get('/api/admin/stats', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const now = new Date();
		const today = now.toISOString().slice(0, 10);
		const weekAgo = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
		const n = (q: SQL) => sql<number>`${q}`.mapWith(Number);
		const [accounts] = await db
			.select({
				total: count(),
				today: n(sql`count(*) filter (where ${gte(appUser.createdAt, today)})`),
				last7Days: n(sql`count(*) filter (where ${gte(appUser.createdAt, weekAgo)})`),
				waiting: n(sql`count(*) filter (where ${appUser.approvedAt} is null and ${suspension.at} is null)`),
				approved: n(sql`count(${appUser.approvedAt})`),
				suspended: n(sql`count(${suspension.at})`),
				nearLimit: n(sql`count(*) filter (where ${nearLimit})`),
				customLimits: n(sql`count(*) filter (where usage.custom_limits)`),
				items: n(sql`coalesce(sum(usage.items), 0)`),
				people: n(sql`coalesce(sum(usage.people), 0)`),
				recommendations: n(sql`coalesce(sum(usage.recommendations), 0)`),
				changesToday: n(sql`coalesce(sum(usage.changes_today), 0)`)
			})
			.from(appUser)
			.leftJoin(suspension, eq(suspension.userId, appUser.id))
			.innerJoin(usage, sql`usage.id = ${appUser.id}`);
		return c.json({
			...accounts,
			defaults: {
				rows: env.ROW_QUOTA,
				changesPerDay: env.WRITE_OPS_PER_DAY,
				newAccountsPerDay: env.MAX_NEW_USERS_PER_DAY,
				openSignupsUpTo: env.OPEN_SIGNUPS_UP_TO
			}
		});
	});

	const limitsBody = z.object({
		unlimited: z.boolean(),
		rows: z.number().int().min(0).max(10_000_000).nullable(),
		changesPerDay: z.number().int().min(0).max(100_000_000).nullable()
	});

	// Someone's own limits. Back to { unlimited: false, rows: null, changesPerDay: null } = the defaults.
	app.put('/api/admin/users/:id/limits', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const id = c.req.param('id');
		const body = limitsBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'bad limits', issues: body.error.issues.slice(0, 3) }, 400);
		const [target] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.id, id));
		if (!target) return c.json({ error: 'no such user' }, 404);
		const { unlimited, rows, changesPerDay } = body.data;
		if (!unlimited && rows == null && changesPerDay == null) {
			await db.delete(userLimits).where(eq(userLimits.userId, id));
		} else {
			const set = { unlimited, rows, changesPerDay, updatedAt: new Date().toISOString(), updatedBy: c.get('session').user.id };
			await db.insert(userLimits).values({ userId: id, ...set }).onConflictDoUpdate({ target: userLimits.userId, set });
		}
		console.warn('limits set', id, body.data, { by: c.get('session').user.id });
		return c.json({ limits: await limitsFor(id) });
	});

	// For someone who signed in before getting a code. A suspended account stays out:
	// that's what Unsuspend is for.
	app.post('/api/admin/users/:id/approve', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const id = c.req.param('id');
		const [target] = await db
			.select({ approvedAt: appUser.approvedAt, suspendedAt: suspension.at })
			.from(appUser)
			.leftJoin(suspension, eq(suspension.userId, appUser.id))
			.where(eq(appUser.id, id));
		if (!target) return c.json({ error: 'no such user' }, 404);
		if (target.suspendedAt) return c.json({ error: 'they are suspended; unsuspend them instead' }, 400);
		if (!target.approvedAt) {
			await db.update(appUser).set({ approvedAt: new Date().toISOString() }).where(eq(appUser.id, id));
		}
		return c.json({ approved: true });
	});

	app.post('/api/admin/users/:id/suspend', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const id = c.req.param('id');
		const me = c.get('session').user;
		if (id === me.id) return c.json({ error: "you can't suspend yourself" }, 400);
		const body = z
			.object({ reason: z.string().max(200).optional(), deleteData: z.boolean().optional() })
			.safeParse(await c.req.json().catch(() => ({})));
		const opts = body.success ? body.data : {};
		const [target] = await db.select({ email: appUser.email }).from(appUser).where(eq(appUser.id, id));
		if (!target) return c.json({ error: 'no such user' }, 404);
		if (isAdmin(env, target.email)) return c.json({ error: 'remove them from ADMIN_EMAILS first' }, 400);

		await db.transaction(async (tx) => {
			const at = new Date().toISOString();
			await tx
				.insert(suspension)
				.values({ userId: id, at, by: me.id, reason: opts.reason ?? null })
				.onConflictDoUpdate({ target: suspension.userId, set: { at, by: me.id, reason: opts.reason ?? null } });
			// Clearing approval revokes sync too: the sync streams only serve approved users.
			await tx.update(appUser).set({ approvedAt: null }).where(eq(appUser.id, id));
			if (opts.deleteData) {
				await tx.delete(recommendation).where(eq(recommendation.userId, id));
				await tx.delete(item).where(eq(item.userId, id));
				await tx.delete(recommender).where(eq(recommender.userId, id));
				await tx.delete(category).where(eq(category.userId, id));
			}
		});
		console.warn('suspended', id, { by: me.id, deleteData: !!opts.deleteData });
		return c.json({ suspended: true, dataDeleted: !!opts.deleteData });
	});

	app.post('/api/admin/users/:id/unsuspend', async (c) => {
		if (!admin(c)) return c.json({ error: 'admins only' }, 403);
		const id = c.req.param('id');
		await db.transaction(async (tx) => {
			await tx.delete(suspension).where(eq(suspension.userId, id));
			await tx.update(appUser).set({ approvedAt: new Date().toISOString() }).where(eq(appUser.id, id));
		});
		return c.json({ suspended: false });
	});

	app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
	return app;
}
