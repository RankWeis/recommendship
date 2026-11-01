// Every write the app makes. Each is a single local SQLite transaction, so it
// works with no signal; later the same rows upload through PowerSync's queue.
// IDs are client-generated UUIDv7 (records exist before any server sees them,
// and sort by creation time). Every insert and update stamps updated_at with the
// time of the edit, which the server uses to let the newest edit win per field.

import type { Channel, Enthusiasm, ItemStatus } from '@recommendship/schema';
import type { Transaction } from '@powersync/web';
import { v7 as uuid } from 'uuid';
import { buildBackup, importBatches, planImport, type Backup, type Existing, type ImportPlan, type ImportRows, type Limits } from './backup';
import { db, LOCAL_USER_ID } from './db';
import { lookupCreator, type Match } from './lookup';

const now = () => new Date().toISOString();

/** Recommenders are unique per user on lower(name). */
async function findOrCreateRecommender(tx: Transaction, name: string): Promise<{ id: string; created: boolean }> {
	const existing = await tx.getOptional<{ id: string }>('SELECT id FROM recommender WHERE lower(name) = lower(?)', [name]);
	if (existing) return { id: existing.id, created: false };
	const id = uuid();
	const t = now();
	await tx.execute('INSERT INTO recommender (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, LOCAL_USER_ID, name, t, t]);
	return { id, created: true };
}

export interface QuickAddInput {
	title: string;
	categoryId: string;
	recommenderNames: string[];
	enthusiasm?: Enthusiasm | null;
	note?: string | null;
	channel?: Channel | null;
	/** The movie, show or book it was matched to, if any. */
	match?: Match | null;
}

export interface QuickAddResult {
	itemId: string;
	/** True when the title already existed and recommenders were attached to it. */
	existing: boolean;
	attached: string[];
	alreadyThere: string[];
}

/**
 * Log a recommendation. If the item already exists (the same movie, show or book,
 * or else the same title and category) the new recommenders are attached to it
 * rather than creating a duplicate.
 */
export async function quickAdd(input: QuickAddInput): Promise<QuickAddResult> {
	const match = input.match ?? null;
	const title = (match?.title ?? input.title).trim();
	const names = [...new Set(input.recommenderNames.map((n) => n.trim()).filter(Boolean))];
	const result = await db.writeTransaction(async (tx) => {
		const found =
			(match && (await tx.getOptional<{ id: string; external_id: string | null }>(
				'SELECT id, external_id FROM item WHERE external_source = ? AND external_id = ? LIMIT 1',
				[match.source, match.id]
			))) ||
			// Same title, but never one already linked to something else (Dune 1984 vs 2021).
			(await tx.getOptional<{ id: string; external_id: string | null }>(
				`SELECT id, external_id FROM item WHERE lower(title) = lower(?) AND category_id = ?${match ? ' AND external_id IS NULL' : ''} LIMIT 1`,
				[title, input.categoryId]
			));
		const itemId = found?.id ?? uuid();
		if (!found) {
			await tx.execute(
				`INSERT INTO item (id, user_id, category_id, title, year, creator, image_url, external_source, external_id, status, added_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'TO_TRY', ?, ?)`,
				[
					itemId,
					LOCAL_USER_ID,
					input.categoryId,
					title,
					match?.year ?? null,
					match?.creator ?? null,
					match?.imageUrl ?? null,
					match?.source ?? 'NONE',
					match?.id ?? null,
					now(),
					now()
				]
			);
		} else if (match && !found.external_id) {
			await applyMatch(tx, itemId, match);
		}

		const attached: string[] = [];
		const alreadyThere: string[] = [];
		for (const name of names) {
			const r = await findOrCreateRecommender(tx, name);
			const dup = await tx.getOptional('SELECT id FROM recommendation WHERE item_id = ? AND recommender_id = ?', [itemId, r.id]);
			if (dup) {
				alreadyThere.push(name);
				continue;
			}
			await tx.execute(
				`INSERT INTO recommendation (id, user_id, item_id, recommender_id, received_at, channel, enthusiasm, note, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[uuid(), LOCAL_USER_ID, itemId, r.id, now(), input.channel ?? null, input.enthusiasm ?? null, input.note?.trim() || null, now()]
			);
			attached.push(name);
		}
		return { itemId, existing: !!found, attached, alreadyThere };
	});
	if (match && !match.creator) void fillCreator(result.itemId, match);
	return result;
}

async function applyMatch(tx: Transaction, itemId: string, m: Match) {
	await tx.execute(
		`UPDATE item SET title = ?, year = ?, creator = coalesce(?, creator), image_url = ?, external_source = ?, external_id = ?, updated_at = ?
		WHERE id = ?`,
		[m.title, m.year, m.creator, m.imageUrl, m.source, m.id, now(), itemId]
	);
}

/** Fill in a film's director or a show's creators once the details arrive; skipped offline. */
async function fillCreator(itemId: string, m: Match) {
	const creator = await lookupCreator(m.source, m.id);
	if (creator) await db.execute('UPDATE item SET creator = ?, updated_at = ? WHERE id = ? AND creator IS NULL', [creator, now(), itemId]);
}

/**
 * Link an item you already have to the real movie, show or book (its title becomes
 * the official one, which also fixes typos). If another item is already linked to
 * it, nothing changes and that item comes back, so the two can be merged instead.
 */
export async function matchItem(itemId: string, m: Match): Promise<{ duplicate: { id: string; title: string } | null }> {
	const duplicate = await db.writeTransaction(async (tx) => {
		const other = await tx.getOptional<{ id: string; title: string }>(
			'SELECT id, title FROM item WHERE external_source = ? AND external_id = ? AND id != ?',
			[m.source, m.id, itemId]
		);
		if (!other) await applyMatch(tx, itemId, m);
		return other;
	});
	if (!duplicate && !m.creator) void fillCreator(itemId, m);
	return { duplicate };
}

export async function rateItem(itemId: string, rating: number, review: string | null) {
	const t = now();
	await db.execute(
		`UPDATE item SET status = 'TRIED', rating = ?, review = ?, rated_at = ?, tried_at = coalesce(tried_at, ?), updated_at = ? WHERE id = ?`,
		[rating, review?.trim() || null, t, t, t, itemId]
	);
}

/** Move an item between states. Back to TO_TRY clears the rating so it stops counting. */
export async function setStatus(itemId: string, status: ItemStatus) {
	if (status === 'TO_TRY') {
		await db.execute(`UPDATE item SET status = 'TO_TRY', rating = NULL, rated_at = NULL, tried_at = NULL, updated_at = ? WHERE id = ?`, [now(), itemId]);
	} else {
		await db.execute('UPDATE item SET status = ?, updated_at = ? WHERE id = ?', [status, now(), itemId]);
	}
}

export async function updateItem(itemId: string, fields: { title: string; categoryId: string }) {
	await db.execute('UPDATE item SET title = ?, category_id = ?, updated_at = ? WHERE id = ?', [fields.title.trim(), fields.categoryId, now(), itemId]);
}

export async function removeRecommendation(recommendationId: string) {
	await db.execute('DELETE FROM recommendation WHERE id = ?', [recommendationId]);
}

/** Add someone (new or existing) as a recommender of an item. False if they already are. */
export async function addRecommendation(itemId: string, name: string): Promise<boolean> {
	return db.writeTransaction(async (tx) => {
		const r = await findOrCreateRecommender(tx, name.trim());
		if (await tx.getOptional('SELECT id FROM recommendation WHERE item_id = ? AND recommender_id = ?', [itemId, r.id])) return false;
		const t = now();
		await tx.execute(
			'INSERT INTO recommendation (id, user_id, item_id, recommender_id, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
			[uuid(), LOCAL_USER_ID, itemId, r.id, t, t]
		);
		return true;
	});
}

/**
 * It was Jo, not Sam: point a recommendation at someone else (created if new). If
 * that person already recommended the item, the two entries fold into theirs.
 */
export async function changeRecommender(recommendationId: string, name: string) {
	await db.writeTransaction(async (tx) => {
		const rec = await tx.getOptional<{ item_id: string; note: string | null; enthusiasm: number | null; received_at: string }>(
			'SELECT item_id, note, enthusiasm, received_at FROM recommendation WHERE id = ?',
			[recommendationId]
		);
		if (!rec) return;
		const r = await findOrCreateRecommender(tx, name.trim());
		const t = now();
		const other = await tx.getOptional<{ id: string }>(
			'SELECT id FROM recommendation WHERE item_id = ? AND recommender_id = ? AND id != ?',
			[rec.item_id, r.id, recommendationId]
		);
		if (other) {
			await tx.execute(
				`UPDATE recommendation SET note = coalesce(note, ?), enthusiasm = coalesce(enthusiasm, ?), received_at = min(received_at, ?), updated_at = ?
				WHERE id = ?`,
				[rec.note, rec.enthusiasm, rec.received_at, t, other.id]
			);
			await tx.execute('DELETE FROM recommendation WHERE id = ?', [recommendationId]);
		} else {
			await tx.execute('UPDATE recommendation SET recommender_id = ?, updated_at = ? WHERE id = ?', [r.id, t, recommendationId]);
		}
	});
}

/** How hyped they were: 1 "might like", 2 "you should", 3 "you MUST", or null for unsaid. */
export async function setEnthusiasm(recommendationId: string, enthusiasm: Enthusiasm | null) {
	await db.execute('UPDATE recommendation SET enthusiasm = ?, updated_at = ? WHERE id = ?', [enthusiasm, now(), recommendationId]);
}

export async function setRecommendationNote(recommendationId: string, note: string) {
	await db.execute('UPDATE recommendation SET note = ?, updated_at = ? WHERE id = ?', [note.trim() || null, now(), recommendationId]);
}

export async function renameRecommender(id: string, name: string) {
	await db.execute('UPDATE recommender SET name = ?, updated_at = ? WHERE id = ?', [name.trim(), now(), id]);
}

/**
 * Fold one person into another ("Sma" into "Sam"): their recommendations move
 * across and the duplicate person goes. Where both recommended the same item,
 * the target's entry stays, keeping the earliest date and picking up a note or
 * hype level it didn't have. Order matters for the server, which enforces one
 * recommendation per item and person: duplicates go before the rest move.
 */
export async function mergeRecommenders(fromId: string, intoId: string) {
	if (fromId === intoId) return;
	await db.writeTransaction(async (tx) => {
		const both = await tx.getAll<{ from_id: string; into_id: string; note: string | null; enthusiasm: number | null; received_at: string }>(
			`SELECT f.id AS from_id, t.id AS into_id, f.note, f.enthusiasm, f.received_at
			FROM recommendation f JOIN recommendation t ON t.item_id = f.item_id AND t.recommender_id = ?
			WHERE f.recommender_id = ?`,
			[intoId, fromId]
		);
		for (const d of both) {
			await tx.execute(
				`UPDATE recommendation SET note = coalesce(note, ?), enthusiasm = coalesce(enthusiasm, ?), received_at = min(received_at, ?), updated_at = ?
				WHERE id = ?`,
				[d.note, d.enthusiasm, d.received_at, now(), d.into_id]
			);
			await tx.execute('DELETE FROM recommendation WHERE id = ?', [d.from_id]);
		}
		await tx.execute('UPDATE recommendation SET recommender_id = ?, updated_at = ? WHERE recommender_id = ?', [intoId, now(), fromId]);
		const from = await tx.getOptional<{ notes: string | null }>('SELECT notes FROM recommender WHERE id = ?', [fromId]);
		if (from?.notes) await tx.execute('UPDATE recommender SET notes = coalesce(notes, ?), updated_at = ? WHERE id = ?', [from.notes, now(), intoId]);
		await tx.execute('DELETE FROM recommender WHERE id = ?', [fromId]);
	});
}

/** Remove a person and the recommendations they made. The items themselves stay on your lists. */
export async function deleteRecommender(id: string) {
	await db.writeTransaction(async (tx) => {
		await tx.execute('DELETE FROM recommendation WHERE recommender_id = ?', [id]);
		await tx.execute('DELETE FROM recommender WHERE id = ?', [id]);
	});
}

/**
 * Fold a duplicate item into the one you keep ("Severence" into "Severance").
 * Recommendations move across (one per person: where both copies were recommended
 * by the same person, the kept entry picks up the note, hype level and earliest
 * date). If only the duplicate was rated, its rating, review and tried status carry
 * over; if both were, the kept item's stays. Missing details are filled in from the
 * duplicate, the earliest added date is kept, and the duplicate is removed. As with
 * people, duplicates go before the rest move, for the server's one-per-person rule.
 */
export async function mergeItems(fromId: string, intoId: string) {
	if (fromId === intoId) return;
	await db.writeTransaction(async (tx) => {
		const t = now();
		const both = await tx.getAll<{ from_id: string; into_id: string; note: string | null; enthusiasm: number | null; received_at: string }>(
			`SELECT f.id AS from_id, k.id AS into_id, f.note, f.enthusiasm, f.received_at
			FROM recommendation f JOIN recommendation k ON k.recommender_id = f.recommender_id AND k.item_id = ?
			WHERE f.item_id = ?`,
			[intoId, fromId]
		);
		for (const d of both) {
			await tx.execute(
				`UPDATE recommendation SET note = coalesce(note, ?), enthusiasm = coalesce(enthusiasm, ?), received_at = min(received_at, ?), updated_at = ?
				WHERE id = ?`,
				[d.note, d.enthusiasm, d.received_at, t, d.into_id]
			);
			await tx.execute('DELETE FROM recommendation WHERE id = ?', [d.from_id]);
		}
		await tx.execute('UPDATE recommendation SET item_id = ?, updated_at = ? WHERE item_id = ?', [intoId, t, fromId]);

		// The kept item: take the duplicate's rating only if it has none, fill gaps, keep the earliest add.
		type Row = { status: string; rating: number | null; review: string | null; rated_at: string | null; tried_at: string | null; year: number | null; creator: string | null; image_url: string | null; added_at: string };
		const cols = 'status, rating, review, rated_at, tried_at, year, creator, image_url, added_at';
		const keep = await tx.get<Row>(`SELECT ${cols} FROM item WHERE id = ?`, [intoId]);
		const dup = await tx.get<Row>(`SELECT ${cols} FROM item WHERE id = ?`, [fromId]);
		const takeRating = keep.rating == null && dup.rating != null;
		await tx.execute(
			`UPDATE item SET status = ?, rating = ?, review = ?, rated_at = ?, tried_at = ?, year = ?, creator = ?, image_url = ?, added_at = ?, updated_at = ?
			WHERE id = ?`,
			[
				takeRating || (keep.status === 'TO_TRY' && dup.status === 'TRIED') ? dup.status : keep.status,
				takeRating ? dup.rating : keep.rating,
				takeRating ? (dup.review ?? keep.review) : (keep.review ?? dup.review),
				takeRating ? dup.rated_at : keep.rated_at,
				keep.tried_at ?? dup.tried_at,
				keep.year ?? dup.year,
				keep.creator ?? dup.creator,
				keep.image_url ?? dup.image_url,
				dup.added_at < keep.added_at ? dup.added_at : keep.added_at,
				t,
				intoId
			]
		);
		await tx.execute('DELETE FROM item WHERE id = ?', [fromId]);
	});
}

/** Remove an item and the recommendations for it. */
export async function deleteItem(id: string) {
	await db.writeTransaction(async (tx) => {
		await tx.execute('DELETE FROM recommendation WHERE item_id = ?', [id]);
		await tx.execute('DELETE FROM item WHERE id = ?', [id]);
	});
}

/**
 * Delete many items at once (select and delete), with their recommendations, and then
 * anyone who no longer recommends anything. Written in transactions of at most ~400
 * changes, because one upload request takes 500.
 */
export async function deleteItems(ids: string[]): Promise<{ items: number; people: number }> {
	const touched = new Set<string>();
	const marks = (n: number) => Array(n).fill('?').join(', ');
	for (let k = 0; k < ids.length; k += 100) {
		const page = ids.slice(k, k + 100);
		const recs = await db.getAll<{ item_id: string; recommender_id: string }>(
			`SELECT item_id, recommender_id FROM recommendation WHERE item_id IN (${marks(page.length)})`,
			page
		);
		const recCount = new Map<string, number>();
		for (const r of recs) {
			recCount.set(r.item_id, (recCount.get(r.item_id) ?? 0) + 1);
			touched.add(r.recommender_id);
		}
		let batch: string[] = [];
		let changes = 0;
		const flush = async () => {
			if (!batch.length) return;
			const b = batch;
			batch = [];
			changes = 0;
			await db.writeTransaction(async (tx) => {
				await tx.execute(`DELETE FROM recommendation WHERE item_id IN (${marks(b.length)})`, b);
				await tx.execute(`DELETE FROM item WHERE id IN (${marks(b.length)})`, b);
			});
		};
		for (const id of page) {
			const cost = 1 + (recCount.get(id) ?? 0);
			if (changes + cost > 400) await flush();
			batch.push(id);
			changes += cost;
		}
		await flush();
	}

	const candidates = [...touched];
	const orphans: string[] = [];
	for (let k = 0; k < candidates.length; k += 400) {
		const page = candidates.slice(k, k + 400);
		const rows = await db.getAll<{ id: string }>(
			`SELECT id FROM recommender WHERE id IN (${marks(page.length)}) AND id NOT IN (SELECT recommender_id FROM recommendation)`,
			page
		);
		orphans.push(...rows.map((r) => r.id));
	}
	for (let k = 0; k < orphans.length; k += 400) {
		const page = orphans.slice(k, k + 400);
		await db.execute(`DELETE FROM recommender WHERE id IN (${marks(page.length)})`, page);
	}
	return { items: ids.length, people: orphans.length };
}

export async function createCategory(name: string, icon: string): Promise<string> {
	const id = uuid();
	await db.execute(
		`INSERT INTO category (id, user_id, name, icon, external_source, sort_order, updated_at) VALUES (?, ?, ?, ?, 'NONE', 100, ?)`,
		[id, LOCAL_USER_ID, name.trim(), icon.trim() || '•', now()]
	);
	return id;
}

// ---- Backups (see backup.ts). ----

/** Everything you've logged, as a backup file. */
export async function readBackup(): Promise<Backup> {
	const [categories, people, items, recommendations] = await Promise.all([
		db.getAll(`SELECT id, name, icon, external_source, sort_order FROM category WHERE user_id IS NOT NULL ORDER BY sort_order, name`),
		db.getAll('SELECT id, name, notes, created_at FROM recommender ORDER BY created_at'),
		db.getAll(
			`SELECT id, category_id, title, year, creator, external_source, external_id, image_url, metadata,
				status, rating, rated_at, review, added_at, tried_at
			FROM item ORDER BY added_at`
		),
		db.getAll('SELECT id, item_id, recommender_id, received_at, channel, enthusiasm, note FROM recommendation ORDER BY received_at')
	]);
	return buildBackup({ categories, people, items, recommendations } as Parameters<typeof buildBackup>[0]);
}

/** What importing a backup would add, matched against what's on this device. Writes nothing. */
export async function planBackupImport(backup: Backup, limits: Limits): Promise<ImportPlan> {
	const [categories, people, items, recommendations] = await Promise.all([
		db.getAll<Existing['categories'][number]>('SELECT id, name FROM category WHERE user_id IS NOT NULL'),
		db.getAll<Existing['people'][number]>('SELECT id, name FROM recommender'),
		db.getAll<Existing['items'][number]>('SELECT id, category_id, title, external_source, external_id FROM item'),
		db.getAll<Existing['recommendations'][number]>('SELECT item_id, recommender_id FROM recommendation')
	]);
	return planImport(backup, { categories, people, items, recommendations }, limits, uuid);
}

/** Write a planned import, in transactions small enough to upload one at a time. */
export async function writeImport(rows: ImportRows) {
	const t = now();
	for (const batch of importBatches(rows)) {
		await db.writeTransaction(async (tx) => {
			for (const { table, row } of batch) {
				// Column names come from the backup schema (unknown keys are dropped when parsing).
				const data: Record<string, unknown> = { ...row, user_id: LOCAL_USER_ID, updated_at: t };
				const cols = Object.keys(data);
				await tx.execute(
					`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
					cols.map((c) => data[c] ?? null)
				);
			}
		});
	}
}
