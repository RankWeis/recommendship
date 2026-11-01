import { z } from 'zod';

const bool = z
	.enum(['true', 'false', '1', '0', ''])
	.optional()
	.transform((v) => v === 'true' || v === '1');

const list = z
	.string()
	.optional()
	.transform((v) =>
		(v ?? '')
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean)
	);

const schema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	PORT: z.coerce.number().default(3000),
	DATABASE_URL: z.string().min(1),
	/** At least 32 random characters; signs sessions and encrypts JWT private keys. */
	BETTER_AUTH_SECRET: z.string().min(32),
	/** The public origin people open, e.g. https://recommendship.fly.dev (the Vite dev server locally). */
	BETTER_AUTH_URL: z.string().url(),
	/** The PowerSync service URL clients connect to. */
	POWERSYNC_URL: z.string().url(),
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	/** TMDB "API Read Access Token" for movie and TV lookup. Without it, only books are looked up. */
	TMDB_READ_TOKEN: z.string().optional(),
	/** Emails that are approved (and can create invites) as soon as they sign up. */
	ADMIN_EMAILS: list,
	/** Local development only: approve everyone who signs up. */
	AUTO_APPROVE: bool,
	/** Local development and tests only: allow email + password sign-in. Production is Google only. */
	DEV_LOGIN: bool,
	/**
	 * Write budget per user, counted in changes (rows inserted, updated or deleted), on
	 * top of the per-table row quotas. Per minute stops floods; per day caps churn, with
	 * room for the first upload of a full account (ROW_QUOTA × 3 rows).
	 */
	WRITE_OPS_PER_MINUTE: z.coerce.number().int().positive().default(2_000),
	WRITE_OPS_PER_DAY: z.coerce.number().int().positive().default(30_000),
	/** Most items, people and recommendations (each) one user may store. */
	ROW_QUOTA: z.coerce.number().int().positive().default(10_000),
	/** New accounts per UTC day (admins don't count and are never refused). */
	MAX_NEW_USERS_PER_DAY: z.coerce.number().int().nonnegative().default(1_000),
	/**
	 * Open sign-up: new accounts are approved automatically while fewer than this many
	 * accounts are approved; past it, people wait for an invite or an admin's Approve.
	 * 0 = invite-only. This (with ROW_QUOTA) is what bounds the storage bill.
	 */
	OPEN_SIGNUPS_UP_TO: z.coerce.number().int().nonnegative().default(0),
	/** Built web app to serve (apps/web/build). Unset in dev, where Vite serves it. */
	STATIC_DIR: z.string().optional()
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const env = schema.parse(source);
	if (env.NODE_ENV === 'production' && (env.AUTO_APPROVE || env.DEV_LOGIN)) {
		throw new Error('AUTO_APPROVE and DEV_LOGIN must be off in production');
	}
	return env;
}
