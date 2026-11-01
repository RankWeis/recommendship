// The server's Postgres copy of the synced tables. Postgres is the sync hub and
// backup; each device's SQLite (./index.ts) is what the UI talks to.
//
// Columns mirror the SQLite tables name for name (pg.test.ts checks this), since
// PowerSync replicates rows column by column. Two deliberate choices:
// - Timestamps stay ISO-8601 text, exactly as clients write them, so rows read
//   the same before and after a round trip through the server.
// - Ratings are double precision: PowerSync sends Postgres `numeric` as text.
// IDs are text: client-generated UUIDv7s, plus the fixed seed category ids.

import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type { Channel, Enthusiasm, ExternalSource, ItemStatus } from './index';

export const appUser = pgTable('app_user', {
	/** Same id as Better Auth's `user` row. */
	id: text('id').primaryKey(),
	email: text('email'),
	displayName: text('display_name'),
	createdAt: text('created_at').notNull(),
	ratingScaleMin: doublePrecision('rating_scale_min').notNull().default(1),
	ratingScaleMax: doublePrecision('rating_scale_max').notNull().default(5),
	approvedAt: text('approved_at')
});

export const category = pgTable(
	'category',
	{
		id: text('id').primaryKey(),
		userId: text('user_id'),
		name: text('name').notNull(),
		icon: text('icon').notNull(),
		externalSource: text('external_source').$type<ExternalSource>().notNull().default('NONE'),
		sortOrder: integer('sort_order').notNull().default(100),
		/** When this row was last edited, stamped on the device at edit time (newest edit wins). */
		updatedAt: text('updated_at')
	},
	(t) => [index('category_user_idx').on(t.userId)]
);

export const recommender = pgTable(
	'recommender',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		name: text('name').notNull(),
		notes: text('notes'),
		createdAt: text('created_at').notNull(),
		linkedUserId: text('linked_user_id'),
		/** When this row was last edited, stamped on the device at edit time (newest edit wins). */
		updatedAt: text('updated_at')
	},
	// Not unique: "Sam" added on two offline devices is a merge for later (Weekend 3), not a rejected write.
	(t) => [index('recommender_user_idx').on(t.userId)]
);

export const item = pgTable(
	'item',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		categoryId: text('category_id').notNull(),
		title: text('title').notNull(),
		year: integer('year'),
		creator: text('creator'),
		externalSource: text('external_source').$type<ExternalSource>(),
		externalId: text('external_id'),
		imageUrl: text('image_url'),
		metadata: text('metadata'),
		status: text('status').$type<ItemStatus>().notNull().default('TO_TRY'),
		rating: doublePrecision('rating'),
		ratedAt: text('rated_at'),
		review: text('review'),
		addedAt: text('added_at').notNull(),
		triedAt: text('tried_at'),
		/** When this row was last edited, stamped on the device at edit time (newest edit wins). */
		updatedAt: text('updated_at')
	},
	(t) => [
		index('item_user_idx').on(t.userId),
		uniqueIndex('item_external_uq')
			.on(t.userId, t.externalSource, t.externalId)
			.where(sql`${t.externalId} IS NOT NULL`)
	]
);

export const recommendation = pgTable(
	'recommendation',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		itemId: text('item_id')
			.notNull()
			.references(() => item.id, { onDelete: 'cascade' }),
		recommenderId: text('recommender_id')
			.notNull()
			.references(() => recommender.id, { onDelete: 'cascade' }),
		receivedAt: text('received_at').notNull(),
		channel: text('channel').$type<Channel>(),
		enthusiasm: smallint('enthusiasm').$type<Enthusiasm>(),
		note: text('note'),
		/** When this row was last edited, stamped on the device at edit time (newest edit wins). */
		updatedAt: text('updated_at')
	},
	(t) => [index('recommendation_user_idx').on(t.userId), uniqueIndex('recommendation_pair_uq').on(t.itemId, t.recommenderId)]
);

/** Server-only: invite codes for the invite-only launch. Never synced. */
export const invite = pgTable('invite', {
	code: text('code').primaryKey(),
	createdBy: text('created_by').notNull(),
	createdAt: text('created_at').notNull(),
	note: text('note'),
	usedBy: text('used_by'),
	usedAt: text('used_at')
});

/** Server-only: changes each user sent per UTC day, for the daily write budget. */
export const writeUsage = pgTable(
	'write_usage',
	{
		userId: text('user_id').notNull(),
		/** YYYY-MM-DD (UTC). */
		day: text('day').notNull(),
		ops: integer('ops').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.day] })]
);

/**
 * Server-only: suspended accounts. Suspending also clears app_user.approved_at, which
 * cuts writes and sync at once; this row stops them redeeming another invite.
 */
export const suspension = pgTable('suspension', {
	userId: text('user_id').primaryKey(),
	at: text('at').notNull(),
	by: text('by').notNull(),
	reason: text('reason')
});

/**
 * Server-only: an admin's per-user override of the default limits (ROW_QUOTA and
 * WRITE_OPS_PER_DAY). A null limit means "the default"; unlimited skips both checks.
 * Everyone keeps the per-minute flood guard.
 */
export const userLimits = pgTable('user_limits', {
	userId: text('user_id').primaryKey(),
	/** Most items, people and recommendations (each). */
	rows: integer('rows'),
	changesPerDay: integer('changes_per_day'),
	unlimited: boolean('unlimited').notNull().default(false),
	updatedAt: text('updated_at').notNull(),
	updatedBy: text('updated_by').notNull()
});

/**
 * Server-only: when each field of each synced row was last edited (device time,
 * clamped to the server's clock). The write API applies an edit to a field only if
 * it is newer than this, so a stale edit uploaded late doesn't overwrite a newer one.
 */
export const editClock = pgTable(
	'edit_clock',
	{
		tableName: text('table_name').notNull(),
		rowId: text('row_id').notNull(),
		/** { column: ISO time of its last accepted edit } */
		clocks: jsonb('clocks').$type<Record<string, string>>().notNull()
	},
	(t) => [primaryKey({ columns: [t.tableName, t.rowId] })]
);

export const pgSyncedTables = { appUser, category, recommender, item, recommendation };
