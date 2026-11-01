// POST /api/write: applies a batch of client mutations from PowerSync's upload
// queue. This is the one place untrusted data enters Postgres, so it is strict:
//
// - user_id always comes from the session, never from the client.
// - A row can only be updated or deleted by the user who owns it; an insert
//   whose id already belongs to someone else is rejected, not overwritten.
// - References must be the user's own (an item's category, a recommendation's
//   item and recommender).
// - Columns are allow-listed and validated; anything else is dropped.
// - Per-user quotas cap how much one account can store.
//
// Concurrent edits: newest edit wins, per field. Devices stamp updated_at when the
// change is made (not when it uploads); the server records, per row, when each field
// was last changed (edit_clock) and applies an edit only to fields it is newer for.
// So a rating made offline at 10:00 and uploaded at 11:00 doesn't overwrite one made
// on another device at 10:05, while edits to different fields still both survive.
// Edit times are clamped to the server's clock, so a device whose clock runs ahead
// can't win forever; edits without a time (older app versions) count as "now".
// Deletes always win.
//
// Each op runs in its own savepoint so one bad op is rejected without losing
// the rest of the batch. Rejected ops are reported, not retried: PowerSync then
// replaces the device's copy with the server's, so the device converges.

import { SEED_CATEGORIES } from '@recommendship/schema';
import * as t from '@recommendship/schema/pg';
import { columns, MAX_OPS_PER_BATCH } from '@recommendship/schema/validate';
import { and, count, eq, getTableColumns, sql } from 'drizzle-orm';
import type { PgDatabase, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

// Works with node-postgres in production and PGlite in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = PgDatabase<any, any>;

export { MAX_OPS_PER_BATCH };

export type Quotas = Record<'item' | 'recommender' | 'recommendation' | 'category', number>;

const PLURAL: Record<keyof Quotas, string> = { item: 'items', recommender: 'people', recommendation: 'recommendations', category: 'categories' };

/** Most rows of each kind one user may store. The API passes ROW_QUOTA; these are the defaults. */
export const quotas = (rows = 10_000): Quotas => ({ item: rows, recommender: rows, recommendation: rows, category: 100 });

/** For someone an admin gave no limits. */
export const NO_QUOTAS: Quotas = { item: Infinity, recommender: Infinity, recommendation: Infinity, category: Infinity };

const SEED_CATEGORY_IDS = new Set(SEED_CATEGORIES.map((c) => c.id));

export const opSchema = z.object({
	op: z.enum(['PUT', 'PATCH', 'DELETE']),
	table: z.string(),
	id: z.string().min(1).max(64),
	data: z.record(z.string(), z.unknown()).nullish()
});
export type WriteOp = z.infer<typeof opSchema>;

export const batchSchema = z.object({ ops: z.array(opSchema).max(MAX_OPS_PER_BATCH) });

type TableName = keyof typeof columns;

const tables: Record<TableName, PgTable & { id: unknown; userId: unknown }> = {
	category: t.category,
	recommender: t.recommender,
	item: t.item,
	recommendation: t.recommendation
} as never;

/** snake_case column name → Drizzle property name, per table. */
const propertyOf = Object.fromEntries(
	Object.entries(tables).map(([name, table]) => [
		name,
		new Map(Object.entries(getTableColumns(table)).map(([prop, col]) => [col.name, prop]))
	])
) as Record<TableName, Map<string, string>>;

function toProps(table: TableName, data: Record<string, unknown>) {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(data)) {
		const prop = propertyOf[table].get(k);
		if (prop) out[prop] = v === undefined ? null : v;
	}
	return out;
}

export interface Rejection {
	index: number;
	table: string;
	id: string;
	reason: string;
}

export interface WriteResult {
	applied: number;
	rejected: Rejection[];
}

class Reject extends Error {}

/** The device's edit time, normalised, and never later than the server's clock. */
export function editTime(raw: unknown, now: Date): string {
	const server = now.toISOString();
	if (typeof raw !== 'string') return server;
	const t = new Date(raw);
	if (Number.isNaN(t.getTime())) return server;
	const device = t.toISOString();
	return device < server ? device : server;
}

