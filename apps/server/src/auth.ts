// Better Auth: Google sign-in (plus email/password for local dev and tests),
// sessions in Postgres, and a JWT plugin whose tokens authorize PowerSync. The
// same identity covers the API (session cookie) and sync (short-lived JWT).

import { appUser } from '@recommendship/schema/pg';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';
import { count, gte, isNotNull } from 'drizzle-orm';
import type pg from 'pg';
import type { Db } from './db';
import type { Env } from './env';

/** Must match `client_auth.audience` in the PowerSync config. */
export const POWERSYNC_AUDIENCE = 'recommendship';

export function isAdmin(env: Env, email: string | null | undefined) {
	return !!email && env.ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Shown on the Account page when sign-in is refused because today's sign-ups are used up. */
export const SIGNUPS_FULL = 'signups_full_today';

/**
 * At most MAX_NEW_USERS_PER_DAY accounts are created per UTC day. Admins are always let
 * in, so you can never lock yourself out.
 */
export async function signupAllowed(db: Db, env: Env, email: string | null | undefined): Promise<boolean> {
	if (isAdmin(env, email)) return true;
	const today = new Date().toISOString().slice(0, 10);
	const [row] = await db.select({ n: count() }).from(appUser).where(gte(appUser.createdAt, today));
	return (row?.n ?? 0) < env.MAX_NEW_USERS_PER_DAY;
}

/**
 * Whether a new sign-up is approved without an invite: open sign-up is on and fewer
 * than OPEN_SIGNUPS_UP_TO accounts are approved. Invites and admins' Approve still work
 * past the cap; it only stops automatic approval.
 */
export async function openSeat(db: Db, env: Env): Promise<boolean> {
	if (env.OPEN_SIGNUPS_UP_TO === 0) return false;
	const [row] = await db.select({ n: count() }).from(appUser).where(isNotNull(appUser.approvedAt));
	return (row?.n ?? 0) < env.OPEN_SIGNUPS_UP_TO;
}

export function authOptions(env: Env, pool: pg.Pool, db?: Db) {
	return {
		database: pool,
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		emailAndPassword: { enabled: env.DEV_LOGIN },
		socialProviders:
			env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
				? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
				: {},
		// Production only (Better Auth's own default): locally every request shares one IP, and the
		// e2e tests sign in several times within seconds.
		//
		// Limits are per network address, and many phones share one (carrier NAT, a room on
		// the same Wi-Fi), so they're looser than Better Auth's defaults (60 a minute, and
		// 3 sign-ins per 10 s). Google itself guards the sign-in; email sign-in is off here.
		rateLimit: {
			enabled: env.NODE_ENV === 'production',
			window: 60,
			max: 300,
			customRules: { '/sign-in/social': { window: 10, max: 30 } }
		},
		// Rate limits are per client IP. Behind Fly's proxy the socket address is the proxy's,
		// so read Fly-Client-IP, which the proxy sets itself (unlike X-Forwarded-For).
		advanced: { ipAddress: { ipAddressHeaders: ['fly-client-ip'] } },
		// Failed sign-ins (e.g. sign-ups full for today) land on the Account page, which explains.
		onAPIError: { errorURL: '/account' },
		plugins: [
			jwt({
				jwt: {
					issuer: env.BETTER_AUTH_URL,
					audience: POWERSYNC_AUDIENCE,
					// PowerSync accepts at most 60 minutes; the client fetches a fresh one as needed.
					expirationTime: '15m',
					// sub (the user id) is all sync needs; keep emails out of tokens.
					definePayload: () => ({})
				}
			})
		],
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						if (db && !(await signupAllowed(db, env, user.email))) {
							throw new APIError('FORBIDDEN', { message: SIGNUPS_FULL });
						}
					},
					// Every account gets a profile row. Admins (and everyone, in local dev) start approved;
					// everyone else waits for an invite code.
					after: async (user) => {
						if (!db) return;
						const now = new Date().toISOString();
						const approved = env.AUTO_APPROVE || isAdmin(env, user.email) || (await openSeat(db, env));
						await db
							.insert(appUser)
							.values({ id: user.id, email: user.email, displayName: user.name, createdAt: now, approvedAt: approved ? now : null })
							.onConflictDoNothing();
					}
				}
			}
		}
	} satisfies BetterAuthOptions;
}

export function createAuth(env: Env, pool: pg.Pool, db: Db) {
	return betterAuth(authOptions(env, pool, db));
}

export type Auth = ReturnType<typeof createAuth>;
