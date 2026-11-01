// The Recommendship data model (design sketch §3), defined once in Drizzle.
//
// These are the SQLite tables each device holds. PowerSync stores synced rows
// as JSON behind views, so the column types are limited to text / integer /
// real, every table has a text `id`, and uniqueness is enforced in app code
// (and later by the server's write handler) rather than by constraints.
// Timestamps are ISO-8601 strings; JSON columns are stored as text.

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const ITEM_STATUSES = ['TO_TRY', 'TRIED', 'DISMISSED'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const EXTERNAL_SOURCES = ['TMDB_MOVIE', 'TMDB_TV', 'OPEN_LIBRARY', 'NONE'] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

export const CHANNELS = ['IN_PERSON', 'TEXT', 'PODCAST', 'SOCIAL', 'OTHER'] as const;
export type Channel = (typeof CHANNELS)[number];

/** 1 = "might like", 2 = "you should", 3 = "you MUST". */
export type Enthusiasm = 1 | 2 | 3;

export const appUser = sqliteTable('app_user', {
	id: text('id').primaryKey(),
	email: text('email'),
	displayName: text('display_name'),
	createdAt: text('created_at').notNull(),
	ratingScaleMin: real('rating_scale_min').notNull().default(1),
	ratingScaleMax: real('rating_scale_max').notNull().default(5),
	/** Invite-only launch: unapproved users can sign in but not sync or write. */
	approvedAt: text('approved_at')
});

export const category = sqliteTable('category', {
	id: text('id').primaryKey(),
	/** null = system seed category. */
	userId: text('user_id'),
	name: text('name').notNull(),
	icon: text('icon').notNull(),
	externalSource: text('external_source').$type<ExternalSource>().notNull().default('NONE'),
	sortOrder: integer('sort_order').notNull().default(100),
	/** When this row was last edited, stamped on the device at edit time (newest edit wins). */
	updatedAt: text('updated_at')
});

/** A person, from your point of view. Unique per user on lower(name), enforced in app code. */
export const recommender = sqliteTable('recommender', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	name: text('name').notNull(),
	notes: text('notes'),
	createdAt: text('created_at').notNull(),
	/** Later: link to a real account. */
	linkedUserId: text('linked_user_id'),
	/** When this row was last edited, stamped on the device at edit time (newest edit wins). */
	updatedAt: text('updated_at')
});

/**
 * The thing itself, deduped per user. You rate it once; every recommender shares the credit.
 * Indexes here are created on the device (PowerSync builds them from this schema); with
 * thousands of rows, list queries need them.
 */
export const item = sqliteTable(
	'item',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		categoryId: text('category_id').notNull(),
		title: text('title').notNull(),
		year: integer('year'),
		/** Director, author, chef… */
		creator: text('creator'),
		externalSource: text('external_source').$type<ExternalSource>(),
		externalId: text('external_id'),
		imageUrl: text('image_url'),
		/** JSON. */
		metadata: text('metadata'),
		status: text('status').$type<ItemStatus>().notNull().default('TO_TRY'),
		rating: real('rating'),
		ratedAt: text('rated_at'),
		review: text('review'),
		addedAt: text('added_at').notNull(),
		triedAt: text('tried_at'),
		/** When this row was last edited, stamped on the device at edit time (newest edit wins). */
		updatedAt: text('updated_at')
	},
	(t) => [index('item_status').on(t.status)]
);

/** Who told you about an item. Many per item; unique on (item_id, recommender_id). */
export const recommendation = sqliteTable(
	'recommendation',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		itemId: text('item_id').notNull(),
		recommenderId: text('recommender_id').notNull(),
		receivedAt: text('received_at').notNull(),
		channel: text('channel').$type<Channel>(),
		enthusiasm: integer('enthusiasm').$type<Enthusiasm>(),
		/** "watch it without trailers" */
		note: text('note'),
		/** When this row was last edited, stamped on the device at edit time (newest edit wins). */
		updatedAt: text('updated_at')
	},
	(t) => [index('recommendation_item').on(t.itemId), index('recommendation_recommender').on(t.recommenderId)]
);

// ---- Derived, local-only caches (§6): recomputed on-device, never synced. ----

/** id = `${recommender_id}:${category_id ?? 'all'}` since PowerSync tables need a single text id. */
export const recommenderStats = sqliteTable(
	'recommender_stats',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		recommenderId: text('recommender_id').notNull(),
		/** null = overall. */
		categoryId: text('category_id'),
		n: integer('n').notNull(),
		meanRaw: real('mean_raw'),
		/** Overall row: b_r. Category row: b_r + b_rc, i.e. their full offset in that category. */
		offsetShrunk: real('offset_shrunk').notNull(),
		hitRate: real('hit_rate'),
		pending: integer('pending').notNull().default(0),
		updatedAt: text('updated_at').notNull()
	},
	(t) => [index('recommender_stats_recommender').on(t.recommenderId)]
);

/** id = item_id. */
export const itemPrediction = sqliteTable('item_prediction', {
	id: text('id').primaryKey(),
	predicted: real('predicted').notNull(),
	confidence: real('confidence').notNull(),
	/** Lower bound for the "Safe bets" sort: predicted − z·σ/√(n_eff+1). */
	lowerBound: real('lower_bound').notNull(),
	/** JSON, see Explanation in @recommendship/score. */
	explanation: text('explanation').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const syncedTables = { appUser, category, recommender, item, recommendation };
export const localOnlyTables = { recommenderStats, itemPrediction };

export type AppUser = typeof appUser.$inferSelect;
export type Category = typeof category.$inferSelect;
export type Recommender = typeof recommender.$inferSelect;
export type Item = typeof item.$inferSelect;
export type Recommendation = typeof recommendation.$inferSelect;
export type RecommenderStats = typeof recommenderStats.$inferSelect;
export type ItemPrediction = typeof itemPrediction.$inferSelect;

/** System categories. Stable ids so every device seeds the same rows. */
export const SEED_CATEGORIES: Omit<Category, 'updatedAt'>[] = [
	{ id: 'cat-movie', userId: null, name: 'Movie', icon: '🎬', externalSource: 'TMDB_MOVIE', sortOrder: 10 },
	{ id: 'cat-tv', userId: null, name: 'TV', icon: '📺', externalSource: 'TMDB_TV', sortOrder: 20 },
	{ id: 'cat-book', userId: null, name: 'Book', icon: '📖', externalSource: 'OPEN_LIBRARY', sortOrder: 30 },
	{ id: 'cat-restaurant', userId: null, name: 'Restaurant', icon: '🍜', externalSource: 'NONE', sortOrder: 40 },
	{ id: 'cat-podcast', userId: null, name: 'Podcast', icon: '🎙️', externalSource: 'NONE', sortOrder: 50 },
	{ id: 'cat-music', userId: null, name: 'Music', icon: '🎵', externalSource: 'NONE', sortOrder: 60 },
	{ id: 'cat-game', userId: null, name: 'Game', icon: '🎮', externalSource: 'NONE', sortOrder: 70 },
	{ id: 'cat-other', userId: null, name: 'Other', icon: '✨', externalSource: 'NONE', sortOrder: 80 }
];