export async function applyWrites(
	db: AnyDb,
	userId: string,
	ops: WriteOp[],
	limits: Quotas = quotas(),
	now = new Date()
): Promise<WriteResult> {
	const rejected: Rejection[] = [];
	let applied = 0;

	await db.transaction(async (tx) => {
		// Rows each table may still gain under its quota, computed once per batch.
		const room = new Map<TableName, number>();
		const hasRoom = async (table: TableName) => {
			if (!room.has(table)) {
				const tbl = tables[table] as typeof t.item;
				const [row] = await tx.select({ n: count() }).from(tbl).where(eq(tbl.userId, userId));
				room.set(table, limits[table] - (row?.n ?? 0));
			}
			const left = room.get(table)!;
			room.set(table, left - 1);
			return left > 0;
		};

		const owns = async (table: typeof t.item | typeof t.category | typeof t.recommender, rowId: string) => {
			const [row] = await tx
				.select({ id: table.id })
				.from(table)
				.where(and(eq(table.id, rowId), eq(table.userId, userId)));
			return !!row;
		};

		type Tx = Parameters<Parameters<typeof tx.transaction>[0]>[0];
		const readClock = async (sp: Tx, table: TableName, rowId: string) => {
			const [row] = await sp
				.select({ clocks: t.editClock.clocks })
				.from(t.editClock)
				.where(and(eq(t.editClock.tableName, table), eq(t.editClock.rowId, rowId)));
			return row?.clocks ?? {};
		};
		const writeClock = (sp: Tx, table: TableName, rowId: string, fields: string[], at: string) =>
			sp
				.insert(t.editClock)
				.values({ tableName: table, rowId, clocks: Object.fromEntries(fields.map((f) => [f, at])) })
				.onConflictDoUpdate({
					target: [t.editClock.tableName, t.editClock.rowId],
					set: { clocks: sql`${t.editClock.clocks} || excluded.clocks` }
				});

		for (const [index, op] of ops.entries()) {
			const reject = (reason: string) => rejected.push({ index, table: op.table, id: op.id, reason });
			if (!(op.table in columns)) {
				reject(`table ${op.table} is not writable`);
				continue;
			}
			const table = op.table as TableName;
			const tbl = tables[table] as typeof t.item;
			const mine = and(eq(tbl.id, op.id), eq(tbl.userId, userId));

			try {
				await tx.transaction(async (sp) => {
					if (op.op === 'DELETE') {
						await sp.delete(tbl).where(mine);
						await sp.delete(t.editClock).where(and(eq(t.editClock.tableName, table), eq(t.editClock.rowId, op.id)));
						return;
					}
					const at = editTime(op.data?.updated_at, now);

					const parsed =
						op.op === 'PUT' ? columns[table].safeParse(op.data ?? {}) : columns[table].partial().safeParse(op.data ?? {});
					if (!parsed.success) throw new Reject(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
					const data = parsed.data as Record<string, unknown>;

					// References must be the user's own.
					if (typeof data.category_id === 'string' && !SEED_CATEGORY_IDS.has(data.category_id) && !(await owns(t.category, data.category_id))) {
						throw new Reject('unknown category');
					}
					if (typeof data.item_id === 'string' && !(await owns(t.item, data.item_id))) throw new Reject('unknown item');
					if (typeof data.recommender_id === 'string' && !(await owns(t.recommender, data.recommender_id))) {
						throw new Reject('unknown recommender');
					}

					const fields = Object.keys(data);

					// Update an existing row: only the fields this edit is the newest for.
					const update = async () => {
						const clock = await readClock(sp, table, op.id);
						const fresh = fields.filter((f) => !(clock[f] && clock[f] > at));
						if (!fresh.length) return; // superseded by a newer edit; nothing to do
						const values = toProps(table, Object.fromEntries(fresh.map((f) => [f, data[f]])));
						const updated = await sp
							.update(tbl)
							.set({ ...values, updatedAt: sql`greatest(coalesce(${tbl.updatedAt}, ''), ${at})` })
							.where(mine)
							.returning({ id: tbl.id });
						if (!updated.length) throw new Reject('not found');
						await writeClock(sp, table, op.id, fresh, at);
					};

					if (op.op === 'PATCH') {
						if (fields.length) await update();
						return;
					}

					// PUT: insert, or (if this user already has the row) an edit of every field.
					const existing = await sp.select({ userId: tbl.userId }).from(tbl).where(eq(tbl.id, op.id));
					if (existing[0] && existing[0].userId !== userId) throw new Reject('id belongs to another user');
					if (existing[0]) return await update();
					if (!(await hasRoom(table))) throw new Reject(`limit of ${limits[table]} ${PLURAL[table]} reached`);
					await sp.insert(tbl).values({ ...toProps(table, data), id: op.id, userId, updatedAt: at } as typeof t.item.$inferInsert);
					await writeClock(sp, table, op.id, fields, at);
				});
				applied++;
			} catch (e) {
				if (e instanceof Reject) reject(e.message);
				else reject(dbError(e));
			}
		}
	});

	return { applied, rejected };
}

/** Constraint violations are the client's problem (reject the op); anything else should surface. */
function dbError(e: unknown): string {
	const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
	if (code === '23505') return 'duplicate';
	if (code === '23503') return 'missing reference';
	if (code?.startsWith('23')) return 'constraint violation';
	throw e;
}
